import Anthropic, { APIError } from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

const TRIGGER_TEXT = "자산관리 앱 만들어줘";

type AgentRole = "design" | "coding" | "ui" | "qa";
type AgentResult = {
  role: AgentRole;
  name: string;
  output: string;
};

type OrchestrateRequest = {
  input?: string;
  prompt?: string;
  message?: string;
  idea?: string;
};

const DESIGN_SYSTEM = `당신은 "설계 딱이"입니다.
역할:
- 자산관리 앱의 정보 구조, 기능 범위, 데이터 모델, API 설계를 정의합니다.
- 결과는 개발팀이 바로 구현 가능한 수준으로 구체적으로 작성합니다.

출력 형식:
1) 목표 사용자와 핵심 시나리오
2) 기능 목록(우선순위 포함)
3) 데이터 모델(엔티티/필드)
4) API 초안(엔드포인트/입출력)
5) 구현 단계 계획`;

const CODING_SYSTEM = `당신은 "코딩 딱이"입니다.
역할:
- 설계 문서를 바탕으로 Next.js(App Router) + TypeScript 코드 초안을 작성합니다.
- 핵심 파일 구조와 샘플 코드(컴포넌트, 라우트, 타입)를 제시합니다.

규칙:
- 미사용 변수/미사용 import를 만들지 않습니다.
- 실행 가능한 최소 단위 코드를 우선 제공합니다.
- 코드가 아닌 설명은 짧게 유지합니다.`;

const UI_SYSTEM = `당신은 "UI 딱이"입니다.
역할:
- 자산관리 앱의 UI/UX 구조와 스타일 가이드를 제안합니다.
- 화면별 레이아웃, 컴포넌트 규칙, 디자인 토큰(색/간격/타이포)을 작성합니다.

규칙:
- 모바일/데스크톱 반응형 전략을 포함합니다.
- 접근성(명도 대비, 키보드 네비게이션)을 반드시 포함합니다.`;

const QA_SYSTEM = `당신은 "QA 딱이"입니다.
역할:
- 설계/코드/UI 결과를 검토해 버그, 누락, 위험 요소를 찾아 수정 제안을 만듭니다.
- 테스트 체크리스트와 수정 우선순위를 제시합니다.

규칙:
- 심각도(높음/중간/낮음)로 분류합니다.
- 구체적인 수정 액션을 반드시 포함합니다.`;

function extractInput(body: OrchestrateRequest): string {
  const raw =
    body.input ?? body.prompt ?? body.message ?? body.idea ?? "";
  return typeof raw === "string" ? raw.trim() : "";
}

function extractTextFromClaude(content: Anthropic.Messages.Message["content"]): string {
  return content
    .filter((block): block is Anthropic.Messages.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n\n")
    .trim();
}

async function runSubAgent(params: {
  anthropic: Anthropic;
  model: string;
  role: AgentRole;
  name: string;
  system: string;
  userContent: string;
}): Promise<AgentResult> {
  const res = await params.anthropic.messages.create({
    model: params.model,
    max_tokens: 4096,
    system: params.system,
    messages: [{ role: "user", content: params.userContent }],
  });

  const output = extractTextFromClaude(res.content);
  if (!output) {
    throw new Error(`${params.name} 응답이 비어 있습니다.`);
  }

  return {
    role: params.role,
    name: params.name,
    output,
  };
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: "서버에 ANTHROPIC_API_KEY가 설정되지 않았습니다." },
      { status: 500 }
    );
  }

  let body: OrchestrateRequest;
  try {
    body = (await req.json()) as OrchestrateRequest;
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const userInput = extractInput(body);
  if (!userInput) {
    return NextResponse.json({ error: "입력 문장이 필요합니다." }, { status: 400 });
  }
  if (userInput !== TRIGGER_TEXT) {
    return NextResponse.json(
      { error: `현재는 "${TRIGGER_TEXT}" 입력만 지원합니다.` },
      { status: 400 }
    );
  }

  const model = process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-4-20250514";
  const anthropic = new Anthropic({ apiKey });

  try {
    const design = await runSubAgent({
      anthropic,
      model,
      role: "design",
      name: "설계 딱이",
      system: DESIGN_SYSTEM,
      userContent: `사용자 요청: ${userInput}`,
    });

    const [coding, ui] = await Promise.all([
      runSubAgent({
        anthropic,
        model,
        role: "coding",
        name: "코딩 딱이",
        system: CODING_SYSTEM,
        userContent: `사용자 요청: ${userInput}\n\n설계 결과:\n${design.output}`,
      }),
      runSubAgent({
        anthropic,
        model,
        role: "ui",
        name: "UI 딱이",
        system: UI_SYSTEM,
        userContent: `사용자 요청: ${userInput}\n\n설계 결과:\n${design.output}`,
      }),
    ]);

    const qa = await runSubAgent({
      anthropic,
      model,
      role: "qa",
      name: "QA 딱이",
      system: QA_SYSTEM,
      userContent: `사용자 요청: ${userInput}\n\n설계 결과:\n${design.output}\n\n코딩 결과:\n${coding.output}\n\nUI 결과:\n${ui.output}`,
    });

    return NextResponse.json({
      deployPlan: {
        trigger: TRIGGER_TEXT,
        model,
      },
      agents: {
        design,
        coding,
        ui,
        qa,
      },
      finalOutput: qa.output,
    });
  } catch (e) {
    if (e instanceof APIError) {
      return NextResponse.json(
        { error: e.message || "Claude API 호출 중 오류가 발생했습니다." },
        { status: 502 }
      );
    }
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: `오케스트레이션 실패: ${msg}` },
      { status: 502 }
    );
  }
}

