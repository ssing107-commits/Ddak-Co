import { jsonrepair } from "jsonrepair";
import { NextRequest, NextResponse } from "next/server";

import { callAnthropicMessages, getAnthropicApiKeyFromEnv } from "@/lib/anthropic-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

const SYSTEM_PROMPT = `당신은 "코딩 딱이"입니다.
입력으로 받은 앱 설계서를 바탕으로 Next.js 14 App Router 프로젝트 코드를 완성하세요.

반드시 아래 형태의 JSON 한 덩어리만 출력하세요. 마크다운 코드블록·설명 문장 없이 순수 JSON만 출력하세요.
{"files":[{"path":"파일경로","content":"BASE64_UTF8"},...]}

중요 — content 필드:
- 각 파일의 실제 소스는 UTF-8 바이트 시퀀스로 만든 뒤, 그 바이트를 base64로 인코딩한 **한 줄짜리 문자열**만 넣으세요.
- content에 소스 코드를 그대로(따옴표·백슬래시·줄바꿈 포함) 넣지 마세요. JSON 이스케이프 실패를 막기 위함입니다.
- base64 문자열에는 공백/줄바꿈을 넣지 마세요.

규칙:
- Next.js 14 App Router 구조를 사용
- TypeScript strict 모드 준수 (사용하지 않는 변수/함수/import 절대 금지)
- shadcn/ui + Tailwind CSS 사용
- UI 텍스트는 한국어
- 모바일 우선 반응형
- path는 프로젝트 루트 기준 상대 경로
- 최소 포함 파일: app/layout.tsx, app/page.tsx`;

type CodeRequest = {
  design?: unknown;
  designDoc?: unknown;
  input?: unknown;
};

type GeneratedFile = {
  path: string;
  content: string;
};

/** 응답 맨 앞에 붙는 ```json / ``` 마크다운 펜스를 반복 제거 */
function preprocessStripMarkdownJsonFence(text: string): string {
  let t = text.trim();
  let prev = "";
  while (prev !== t) {
    prev = t;
    t = t.replace(/^```(?:json)?\s*\r?\n?/i, "").replace(/\r?\n?\s*```\s*$/i, "").trim();
  }
  return t;
}

function formatParseError(e: unknown): string {
  if (e instanceof Error) {
    return `${e.name}: ${e.message}${e.stack ? `\n${e.stack}` : ""}`;
  }
  return String(e);
}

/** 펜스가 열린 채 닫히지 않은 경우 등: 첫 { ~ 마지막 } 구간 추출 */
function extractBalancedJsonObjectFallback(text: string): string | null {
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first < 0 || last <= first) return null;
  return text.slice(first, last + 1);
}

function extractJsonCandidates(originalRaw: string, preprocessed: string): string[] {
  const candidates: string[] = [];
  const pushUnique = (value: string) => {
    const v = value.trim();
    if (!v) return;
    if (!candidates.includes(v)) candidates.push(v);
  };

  const jsonFence = /```json\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = jsonFence.exec(originalRaw)) !== null) {
    pushUnique(match[1]);
  }

  const genericFence = /```\s*([\s\S]*?)```/gi;
  while ((match = genericFence.exec(originalRaw)) !== null) {
    pushUnique(match[1]);
  }

  pushUnique(preprocessStripMarkdownJsonFence(preprocessed));
  pushUnique(preprocessed);

  const bracePre = extractBalancedJsonObjectFallback(preprocessed);
  if (bracePre) pushUnique(bracePre);

  const braceOrig = extractBalancedJsonObjectFallback(originalRaw);
  if (braceOrig) pushUnique(braceOrig);

  return candidates;
}

function tryParseJsonOnce(candidate: string): unknown {
  return JSON.parse(candidate);
}

function tryParseJsonAfterRepair(candidate: string): unknown {
  const repaired = jsonrepair(candidate);
  return JSON.parse(repaired);
}

function parseClaudeJsonWithRecovery(rawText: string): unknown {
  const preprocessed = preprocessStripMarkdownJsonFence(rawText);
  const candidates = extractJsonCandidates(rawText, preprocessed);
  const attemptErrors: string[] = [];

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    const label = `#${i + 1}`;
    try {
      return tryParseJsonOnce(candidate);
    } catch (e1) {
      try {
        return tryParseJsonAfterRepair(candidate);
      } catch (e2) {
        attemptErrors.push(
          `${label} candidate(앞 400자): ${candidate.slice(0, 400).replace(/\s+/g, " ")}\n` +
            `  JSON.parse: ${formatParseError(e1)}\n` +
            `  jsonrepair+JSON.parse: ${formatParseError(e2)}`
        );
      }
    }
  }

  const rawHead = rawText.slice(0, 1500);
  throw new Error(
    `코드 생성 응답 JSON 파싱에 실패했습니다.\n` +
      `시도별 parseError(전체):\n${attemptErrors.join("\n---\n")}\n` +
      `raw(앞 1500자):\n${rawHead}`
  );
}

function extractDesignInput(body: CodeRequest): unknown {
  if (body.designDoc !== undefined) return body.designDoc;
  if (body.design !== undefined) return body.design;
  return body.input;
}

/** 프롬프트 기준(base64)과 구 모델(평문) 호환: 거의 base64 알파벳이면 디코딩 */
function likelyBase64Payload(s: string): boolean {
  const t = s.replace(/\s/g, "");
  if (t.length < 4 || t.length % 4 === 1) return false;
  let ok = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    if (
      (c >= 48 && c <= 57) ||
      (c >= 65 && c <= 90) ||
      (c >= 97 && c <= 122) ||
      c === 43 ||
      c === 47 ||
      c === 61
    ) {
      ok++;
    }
  }
  return ok / t.length > 0.97;
}

function decodeFileContentField(raw: string): string {
  if (!likelyBase64Payload(raw)) {
    return raw;
  }
  const compact = raw.replace(/\s/g, "");
  return Buffer.from(compact, "base64").toString("utf-8");
}

function normalizeFiles(raw: unknown): GeneratedFile[] {
  const list = Array.isArray(raw) ? raw : [];
  return list
    .filter((f) => f && typeof f === "object" && !Array.isArray(f))
    .map((f) => {
      const rec = f as Record<string, unknown>;
      const path = typeof rec.path === "string" ? rec.path.trim().replace(/\\/g, "/") : "";
      const rawContent = typeof rec.content === "string" ? rec.content : "";
      return {
        path,
        content: decodeFileContentField(rawContent),
      };
    })
    .filter((f) => f.path && f.content);
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

function postProcessFiles(files: GeneratedFile[]): GeneratedFile[] {
  return files.map((file) => {
    if (!/\.(ts|tsx)$/.test(file.path)) return file;
    return {
      ...file,
      content: stripUnusedReactStateSetters(file.content),
    };
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

  let body: CodeRequest;
  try {
    body = (await req.json()) as CodeRequest;
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const design = extractDesignInput(body);
  if (!design || typeof design !== "object" || Array.isArray(design)) {
    return NextResponse.json(
      { error: "설계 JSON(design/designDoc/input object)이 필요합니다." },
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
          content: `아래 설계서를 바탕으로 코드 파일 JSON을 생성하세요.
각 files[].content는 해당 파일 UTF-8 본문의 base64(공백 없이)만 넣으세요. 마크다운으로 감싸지 마세요.

${JSON.stringify(design, null, 2)}`,
        },
      ],
    });

    if (!text) {
      return NextResponse.json({ error: "코드 생성 응답을 처리할 수 없습니다." }, { status: 502 });
    }

    let parsed: unknown;
    try {
      parsed = parseClaudeJsonWithRecovery(text);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[api/agent/code] JSON parse failure:", msg);
      return NextResponse.json({ error: msg }, { status: 502 });
    }

    const files = normalizeFiles((parsed as { files?: unknown })?.files);
    if (files.length === 0) {
      return NextResponse.json({ error: "생성된 파일이 없습니다." }, { status: 502 });
    }
    if (!files.some((f) => f.path === "app/layout.tsx") || !files.some((f) => f.path === "app/page.tsx")) {
      return NextResponse.json(
        { error: "필수 파일(app/layout.tsx, app/page.tsx)이 누락되었습니다." },
        { status: 502 }
      );
    }

    return NextResponse.json({ files: postProcessFiles(files) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("(HTTP 401)")) {
      return NextResponse.json(
        { error: "Anthropic API 키가 유효하지 않습니다. (x-api-key 확인)" },
        { status: 401 }
      );
    }
    return NextResponse.json({ error: `코드 에이전트 실행 실패: ${msg}` }, { status: 502 });
  }
}

