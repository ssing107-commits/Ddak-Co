import { jsonrepair } from "jsonrepair";
import { NextRequest, NextResponse } from "next/server";

import { postProcessAgentFiles } from "@/lib/agent-generated-files";
import { callAnthropicMessages, getAnthropicApiKeyFromEnv } from "@/lib/anthropic-api";
import { peelOuterMarkdownJsonFences } from "@/lib/anthropic-json-text";

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
- 반드시 package.json을 포함하고, dependencies에 next, react, react-dom을 넣을 것
- package.json 작성 시 반드시 아래 규칙을 따를 것:
  - lucide-react를 import해서 사용하는 컴포넌트를 생성할 경우, dependencies에 "lucide-react": "^0.447.0"을 반드시 포함할 것
  - shadcn/ui 기반 Next.js 앱을 생성할 때는 아래 패키지를 package.json dependencies에 기본 포함할 것:
    - next: 14.2.30
    - react: ^18
    - react-dom: ^18
    - lucide-react: ^0.447.0
    - tailwindcss: ^3.4.0
    - class-variance-authority: ^0.7.0
    - clsx: ^2.1.0
    - tailwind-merge: ^2.3.0
    - @radix-ui/react-slot: ^1.1.0
  - @radix-ui/* 패키지는 ^1.x 버전대를 기본으로 사용할 것
  - shadcn/ui 관련 패키지는 아래 검증된 버전만 사용:
    - @radix-ui/react-slot: ^1.1.0
    - @radix-ui/react-dialog: ^1.1.0
    - @radix-ui/react-dropdown-menu: ^2.1.0
    - class-variance-authority: ^0.7.0
    - clsx: ^2.1.0
    - tailwind-merge: ^2.3.0
  - npm registry에 실제 존재하는 버전만 사용할 것
  - 확실하지 않은 패키지 버전은 ^latest 대신 안정적인 ^1.x 또는 ^2.x 중 npm에서 확인된 버전 사용
- app/globals.css 등에 @tailwind base/components/utilities가 있으면 반드시 함께 포함: tailwind.config.ts(또는 .js), postcss.config.mjs(또는 .js). tailwind content에 "./app/**/*.{js,ts,jsx,tsx,mdx}", "./components/**/*.{js,ts,jsx,tsx}" 경로를 넣을 것.
- 모든 .ts/.tsx는 문법적으로 유효해야 함. for/while/if의 괄호·중괄호 짝을 출력 전에 점검할 것. 금지 예: for (let i = 0; i < n; i++) ++) { 처럼 중복된 ++) 또는 닫는 괄호 오류`;

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
  const preprocessed = peelOuterMarkdownJsonFences(rawText);
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
      max_tokens: draftMode ? 12_288 : 16384,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `아래 설계서를 바탕으로 코드 파일 JSON을 생성하세요.
반드시 순수 JSON만 반환하고, content는 일반 문자열(JSON escape 적용)로 반환하세요. base64는 절대 사용하지 마세요.
${draftMode ? `이번 요청은 빠른 초안 배포용이지만, **허전한 뼈대만 두지 마세요.**
- 설계서의 coreFeatures(선택된 기능)마다 **화면에서 바로 체감되는 동작**을 최소 1개씩 넣으세요(예: 버튼 클릭 시 상태 변화, 입력·목록·토글, 간단한 폼 제출 후 토스트/안내). 데모용 더미 데이터·로컬 state로 충분합니다.
- **app/page.tsx**는 랜딩 겸 기능 미리보기 섹션을 갖추고, 필요하면 기능별로 app/ 하위 라우트를 나눠도 됩니다.
- 총 파일 수는 **12개 이하**, 주석은 최소화, 코드는 읽기 쉽게 유지하세요.` : ""}

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

    return NextResponse.json({ files: postProcessAgentFiles(files) });
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

