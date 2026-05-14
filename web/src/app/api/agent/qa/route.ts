import { NextRequest, NextResponse } from "next/server";
import { generateObject } from "ai";

import {
  normalizePathContentFiles,
  type PathContentFile,
} from "@/lib/agent-path-files";
import { agentFilesSchema } from "@/lib/agent-schemas";
import {
  createAnthropicLanguageModel,
  getAnthropicApiKeyFromEnv,
  isAnthropicUnauthorizedError,
} from "@/lib/anthropic-api";
import { postProcessAgentFiles } from "@/lib/agent-generated-files";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const SYSTEM_PROMPT = `당신은 코드 품질 검수 전문가입니다.
Vercel 빌드가 반드시 통과되어야 합니다.

입력으로 받은 코드 파일 목록을 검수/수정해 최종 코드 파일 목록을 반환하세요.
출력은 스키마에 맞는 객체만 생성합니다(별도 설명·마크다운 금지).

검증/수정 항목:
- TypeScript/JSX 문법 오류 전수 점검 (잘못된 for/while/if 괄호, 예: i++) ++) 같은 오타, 닫히지 않은 블록)
- TypeScript 타입 에러 유발 요소 제거
- 사용하지 않는 import/변수 제거 (단, 버튼·폼 등 **UI 상호작용에 쓰이는 state/setState·핸들러**는 빌드용으로 제거하지 말 것)
- 빌드 에러 유발 패턴 제거
- globals.css에 @tailwind가 있는데 tailwind.config·postcss.config가 없으면 최소 설정 파일을 추가해 next build가 Tailwind를 처리하게 할 것
- next.config.mjs의 ignoreBuildErrors 없이도 빌드 통과 가능한 수준으로 수정

규칙:
- path는 입력 파일 목록의 경로를 유지
- TypeScript strict 기준으로 안전한 코드
- 한국어 UI 텍스트 유지`;

type QaRequest = {
  files?: unknown;
  input?: unknown;
  uiFiles?: unknown;
  designDoc?: unknown;
  /** Vercel 배포 실패 시 전달되는 빌드 로그 일부 */
  buildLogTail?: unknown;
  deploySummary?: unknown;
};

function extractInputFiles(body: QaRequest): PathContentFile[] {
  const direct = normalizePathContentFiles(body.files);
  if (direct.length > 0) return direct;

  const fromUiFiles = normalizePathContentFiles(body.uiFiles);
  if (fromUiFiles.length > 0) return fromUiFiles;

  if (body.input && typeof body.input === "object" && !Array.isArray(body.input)) {
    const maybeFiles = (body.input as { files?: unknown }).files;
    return normalizePathContentFiles(maybeFiles);
  }

  return [];
}

export async function POST(req: NextRequest) {
  const apiKey = getAnthropicApiKeyFromEnv();
  if (!apiKey) {
    return NextResponse.json(
      { error: "서버에 ANTHROPIC_API_KEY가 설정되지 않았습니다." },
      { status: 500 }
    );
  }

  let body: QaRequest;
  try {
    body = (await req.json()) as QaRequest;
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const files = extractInputFiles(body);
  if (files.length === 0) {
    return NextResponse.json(
      { error: "UI 개선 코드 파일 목록(files)이 필요합니다." },
      { status: 400 }
    );
  }

  const model = process.env.ANTHROPIC_MODEL?.trim() || "claude-haiku-4-5-20251001";
  const languageModel = createAnthropicLanguageModel(apiKey, model);

  const buildLogTail =
    typeof body.buildLogTail === "string" ? body.buildLogTail.trim() : "";
  const deploySummary =
    typeof body.deploySummary === "string" ? body.deploySummary.trim() : "";
  const buildFailureSection =
    buildLogTail || deploySummary
      ? [
          "",
          "=== Vercel/npm 빌드 실패 정보 (반드시 이 오류를 해소할 것) ===",
          deploySummary ? `요약: ${deploySummary}\n` : "",
          buildLogTail ? `--- buildLogTail ---\n${buildLogTail}\n` : "",
        ].join("\n")
      : "";

  const userPrompt =
    `아래 코드를 QA 기준으로 검수/수정해 최종 파일 목록으로 반환하세요.\n` +
    (body.designDoc &&
    typeof body.designDoc === "object" &&
    !Array.isArray(body.designDoc)
      ? `기획서 designDoc가 함께 전달되었습니다. coreFeatures 각각에 대응하는 **사용자 조작 요소**가 UI에 남아 있는지 확인하고, 빌드 통과를 이유로 상호작용만 덜어내지 마세요.\n`
      : "") +
    buildFailureSection +
    `\n${JSON.stringify({ files }, null, 2)}`;

  try {
    const { object } = await generateObject({
      model: languageModel,
      schema: agentFilesSchema,
      system: SYSTEM_PROMPT,
      prompt: userPrompt,
      maxTokens: 16_384,
    });

    const finalFiles = normalizePathContentFiles(object.files);
    if (finalFiles.length === 0) {
      return NextResponse.json({ error: "검증 완료 파일 목록이 비어 있습니다." }, { status: 502 });
    }

    return NextResponse.json({ files: postProcessAgentFiles(finalFiles) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isAnthropicUnauthorizedError(e)) {
      return NextResponse.json(
        { error: "Anthropic API 키가 유효하지 않습니다. (x-api-key 확인)" },
        { status: 401 }
      );
    }
    return NextResponse.json({ error: `QA 에이전트 실행 실패: ${msg}` }, { status: 502 });
  }
}
