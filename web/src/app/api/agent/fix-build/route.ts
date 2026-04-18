import { NextRequest, NextResponse } from "next/server";

import {
  normalizePathContentFiles,
  type PathContentFile,
} from "@/lib/agent-path-files";
import { callAnthropicMessages, getAnthropicApiKeyFromEnv } from "@/lib/anthropic-api";
import {
  peelOuterMarkdownJsonFences,
  sliceGreedyJsonObject,
} from "@/lib/anthropic-json-text";
import { postProcessAgentFiles } from "@/lib/agent-generated-files";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const SYSTEM_PROMPT = `당신은 Vercel 또는 로컬 npm run build 실패 로그를 보고 코드를 고치는 전문가입니다.

입력: 프로젝트 파일 목록 + buildLogTail(빌드 stderr 등) + (선택) deploySummary

반드시 아래 JSON만 출력하세요. 마크다운/설명/코드블록 금지.
{"files":[{"path":"파일경로","content":"파일전체내용"},...]}

원칙:
- 로그에 나온 오류·파일·줄을 우선 해결할 것
- 불필요한 리팩터링·기능 추가 금지 (최소 수정)
- path는 입력에 있던 경로만 사용. 임의로 새 path를 대량 추가하지 말 것
- next.config에서 ignoreBuildErrors/ignoreDuringBuilds로 빌드를 우회하지 말 것
- TypeScript/JSX 문법·타입·누락 import 등 빌드 실패 원인 제거
- 한국어 UI 문자열은 유지`;

type FixBuildRequest = {
  files?: unknown;
  buildLogTail?: unknown;
  deploySummary?: unknown;
};

function extractBody(body: FixBuildRequest): {
  files: PathContentFile[];
  buildLogTail: string;
  deploySummary: string;
} {
  const files = normalizePathContentFiles(body.files);
  const buildLogTail =
    typeof body.buildLogTail === "string" ? body.buildLogTail.trim() : "";
  const deploySummary =
    typeof body.deploySummary === "string" ? body.deploySummary.trim() : "";
  return { files, buildLogTail, deploySummary };
}

export async function POST(req: NextRequest) {
  const apiKey = getAnthropicApiKeyFromEnv();
  if (!apiKey) {
    return NextResponse.json(
      { error: "서버에 ANTHROPIC_API_KEY가 설정되지 않았습니다." },
      { status: 500 }
    );
  }

  let body: FixBuildRequest;
  try {
    body = (await req.json()) as FixBuildRequest;
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const { files, buildLogTail, deploySummary } = extractBody(body);
  if (files.length === 0) {
    return NextResponse.json(
      { error: "files(경로·내용)이 필요합니다." },
      { status: 400 }
    );
  }
  if (!buildLogTail) {
    return NextResponse.json(
      { error: "buildLogTail(Vercel 빌드 로그 일부)이 필요합니다." },
      { status: 400 }
    );
  }

  const model = process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-4-20250514";

  try {
    const { text } = await callAnthropicMessages({
      apiKey,
      model,
      max_tokens: 16384,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            deploySummary ? `요약: ${deploySummary}\n\n` : "",
            "=== buildLogTail ===\n",
            buildLogTail,
            "\n\n=== files (JSON) ===\n",
            JSON.stringify({ files }, null, 2),
          ].join(""),
        },
      ],
    });

    if (!text) {
      return NextResponse.json(
        { error: "fix-build 응답을 처리할 수 없습니다." },
        { status: 502 }
      );
    }

    const peeled = peelOuterMarkdownJsonFences(text);
    const jsonStr = sliceGreedyJsonObject(peeled);
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      return NextResponse.json(
        { error: "fix-build JSON 파싱에 실패했습니다." },
        { status: 502 }
      );
    }

    const out = normalizePathContentFiles((parsed as { files?: unknown }).files);
    if (out.length === 0) {
      return NextResponse.json(
        { error: "수정된 파일 목록이 비어 있습니다." },
        { status: 502 }
      );
    }

    return NextResponse.json({ files: postProcessAgentFiles(out) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("(HTTP 401)")) {
      return NextResponse.json(
        { error: "Anthropic API 키가 유효하지 않습니다. (x-api-key 확인)" },
        { status: 401 }
      );
    }
    return NextResponse.json(
      { error: `fix-build 실행 실패: ${msg}` },
      { status: 502 }
    );
  }
}
