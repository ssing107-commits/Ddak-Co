import Anthropic, { APIError } from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";

const SYSTEM = `당신은 제품 기획 어시스턴트입니다. 사용자가 한 줄로 적은 프로젝트 아이디어를 바탕으로 기획서 초안을 한국어로 작성합니다.

반드시 아래 형식의 JSON 객체만 출력하세요. 마크다운 코드 블록(백틱)이나 설명 문장은 넣지 마세요.

{"projectName":"프로젝트명","features":["주요기능1","주요기능2","주요기능3","주요기능4","주요기능5"],"timeline":"예상 일정 설명"}

규칙:
- projectName: 짧고 기억하기 쉬운 한국어 프로젝트명
- features: 정확히 5개의 문자열. 각 항목은 한 줄로 요약한 핵심 기능(한국어)
- timeline: 단계별 또는 주·월 단위로 현실적인 예상 일정(한국어)`;

function stripJsonFence(text: string): string {
  let s = text.trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  return s.trim();
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "서버에 ANTHROPIC_API_KEY가 설정되지 않았습니다." },
      { status: 500 }
    );
  }

  let body: { idea?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const idea = typeof body.idea === "string" ? body.idea.trim() : "";
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

  const anthropic = new Anthropic({ apiKey });

  try {
    const msg = await anthropic.messages.create({
      model,
      max_tokens: 1024,
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `다음 아이디어에 대한 기획서 JSON만 출력하세요:\n\n${idea}`,
        },
      ],
    });

    const block = msg.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") {
      return NextResponse.json(
        { error: "모델 응답을 처리할 수 없습니다." },
        { status: 502 }
      );
    }

    const raw = stripJsonFence(block.text);
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
    const features = Array.isArray(o.features)
      ? o.features.map((f) => String(f).trim()).filter(Boolean)
      : [];

    if (!projectName || !timeline || features.length !== 5) {
      return NextResponse.json(
        { error: "기획서 형식이 올바르지 않습니다. 다시 시도해 주세요." },
        { status: 502 }
      );
    }

    return NextResponse.json({ projectName, features, timeline });
  } catch (e) {
    console.error(e);
    if (e instanceof APIError) {
      if (e.status === 401) {
        return NextResponse.json(
          { error: "API 키가 유효하지 않습니다." },
          { status: 401 }
        );
      }
      if (e.status === 404 || e.status === 400) {
        return NextResponse.json(
          {
            error:
              "모델 이름을 확인해 주세요. ANTHROPIC_MODEL 환경 변수를 올바른 모델 ID로 설정하세요.",
          },
          { status: 400 }
        );
      }
      return NextResponse.json(
        { error: e.message || "Claude API 오류가 발생했습니다." },
        { status: 502 }
      );
    }
    return NextResponse.json(
      { error: "알 수 없는 오류가 발생했습니다." },
      { status: 502 }
    );
  }
}
