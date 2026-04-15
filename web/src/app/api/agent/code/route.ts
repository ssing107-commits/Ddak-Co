import { jsonrepair } from "jsonrepair";
import { NextRequest, NextResponse } from "next/server";

import { callAnthropicMessages, getAnthropicApiKeyFromEnv } from "@/lib/anthropic-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const SYSTEM_PROMPT = `당신은 "코딩 딱이"입니다.
입력으로 받은 앱 설계서를 바탕으로 Next.js 14 App Router 프로젝트 코드를 완성하세요.

반드시 아래 JSON 형식으로만 응답하세요.
마크다운 코드블록 없이 순수 JSON만 반환하세요.
content 값은 이스케이프된 문자열로 작성하세요.
절대로 base64 인코딩하지 마세요.

{
  "files": [
    {
      "path": "파일경로",
      "content": "파일내용 (줄바꿈은 \\n, 따옴표는 \\\", 백슬래시는 \\\\로 이스케이프)"
    }
  ]
}

규칙:
- Next.js 14 App Router 구조를 사용
- TypeScript strict 모드 준수 (사용하지 않는 변수/함수/import 절대 금지)
- shadcn/ui + Tailwind CSS 사용
- UI 텍스트는 한국어
- 모바일 우선 반응형
- path는 프로젝트 루트 기준 상대 경로
- 최소 포함 파일: app/layout.tsx, app/page.tsx
- 반드시 package.json을 포함하고, dependencies에 next, react, react-dom을 넣을 것`;

type CodeRequest = {
  design?: unknown;
  designDoc?: unknown;
  input?: unknown;
  draft?: boolean;
};

type GeneratedFile = {
  path: string;
  content: string;
};

function decodeHtmlEntities(content: string): string {
  return content
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

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
        content: decodeHtmlEntities(rawContent),
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
  const draftMode = body.draft === true;
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
      max_tokens: draftMode ? 8192 : 16384,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `아래 설계서를 바탕으로 코드 파일 JSON을 생성하세요.
반드시 순수 JSON만 반환하고, content는 일반 문자열(JSON escape 적용)로 반환하세요. base64는 절대 사용하지 마세요.
${draftMode ? "이번 요청은 빠른 초안 배포용입니다. 동작하는 틀만 작성하고 총 파일 수를 8개 이하로 제한하세요. 주석은 쓰지 말고 최대한 간결하게 작성하세요." : ""}

${JSON.stringify(design, null, 2)}`,
        },
      ],
    });

    const rawText = text;
    console.log("[code] raw response (앞 2000자):", rawText.slice(0, 2000));
    if (!rawText) {
      return NextResponse.json({ error: "코드 생성 응답을 처리할 수 없습니다." }, { status: 502 });
    }

    let parsed: unknown;
    try {
      parsed = parseClaudeJsonWithRecovery(rawText);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[api/agent/code] JSON parse failure:", msg);
      return NextResponse.json({ error: msg }, { status: 502 });
    }

    const files = normalizeFiles((parsed as { files?: unknown })?.files);
    if (files.length === 0) {
      return NextResponse.json({ error: "생성된 파일이 없습니다." }, { status: 502 });
    }
    const packageJson = files.find((f) => f.path === "package.json")?.content ?? "";
    if (!packageJson) {
      return NextResponse.json({ error: "필수 파일(package.json)이 누락되었습니다." }, { status: 502 });
    }
    if (!/\"next\"\s*:/.test(packageJson) || !/\"react\"\s*:/.test(packageJson) || !/\"react-dom\"\s*:/.test(packageJson)) {
      return NextResponse.json(
        { error: "package.json dependencies에 next/react/react-dom이 필요합니다." },
        { status: 502 }
      );
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

