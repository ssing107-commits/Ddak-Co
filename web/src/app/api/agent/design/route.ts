import { NextRequest, NextResponse } from "next/server";

import { callAnthropicMessages, getAnthropicApiKeyFromEnv } from "@/lib/anthropic-api";
import { peelOuterMarkdownJsonFences } from "@/lib/anthropic-json-text";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const SYSTEM_PROMPT = `당신은 비전공자 사장님을 위한 앱을 설계하는 전문가입니다.
coreFeatures 3~5개는 각각 **사용자가 화면에서 바로 체감할 수 있는 행동**(눌러보기, 입력하기, 목록 넘기기 등)으로 설명 가능해야 합니다. 추상적인 슬로건만 쓰지 마세요.

반드시 JSON 객체만 출력하세요. 마크다운/코드블록/설명 문장 금지.

출력 스키마:
{
  "appName": "앱 이름",
  "coreFeatures": ["핵심 기능1", "핵심 기능2", "핵심 기능3"],
  "pages": [
    { "name": "페이지 이름", "purpose": "페이지 목적" }
  ],
  "dataStructure": [
    {
      "entity": "엔티티 이름",
      "fields": ["필드1", "필드2"]
    }
  ]
}

규칙:
- coreFeatures는 3~5개
- pages/dataStructure는 각각 1개 이상
- 한국어로 작성`;

type DesignRequest = {
  input?: string;
  prompt?: string;
  message?: string;
  idea?: string;
};

type DesignDoc = {
  appName: string;
  coreFeatures: string[];
  pages: Array<{ name: string; purpose: string }>;
  dataStructure: Array<{ entity: string; fields: string[] }>;
};

function extractInput(body: DesignRequest): string {
  const raw = body.input ?? body.prompt ?? body.message ?? body.idea ?? "";
  return typeof raw === "string" ? raw.trim() : "";
}

function parseDesignDoc(raw: unknown): DesignDoc | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;

  const appName = typeof o.appName === "string" ? o.appName.trim() : "";
  const coreFeatures = Array.isArray(o.coreFeatures)
    ? o.coreFeatures
        .filter((f): f is string => typeof f === "string")
        .map((f) => f.trim())
        .filter(Boolean)
    : [];
  const pages = Array.isArray(o.pages)
    ? o.pages
        .filter((p) => p && typeof p === "object" && !Array.isArray(p))
        .map((p) => {
          const rec = p as Record<string, unknown>;
          return {
            name: typeof rec.name === "string" ? rec.name.trim() : "",
            purpose: typeof rec.purpose === "string" ? rec.purpose.trim() : "",
          };
        })
        .filter((p) => p.name && p.purpose)
    : [];
  const dataStructure = Array.isArray(o.dataStructure)
    ? o.dataStructure
        .filter((e) => e && typeof e === "object" && !Array.isArray(e))
        .map((e) => {
          const rec = e as Record<string, unknown>;
          const fields = Array.isArray(rec.fields)
            ? rec.fields
                .filter((f): f is string => typeof f === "string")
                .map((f) => f.trim())
                .filter(Boolean)
            : [];
          return {
            entity: typeof rec.entity === "string" ? rec.entity.trim() : "",
            fields,
          };
        })
        .filter((e) => e.entity && e.fields.length > 0)
    : [];

  if (
    !appName ||
    coreFeatures.length < 3 ||
    coreFeatures.length > 5 ||
    pages.length === 0 ||
    dataStructure.length === 0
  ) {
    return null;
  }

  return { appName, coreFeatures, pages, dataStructure };
}

export async function POST(req: NextRequest) {
  const apiKey = getAnthropicApiKeyFromEnv();
  if (!apiKey) {
    return NextResponse.json(
      { error: "서버에 ANTHROPIC_API_KEY가 설정되지 않았습니다." },
      { status: 500 }
    );
  }

  let body: DesignRequest;
  try {
    body = (await req.json()) as DesignRequest;
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const userInput = extractInput(body);
  if (!userInput) {
    return NextResponse.json(
      { error: "사용자 요청(자연어) 입력이 필요합니다." },
      { status: 400 }
    );
  }

  const model = process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-4-20250514";

  try {
    console.log("[design] 호출 시작, key exists:", !!process.env.ANTHROPIC_API_KEY);
    const response = await callAnthropicMessages({
      apiKey,
      model,
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `사용자 요청: ${userInput}`,
        },
      ],
    });
    console.log("[design] 응답 status:", response.status);
    const { text } = response;

    if (!text) {
      return NextResponse.json(
        { error: "설계 응답을 처리할 수 없습니다." },
        { status: 502 }
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(peelOuterMarkdownJsonFences(text));
    } catch {
      return NextResponse.json(
        { error: "설계 응답이 JSON 형식이 아닙니다." },
        { status: 502 }
      );
    }

    const designDoc = parseDesignDoc(parsed);
    if (!designDoc) {
      return NextResponse.json(
        { error: "설계서 형식 검증에 실패했습니다." },
        { status: 502 }
      );
    }

    return NextResponse.json(designDoc);
  } catch (e) {
    console.error("[design] 에러 전체:", e);
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("(HTTP 401)")) {
      return NextResponse.json(
        { error: "Anthropic API 키가 유효하지 않습니다. (x-api-key 확인)" },
        { status: 401 }
      );
    }
    return NextResponse.json(
      { error: `설계 에이전트 실행 실패: ${msg}` },
      { status: 502 }
    );
  }
}

