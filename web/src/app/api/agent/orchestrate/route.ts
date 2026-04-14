import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

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
  userId?: string;
  projectName?: string;
};

function extractInput(body: OrchestrateRequest): string {
  const raw =
    body.input ?? body.prompt ?? body.message ?? body.idea ?? "";
  return typeof raw === "string" ? raw.trim() : "";
}

function toAbsoluteUrl(req: NextRequest, path: string): string {
  return new URL(path, req.url).toString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitError(status: number, message: string): boolean {
  const lower = message.toLowerCase();
  return (
    status === 429 ||
    lower.includes("429") ||
    lower.includes("rate limit")
  );
}

async function callAgentRouteOnce<T>(
  req: NextRequest,
  path: string,
  payload: unknown,
  label: string
): Promise<T> {
  const res = await fetch(toAbsoluteUrl(req, path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let data: unknown;
  try {
    data = text ? (JSON.parse(text) as unknown) : {};
  } catch {
    throw new Error(`${label} 응답이 JSON 형식이 아닙니다. (status=${res.status})`);
  }

  if (!res.ok) {
    const message =
      data && typeof data === "object" && "error" in data
        ? String((data as { error?: unknown }).error ?? `${label} 실패`)
        : `${label} 실패`;
    if (isRateLimitError(res.status, message)) {
      throw new Error(`[RATE_LIMIT] ${label} 실패: ${message}`);
    }
    throw new Error(`${label} 실패: ${message}`);
  }

  return data as T;
}

async function callAgentRoute<T>(
  req: NextRequest,
  path: string,
  payload: unknown,
  label: string
): Promise<T> {
  try {
    return await callAgentRouteOnce<T>(req, path, payload, label);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes("[RATE_LIMIT]")) {
      throw e;
    }
    await sleep(5000);
    try {
      return await callAgentRouteOnce<T>(req, path, payload, label);
    } catch (retryError) {
      const retryMsg =
        retryError instanceof Error ? retryError.message : String(retryError);
      throw new Error(`${retryMsg} (429 재시도 1회 실패)`);
    }
  }
}

export async function POST(req: NextRequest) {
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

  try {
    const designDoc = await callAgentRoute<Record<string, unknown>>(
      req,
      "/api/agent/design",
      { input: userInput },
      "설계 딱이"
    );

    await sleep(3000);
    const codingResult = await callAgentRoute<{ files: unknown[] }>(
      req,
      "/api/agent/code",
      { design: designDoc },
      "코딩 딱이"
    );

    await sleep(3000);
    const uiResult = await callAgentRoute<{ files: unknown[] }>(
      req,
      "/api/agent/ui",
      { files: codingResult.files },
      "UI 딱이"
    );

    await sleep(3000);
    const qaResult = await callAgentRoute<{ files: unknown[] }>(
      req,
      "/api/agent/qa",
      { files: uiResult.files },
      "QA 딱이"
    );
    const qaFiles = Array.isArray(qaResult.files) ? qaResult.files : [];
    if (qaFiles.length === 0) {
      throw new Error("QA 결과에 배포할 파일이 없습니다.");
    }

    const designAppName =
      typeof designDoc.appName === "string" ? designDoc.appName.trim() : "";
    const finalProjectName =
      (typeof body.projectName === "string" && body.projectName.trim()) ||
      designAppName ||
      userInput.slice(0, 40);
    const finalUserId =
      (typeof body.userId === "string" && body.userId.trim()) || "anonymous";

    const deployResult = await callAgentRoute<{ deployUrl: string }>(
      req,
      "/api/deploy",
      {
        userId: finalUserId,
        projectName: finalProjectName,
        files: qaFiles,
      },
      "배포 단계"
    );

    const design: AgentResult = {
      role: "design",
      name: "설계 딱이",
      output: JSON.stringify(designDoc, null, 2),
    };
    const coding: AgentResult = {
      role: "coding",
      name: "코딩 딱이",
      output: JSON.stringify(codingResult, null, 2),
    };
    const ui: AgentResult = {
      role: "ui",
      name: "UI 딱이",
      output: JSON.stringify(uiResult, null, 2),
    };
    const qa: AgentResult = {
      role: "qa",
      name: "QA 딱이",
      output: JSON.stringify(qaResult, null, 2),
    };

    return NextResponse.json({
      deployPlan: {
        pipeline: [
          "/api/agent/design",
          "/api/agent/code",
          "/api/agent/ui",
          "/api/agent/qa",
          "/api/deploy",
        ],
      },
      agents: { design, coding, ui, qa },
      artifacts: {
        design: designDoc,
        coding: codingResult,
        ui: uiResult,
        qa: qaResult,
        deploy: deployResult,
      },
      finalOutput: {
        deployUrl: deployResult.deployUrl,
        projectName: finalProjectName,
      },
      deployUrl: deployResult.deployUrl,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: `오케스트레이션 실패: ${msg}` },
      { status: 502 }
    );
  }
}

