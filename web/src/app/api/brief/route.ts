import { NextRequest, NextResponse } from "next/server";

import { callAnthropicMessages, getAnthropicApiKeyFromEnv } from "@/lib/anthropic-api";

/** Vercel Pro 등에서 Claude 응답 대기 시간 확보. Hobby는 플랜상 최대 10초라 초과 시 HTML 502가 날 수 있음. */
export const maxDuration = 60;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SYSTEM = `당신은 제품 기획 어시스턴트입니다. 사용자가 한 줄로 적은 프로젝트 아이디어를 바탕으로 기획서 초안을 한국어로 작성합니다.

반드시 아래 형식의 JSON 객체만 출력하세요. 마크다운 코드 블록(백틱)이나 설명 문장은 넣지 마세요.

{"projectName":"프로젝트명","features":[{"title":"기능 제목","description":"이 기능이 사용자에게 주는 가치와 동작을 2~3문장으로 친절히 설명"},{"title":"...","description":"..."}],"timeline":"예상 일정 설명"}

규칙:
- projectName: 짧고 기억하기 쉬운 한국어 프로젝트명
- features: 정확히 5개의 객체. 각 객체는 title(짧은 기능명, 한국어)과 description(초보 개발자·기획자도 이해할 수 있게 친절한 한국어 설명, 2~4문장 권장)을 포함
- 사용자의 역할(userRole)이 주어지면 해당 직군에서 바로 유용한 기능을 우선 추천
- timeline: 단계별 또는 주·월 단위로 현실적인 예상 일정(한국어)`;

function stripJsonFence(text: string): string {
  let s = text.trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  return s.trim();
}

export async function POST(req: NextRequest) {
  try {
    const apiKey = getAnthropicApiKeyFromEnv();
    if (!apiKey) {
      return NextResponse.json(
        { error: "서버에 ANTHROPIC_API_KEY가 설정되지 않았습니다." },
        { status: 500 }
      );
    }

    let body: { idea?: string; userRole?: string };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: "잘못된 요청입니다." },
        { status: 400 }
      );
    }

    const idea = typeof body.idea === "string" ? body.idea.trim() : "";
    const userRole =
      typeof body.userRole === "string" ? body.userRole.trim() : "";
    if (!idea) {
      return NextResponse.json(
        { error: "프로젝트 아이디어를 입력해 주세요." },
        { status: 400 }
      );
    }
    if (idea.length > 2000) {
      return NextResponse.json(
        { error: "아이디어는 2000자 이하로 입력해 주세요." },
        { status: 400 }
      );
    }

    const model =
      process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-4-20250514";

    try {
    const { text } = await callAnthropicMessages({
      apiKey,
      model,
      max_tokens: 3072,
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `다음 아이디어에 대한 기획서 JSON만 출력하세요.\n${
            userRole ? `사용자 유형: ${userRole}\n` : ""
          }\n아이디어: ${idea}`,
        },
      ],
    });

    if (!text) {
      return NextResponse.json(
        { error: "모델 응답을 처리할 수 없습니다." },
        { status: 502 }
      );
    }

    const raw = stripJsonFence(text);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return NextResponse.json(
        { error: "JSON 파싱에 실패했습니다. 다시 시도해 주세요." },
        { status: 502 }
      );
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json(
        { error: "기획서 형식이 올바르지 않습니다." },
        { status: 502 }
      );
    }

    const o = parsed as Record<string, unknown>;
    const projectName =
      typeof o.projectName === "string" ? o.projectName.trim() : "";
    const timeline = typeof o.timeline === "string" ? o.timeline.trim() : "";
    const rawFeatures = Array.isArray(o.features) ? o.features : [];
    const features: { title: string; description: string }[] = [];
    for (const item of rawFeatures) {
      if (typeof item === "string") {
        const s = item.trim();
        if (s) features.push({ title: s, description: s });
        continue;
      }
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const rec = item as Record<string, unknown>;
        const title = typeof rec.title === "string" ? rec.title.trim() : "";
        const description =
          typeof rec.description === "string" ? rec.description.trim() : "";
        if (title && description) {
          features.push({ title, description });
        }
      }
    }

    if (!projectName || !timeline || features.length !== 5) {
      return NextResponse.json(
        { error: "기획서 형식이 올바르지 않습니다. 다시 시도해 주세요." },
        { status: 502 }
      );
    }

    return NextResponse.json({ projectName, features, timeline });
  } catch (e) {
    console.error(e);
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("(HTTP 401)")) {
      return NextResponse.json(
        { error: "API 키가 유효하지 않습니다. (x-api-key 확인)" },
        { status: 401 }
      );
    }
    if (msg.includes("(HTTP 404)") || msg.includes("(HTTP 400)")) {
      return NextResponse.json(
        {
          error:
            "모델 이름을 확인해 주세요. ANTHROPIC_MODEL 환경 변수를 올바른 모델 ID로 설정하세요.",
        },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: msg || "Claude API 오류가 발생했습니다." },
      { status: 502 }
    );
    }
  } catch (e) {
    console.error("[api/brief] unhandled", e);
    return NextResponse.json(
      {
        error:
          "서버에서 처리 중 예외가 발생했습니다. Vercel 로그를 확인하거나 잠시 후 다시 시도해 주세요.",
      },
      { status: 500 }
    );
  }
}
