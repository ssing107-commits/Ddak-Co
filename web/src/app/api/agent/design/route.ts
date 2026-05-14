import { NextRequest, NextResponse } from "next/server";

import { generateDesignDocObject } from "@/lib/agent-generate-object";
import {
  createAnthropicLanguageModel,
  getAnthropicApiKeyFromEnv,
  isAnthropicUnauthorizedError,
} from "@/lib/anthropic-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const SYSTEM_PROMPT = `당신은 비전공자 사장님을 위한 앱을 설계하는 전문가입니다.
coreFeatures 3~5개는 각각 **사용자가 화면에서 바로 체감할 수 있는 행동**(눌러보기, 입력하기, 목록 넘기기 등)으로 설명 가능해야 합니다. 추상적인 슬로건만 쓰지 마세요.

출력은 스키마에 맞는 객체만 생성합니다(별도 설명·마크다운 금지).

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

function extractInput(body: DesignRequest): string {
  const raw = body.input ?? body.prompt ?? body.message ?? body.idea ?? "";
  return typeof raw === "string" ? raw.trim() : "";
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
  const languageModel = createAnthropicLanguageModel(apiKey, model);

  try {
    console.log("[design] 호출 시작, key exists:", !!process.env.ANTHROPIC_API_KEY);
    const { object } = await generateDesignDocObject({
      model: languageModel,
      system: SYSTEM_PROMPT,
      prompt: `사용자 요청: ${userInput}`,
      maxTokens: 2048,
    });
    console.log("[design] generateObject 완료:", object.appName);
    return NextResponse.json(object);
  } catch (e) {
    console.error("[design] 에러 전체:", e);
    const msg = e instanceof Error ? e.message : String(e);
    if (isAnthropicUnauthorizedError(e)) {
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
