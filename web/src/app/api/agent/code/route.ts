import { jsonrepair } from "jsonrepair";
import { NextRequest, NextResponse } from "next/server";

import { postProcessAgentFiles } from "@/lib/agent-generated-files";
import { callAnthropicMessages, getAnthropicApiKeyFromEnv } from "@/lib/anthropic-api";
import { peelOuterMarkdownJsonFences, sliceGreedyJsonObject } from "@/lib/anthropic-json-text";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const SYSTEM_PROMPT = `당신은 "코딩 딱이"입니다.
입력으로 받은 앱 설계서를 바탕으로 Next.js 14 App Router 프로젝트 코드를 완성하세요.

반드시 아래 JSON 형식으로만 응답하세요.
마크다운 코드블록 없이 순수 JSON만 반환하세요.
응답 본문은 다른 문자 없이 JSON 객체의 여는 중괄호로 시작해야 합니다(앞에 샵·별표·한글 설명 금지).
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
- Tailwind CSS 유틸리티 클래스로 스타일링
- shadcn/ui, radix-ui, lucide-react 등 외부 UI 라이브러리 패키지는 import하지 말 것.
- UI 컴포넌트는 반드시 아래 경로에서 import해서 사용할 것:
  @/components/ui/button
  @/components/ui/card
  @/components/ui/input
  @/components/ui/badge
  @/components/ui/icons
  위 파일들은 배포 시 항상 저장소에 포함되므로, 동일 역할의 Button·Card·Input·Badge·아이콘을 페이지 안에 다시 직접 구현하지 말 것.
- 아이콘은 가능하면 @/components/ui/icons의 SVG 컴포넌트를 사용하고, icons에 없는 경우에만 인라인 SVG를 작성할 것.
- npm install이나 패키지 추가 설치 없이 next.js 기본 패키지만으로 동작해야 함. (단, Tailwind 적용을 위해 tailwindcss·postcss·autoprefixer 등 Tailwind 구동에 필요한 최소 devDependencies/dependencies만 package.json에 포함하는 것은 허용. 그 외 UI 전용 npm 패키지는 추가 금지.)
- UI 텍스트는 한국어
- 모바일 우선 반응형
- path는 프로젝트 루트 기준 상대 경로
- 최소 포함 파일: app/layout.tsx, app/page.tsx
- 반드시 package.json을 포함하고, dependencies에 next, react, react-dom을 넣을 것
- package.json 작성 시 반드시 아래 규칙을 따를 것:
  - dependencies에는 next, react, react-dom과 Tailwind 구동에 필요한 최소 패키지(tailwindcss, postcss, autoprefixer 등)만 둘 것. lucide-react, @radix-ui/*, class-variance-authority, clsx, tailwind-merge 등 UI·헤드리스 컴포넌트용 패키지는 넣지 말 것.
  - npm registry에 실제 존재하는 버전만 사용할 것
  - 확실하지 않은 패키지 버전은 ^latest 대신 npm에서 확인된 안정 버전을 사용할 것
- app/globals.css 등에 @tailwind base/components/utilities가 있으면 반드시 함께 포함: tailwind.config.ts(또는 .js), postcss.config.mjs(또는 .js). tailwind content에 "./app/**/*.{js,ts,jsx,tsx,mdx}", "./components/**/*.{js,ts,jsx,tsx}" 경로를 넣을 것.
- tsconfig.json의 compilerOptions는 Next.js 14 + create-next-app 수준만 사용할 것. 특히 useDefineForEnumMembers, verbatimModuleSyntax 등 Next 번들 TS가 모르는 옵션은 넣지 말 것(넣으면 Unknown compiler option으로 빌드 실패).
- 모든 .ts/.tsx는 문법적으로 유효해야 함. for/while/if의 괄호·중괄호 짝을 출력 전에 점검할 것. 금지 예: for (let i = 0; i < n; i++) ++) { 처럼 중복된 ++) 또는 닫는 괄호 오류`;

type CodeRequest = {
  design?: unknown;
  designDoc?: unknown;
  input?: unknown;
  draft?: boolean;
  /** QA 이후 등: 기존 프로젝트 파일. 있으면 빌드 복구 모드로 동작 */
  existingFiles?: unknown;
  buildLogTail?: unknown;
  deploySummary?: unknown;
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

/** `# 설명` 등 앞부분을 잘라 `{"files":` 로 시작하도록 함 */
function stripToLeadingFilesJson(text: string): string {
  const m = text.match(/\{\s*"files"\s*:/);
  if (!m || m.index === undefined) return text.trim();
  return text.slice(m.index).trim();
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

  const anchored = stripToLeadingFilesJson(originalRaw);
  const peeledAnchored = peelOuterMarkdownJsonFences(anchored);
  const greedyAnchored = sliceGreedyJsonObject(peeledAnchored);

  /** `{"files"` 로 시작하는 후보만 우선 시도 (마크다운 설명 제외) */
  const pushJsonLike = (value: string) => {
    const v = value.trim();
    if (!v.startsWith("{")) return;
    pushUnique(v);
  };

  pushJsonLike(peeledAnchored);
  pushJsonLike(greedyAnchored);
  pushJsonLike(anchored);

  const jsonFence = /```json\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = jsonFence.exec(originalRaw)) !== null) {
    pushJsonLike(match[1]);
  }

  const genericFence = /```\s*([\s\S]*?)```/gi;
  while ((match = genericFence.exec(originalRaw)) !== null) {
    pushJsonLike(match[1]);
  }

  pushJsonLike(preprocessed);
  pushJsonLike(peelOuterMarkdownJsonFences(originalRaw));
  pushJsonLike(sliceGreedyJsonObject(preprocessed));
  pushJsonLike(sliceGreedyJsonObject(originalRaw));

  const bracePre = extractBalancedJsonObjectFallback(peeledAnchored);
  if (bracePre) pushJsonLike(bracePre);

  const braceOrig = extractBalancedJsonObjectFallback(originalRaw);
  if (braceOrig) pushJsonLike(braceOrig);

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
  const preprocessed = peelOuterMarkdownJsonFences(stripToLeadingFilesJson(rawText));
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

  const repairBaseline = normalizeFiles(body.existingFiles);
  const buildLogTail =
    typeof body.buildLogTail === "string" ? body.buildLogTail.trim() : "";
  const deploySummary =
    typeof body.deploySummary === "string" ? body.deploySummary.trim() : "";
  const repairMode = repairBaseline.length > 0;

  if (repairMode && !buildLogTail) {
    return NextResponse.json(
      { error: "빌드 복구 모드(existingFiles)일 때는 buildLogTail이 필요합니다." },
      { status: 400 }
    );
  }

  const model = process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-4-20250514";

  const userContent = repairMode
    ? [
        "아래 **설계서**와 **기존 프로젝트 파일(existingFiles)**가 있습니다.",
        "Vercel 또는 npm run build가 실패했습니다. QA 검수를 거친 baseline을 바탕으로, **동일 path 구조를 유지한 채** 빌드가 통과하도록 전체 파일 JSON을 다시 출력하세요.",
        "불필요한 기능 추가·대규모 리팩터링은 금지하고, 로그에 나온 오류를 우선 해결하세요.",
        "반드시 순수 JSON만 반환하고, content는 일반 문자열(JSON escape 적용)로 반환하세요. base64는 절대 사용하지 마세요.",
        "응답 첫 글자는 `{` 여야 합니다. `#`·`**`·한글 설명·마크다운 코드펜스(```)를 출력하지 마세요.",
        "",
        deploySummary ? `=== 배포/빌드 요약 ===\n${deploySummary}\n` : "",
        `=== buildLogTail ===\n${buildLogTail}\n`,
        "=== 설계서 ===\n",
        JSON.stringify(design, null, 2),
        "\n\n=== 기존 파일(existingFiles) ===\n",
        JSON.stringify({ files: repairBaseline }, null, 2),
      ].join("\n")
    : `아래 설계서를 바탕으로 코드 파일 JSON을 생성하세요.
반드시 순수 JSON만 반환하고, content는 일반 문자열(JSON escape 적용)로 반환하세요. base64는 절대 사용하지 마세요.
${draftMode ? `이번 요청은 빠른 초안 배포용이지만, **허전한 뼈대만 두지 마세요.**
- 설계서의 coreFeatures(선택된 기능)마다 **화면에서 바로 체감되는 동작**을 최소 1개씩 넣으세요(예: 버튼 클릭 시 상태 변화, 입력·목록·토글, 간단한 폼 제출 후 토스트/안내). 데모용 더미 데이터·로컬 state로 충분합니다.
- **app/page.tsx**는 랜딩 겸 기능 미리보기 섹션을 갖추고, 필요하면 기능별로 app/ 하위 라우트를 나눠도 됩니다.
- 총 파일 수는 **12개 이하**, 주석은 최소화, 코드는 읽기 쉽게 유지하세요.` : ""}

${JSON.stringify(design, null, 2)}`;

  try {
    const { text } = await callAnthropicMessages({
      apiKey,
      model,
      max_tokens: repairMode ? 24_576 : draftMode ? 12_288 : 16384,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: userContent,
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

