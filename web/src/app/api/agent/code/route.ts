import Anthropic, { APIError } from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

const SYSTEM_PROMPT = `당신은 "코딩 딱이"입니다.
입력으로 받은 앱 설계서를 바탕으로 Next.js 14 App Router 프로젝트 코드를 완성하세요.

반드시 아래 JSON만 출력하세요. 마크다운/설명/코드블록 금지.
{"files":[{"path":"파일경로","content":"파일전체내용"},...]}
반드시 JSON만 반환하세요. 설명 텍스트나 마크다운 없이 { "files": [...] } 형태로만.

규칙:
- Next.js 14 App Router 구조를 사용
- TypeScript strict 모드 준수 (사용하지 않는 변수/함수/import 절대 금지)
- shadcn/ui + Tailwind CSS 사용
- UI 텍스트는 한국어
- 모바일 우선 반응형
- path는 프로젝트 루트 기준 상대 경로
- 최소 포함 파일: app/layout.tsx, app/page.tsx
- content는 파일 전체 내용을 담아야 함`;

type CodeRequest = {
  design?: unknown;
  designDoc?: unknown;
  input?: unknown;
};

type GeneratedFile = {
  path: string;
  content: string;
};

function stripJsonFence(text: string): string {
  let s = text.trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  return s.trim();
}

function getDebugSnippet(text: string, length = 500): string {
  return text.slice(0, length).replace(/\s+/g, " ").trim();
}

function extractJsonCandidates(text: string): string[] {
  const candidates: string[] = [];
  const pushUnique = (value: string) => {
    const v = value.trim();
    if (!v) return;
    if (!candidates.includes(v)) candidates.push(v);
  };

  // 1) ```json ... ``` 블록
  const jsonFence = /```json\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = jsonFence.exec(text)) !== null) {
    pushUnique(match[1]);
  }

  // 2) 일반 ``` ... ``` 블록
  const genericFence = /```\s*([\s\S]*?)```/gi;
  while ((match = genericFence.exec(text)) !== null) {
    pushUnique(match[1]);
  }

  // 3) 전체 텍스트 그대로
  pushUnique(text);

  // 4) fence 제거한 텍스트
  pushUnique(stripJsonFence(text));

  // 5) 첫 '{' ~ 마지막 '}' 범위
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    pushUnique(text.slice(firstBrace, lastBrace + 1));
  }

  return candidates;
}

function parseClaudeJsonWithRecovery(text: string): unknown {
  const candidates = extractJsonCandidates(text);
  let lastError: unknown = null;

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch (e) {
      lastError = e;
    }
  }

  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`코드 생성 응답 JSON 파싱에 실패했습니다. raw(앞 500자): ${getDebugSnippet(text)} / parseError: ${detail}`);
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
      return {
        path: typeof rec.path === "string" ? rec.path.trim().replace(/\\/g, "/") : "",
        content: typeof rec.content === "string" ? rec.content : "",
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
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
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
  const anthropic = new Anthropic({ apiKey });

  try {
    const res = await anthropic.messages.create({
      model,
      max_tokens: 16384,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `아래 설계서를 바탕으로 코드 파일 JSON을 생성하세요.\n\n${JSON.stringify(
            design,
            null,
            2
          )}`,
        },
      ],
    });

    const textBlock = res.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return NextResponse.json({ error: "코드 생성 응답을 처리할 수 없습니다." }, { status: 502 });
    }

    let parsed: unknown;
    try {
      parsed = parseClaudeJsonWithRecovery(textBlock.text);
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
    if (e instanceof APIError) {
      return NextResponse.json(
        { error: e.message || "Claude API 오류가 발생했습니다." },
        { status: 502 }
      );
    }
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `코드 에이전트 실행 실패: ${msg}` }, { status: 502 });
  }
}

