import { NextRequest, NextResponse } from "next/server";

import {
  normalizePathContentFiles,
  type PathContentFile,
} from "@/lib/agent-path-files";
import { callAnthropicMessages, getAnthropicApiKeyFromEnv } from "@/lib/anthropic-api";
import { postProcessAgentFiles } from "@/lib/agent-generated-files";
import { peelOuterMarkdownJsonFences } from "@/lib/anthropic-json-text";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const SYSTEM_PROMPT = `당신은 비개발자 사장님이 한눈에 이해할 수 있는
UI를 만드는 전문가입니다.

입력으로 받은 코드 파일 정보를 UI/UX 중심으로 개선하세요.
반드시 아래 JSON만 출력하세요. 마크다운/설명/코드블록 금지.
{"files":[{"path":"파일경로","content":"파일전체내용"},...]}

반드시 반영할 개선 항목:
- 로딩 상태 추가
- 에러 상태 처리
- 빈 상태(empty state) 처리
- 모바일 터치 친화적 버튼 크기 (최소 44px)
- 한국어 사용자에 맞는 폰트/간격
- 정적인 문구만 있는 카드/섹션은 피하고, **눌러보거나 입력해 볼 수 있는 요소**(버튼·폼·탭·접기 등)를 추가해 데모 가능한 수준으로 만들 것

규칙:
- path는 입력의 filePaths 목록 중 하나여야 함
- 수정이 필요한 파일만 files에 포함 (수정 없는 파일은 반환 생략 가능)
- TypeScript strict 모드에서 불필요한 변수/미사용 import를 만들지 말 것
- 한국어 UI 문구를 유지할 것`;

type UiRequest = {
  files?: unknown;
  input?: unknown;
  codeFiles?: unknown;
  /** 기획서(코드 에이전트와 동일 스키마) — 기능별 상호작용 보강에 사용 */
  designDoc?: unknown;
};

type UiPromptPayload = {
  filePaths: string[];
  uiFiles: PathContentFile[];
};

function extractInputFiles(body: UiRequest): PathContentFile[] {
  const direct = normalizePathContentFiles(body.files);
  if (direct.length > 0) return direct;

  const fromCodeFiles = normalizePathContentFiles(body.codeFiles);
  if (fromCodeFiles.length > 0) return fromCodeFiles;

  if (body.input && typeof body.input === "object" && !Array.isArray(body.input)) {
    const maybeFiles = (body.input as { files?: unknown }).files;
    return normalizePathContentFiles(maybeFiles);
  }

  return [];
}

const UI_INLINE_CONTENT_MAX_CHARS = 26_000;

function isUiCandidatePath(path: string): boolean {
  if (path === "app/page.tsx") return true;
  if (/^components\/.+/i.test(path)) return true;
  if (/\.(tsx|css)$/i.test(path)) return true;
  return false;
}

function buildUiPromptPayload(files: PathContentFile[]): UiPromptPayload {
  const filePaths = files.map((f) => f.path);
  const uiFiles = files.filter(
    (f) => isUiCandidatePath(f.path) && f.content.length <= UI_INLINE_CONTENT_MAX_CHARS
  );
  return { filePaths, uiFiles };
}

function mergeUpdatedFiles(
  originalFiles: PathContentFile[],
  improvedFiles: PathContentFile[]
): PathContentFile[] {
  const merged = new Map<string, PathContentFile>();
  for (const file of originalFiles) {
    merged.set(file.path, file);
  }
  for (const file of improvedFiles) {
    merged.set(file.path, file);
  }
  return Array.from(merged.values());
}

export async function POST(req: NextRequest) {
  const apiKey = getAnthropicApiKeyFromEnv();
  if (!apiKey) {
    return NextResponse.json(
      { error: "서버에 ANTHROPIC_API_KEY가 설정되지 않았습니다." },
      { status: 500 }
    );
  }

  let body: UiRequest;
  try {
    body = (await req.json()) as UiRequest;
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const files = extractInputFiles(body);
  if (files.length === 0) {
    return NextResponse.json(
      { error: "코드 파일 목록(files)이 필요합니다." },
      { status: 400 }
    );
  }

  const model = process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-4-20250514";
  const promptPayload = buildUiPromptPayload(files);
  if (promptPayload.uiFiles.length === 0) {
    return NextResponse.json({ files: postProcessAgentFiles(files) });
  }

  try {
    const { text } = await callAnthropicMessages({
      apiKey,
      model,
      max_tokens: 16384,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content:
            `아래 입력을 기준으로 UI/UX를 개선하세요.\n` +
            `- filePaths: 전체 파일 경로 목록 (컨텍스트)\n` +
            `- uiFiles: 실제 코드 본문이 포함된 UI 관련 파일\n` +
            `- uiFiles에만 본문이 있으므로, **반드시 반환하는 files는 uiFiles에 있던 경로만** 수정하세요. (경로만 있고 본문 없는 파일을 새로 만들어 채우지 마세요.)\n` +
            `- designDoc가 있으면 coreFeatures **각각**이 앱 안에서 **눈에 보이는 상호작용**(버튼·폼·토글·목록·탭 등)으로 드러나게 하세요. 설명 문구만 있는 카드로 끝내지 마세요.\n\n` +
            `${JSON.stringify(
              body.designDoc && typeof body.designDoc === "object" && !Array.isArray(body.designDoc)
                ? { ...promptPayload, designDoc: body.designDoc }
                : promptPayload,
              null,
              2
            )}`,
        },
      ],
    });

    if (!text) {
      return NextResponse.json({ error: "UI 개선 응답을 처리할 수 없습니다." }, { status: 502 });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(peelOuterMarkdownJsonFences(text));
    } catch {
      return NextResponse.json({ error: "UI 개선 응답 JSON 파싱에 실패했습니다." }, { status: 502 });
    }

    const improvedFiles = normalizePathContentFiles(
      (parsed as { files?: unknown })?.files
    );
    const mergedFiles = improvedFiles.length > 0 ? mergeUpdatedFiles(files, improvedFiles) : files;
    return NextResponse.json({ files: postProcessAgentFiles(mergedFiles) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("(HTTP 401)")) {
      return NextResponse.json(
        { error: "Anthropic API 키가 유효하지 않습니다. (x-api-key 확인)" },
        { status: 401 }
      );
    }
    return NextResponse.json({ error: `UI 에이전트 실행 실패: ${msg}` }, { status: 502 });
  }
}

