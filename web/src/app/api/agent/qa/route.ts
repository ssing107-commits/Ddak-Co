import { NextRequest, NextResponse } from "next/server";

import { callAnthropicMessages, getAnthropicApiKeyFromEnv } from "@/lib/anthropic-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

const SYSTEM_PROMPT = `당신은 코드 품질 검수 전문가입니다.
Vercel 빌드가 반드시 통과되어야 합니다.

입력으로 받은 코드 파일 목록을 검수/수정해 최종 코드 파일 목록을 반환하세요.
반드시 아래 JSON만 출력하세요. 마크다운/설명/코드블록 금지.
{"files":[{"path":"파일경로","content":"파일전체내용"},...]}

검증/수정 항목:
- TypeScript 타입 에러 유발 요소 제거
- 사용하지 않는 import/변수 제거
- 빌드 에러 유발 패턴 제거
- next.config.mjs의 ignoreBuildErrors 없이도 빌드 통과 가능한 수준으로 수정

규칙:
- path는 입력 파일 목록의 경로를 유지
- TypeScript strict 기준으로 안전한 코드
- 한국어 UI 텍스트 유지`;

type FileItem = {
  path: string;
  content: string;
};

type QaRequest = {
  files?: unknown;
  input?: unknown;
  uiFiles?: unknown;
};

function stripJsonFence(text: string): string {
  let s = text.trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  return s.trim();
}

function normalizeFiles(raw: unknown): FileItem[] {
  const list = Array.isArray(raw) ? raw : [];
  return list
    .filter((f) => f && typeof f === "object" && !Array.isArray(f))
    .map((f) => {
      const rec = f as Record<string, unknown>;
      return {
        path: typeof rec.path === "string" ? rec.path.trim().replace(/\\/g, "/") : "",
        content: typeof rec.content === "string" ? rec.content : "",
      };
    })
    .filter((f) => f.path && f.content);
}

function extractInputFiles(body: QaRequest): FileItem[] {
  const direct = normalizeFiles(body.files);
  if (direct.length > 0) return direct;

  const fromUiFiles = normalizeFiles(body.uiFiles);
  if (fromUiFiles.length > 0) return fromUiFiles;

  if (body.input && typeof body.input === "object" && !Array.isArray(body.input)) {
    const maybeFiles = (body.input as { files?: unknown }).files;
    return normalizeFiles(maybeFiles);
  }

  return [];
}

function stripUnusedReactStateSetters(content: string): string {
  const stateDecl = /const\s*\[\s*([A-Za-z_$][\w$]*)\s*,\s*(set[A-Za-z_$][\w$]*)\s*\]\s*=\s*useState\b/g;
  let out = content;
  let match: RegExpExecArray | null;
  while ((match = stateDecl.exec(content)) !== null) {
    const valueName = match[1];
    const setterName = match[2];
    const setterUsage = (content.match(new RegExp(`\\b${setterName}\\b`, "g")) || []).length;
    if (setterUsage === 1) {
      const exactDecl = new RegExp(
        `const\\s*\\[\\s*${valueName}\\s*,\\s*${setterName}\\s*\\]\\s*=\\s*useState\\b`,
        "g"
      );
      out = out.replace(exactDecl, `const [${valueName}] = useState`);
    }
  }
  return out;
}

function removeIgnoreBuildOptions(content: string): string {
  return content
    .replace(/\n\s*typescript:\s*\{\s*ignoreBuildErrors:\s*true\s*\},?/g, "")
    .replace(/\n\s*eslint:\s*\{\s*ignoreDuringBuilds:\s*true\s*\},?/g, "");
}

function postProcessFiles(files: FileItem[]): FileItem[] {
  return files.map((file) => {
    let content = file.content;
    if (/\.(ts|tsx)$/.test(file.path)) {
      content = stripUnusedReactStateSetters(content);
    }
    if (file.path === "next.config.mjs") {
      content = removeIgnoreBuildOptions(content);
    }
    return { ...file, content };
  });
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
          content: `아래 코드를 QA 기준으로 검수/수정해 최종 파일 JSON으로 반환하세요.\n\n${JSON.stringify(
            { files },
            null,
            2
          )}`,
        },
      ],
    });

    if (!text) {
      return NextResponse.json({ error: "QA 응답을 처리할 수 없습니다." }, { status: 502 });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(stripJsonFence(text));
    } catch {
      return NextResponse.json({ error: "QA 응답 JSON 파싱에 실패했습니다." }, { status: 502 });
    }

    const finalFiles = normalizeFiles((parsed as { files?: unknown }).files);
    if (finalFiles.length === 0) {
      return NextResponse.json({ error: "검증 완료 파일 목록이 비어 있습니다." }, { status: 502 });
    }

    return NextResponse.json({ files: postProcessFiles(finalFiles) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("(HTTP 401)")) {
      return NextResponse.json(
        { error: "Anthropic API 키가 유효하지 않습니다. (x-api-key 확인)" },
        { status: 401 }
      );
    }
    return NextResponse.json({ error: `QA 에이전트 실행 실패: ${msg}` }, { status: 502 });
  }
}

