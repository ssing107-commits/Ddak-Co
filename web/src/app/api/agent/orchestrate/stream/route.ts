import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type StreamRequest = {
  input?: string;
  prompt?: string;
  message?: string;
  idea?: string;
  userId?: string;
  projectName?: string;
};

function extractInput(body: StreamRequest): string {
  const raw = body.input ?? body.prompt ?? body.message ?? body.idea ?? "";
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

async function callJsonRouteOnce<T>(
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

async function callJsonRoute<T>(
  req: NextRequest,
  path: string,
  payload: unknown,
  label: string
): Promise<T> {
  try {
    return await callJsonRouteOnce<T>(req, path, payload, label);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes("[RATE_LIMIT]")) {
      throw e;
    }
    await sleep(5000);
    try {
      return await callJsonRouteOnce<T>(req, path, payload, label);
    } catch (retryError) {
      const retryMsg =
        retryError instanceof Error ? retryError.message : String(retryError);
      throw new Error(`${retryMsg} (429 재시도 1회 실패)`);
    }
  }
}

function sseEvent(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

export async function POST(req: NextRequest) {
  let body: StreamRequest;
  try {
    body = (await req.json()) as StreamRequest;
  } catch {
    return new Response(
      JSON.stringify({ error: "잘못된 요청입니다." }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const userInput = extractInput(body);
  if (!userInput) {
    return new Response(
      JSON.stringify({ error: "입력 문장이 필요합니다." }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: unknown) => {
        controller.enqueue(encoder.encode(sseEvent(payload)));
      };

      try {
        send({ type: "status", message: "설계 중..." });
        const designDoc = await callJsonRoute<Record<string, unknown>>(
          req,
          "/api/agent/design",
          { input: userInput },
          "설계 딱이"
        );

        await sleep(3000);
        send({ type: "status", message: "코딩 중..." });
        const codingResult = await callJsonRoute<{ files: unknown[] }>(
          req,
          "/api/agent/code",
          { design: designDoc },
          "코딩 딱이"
        );

        await sleep(3000);
        send({ type: "status", message: "UI 다듬는 중..." });
        const uiResult = await callJsonRoute<{ files: unknown[] }>(
          req,
          "/api/agent/ui",
          { files: codingResult.files },
          "UI 딱이"
        );

        await sleep(3000);
        send({ type: "status", message: "검수 중..." });
        const qaResult = await callJsonRoute<{ files: unknown[] }>(
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
        const projectName =
          (typeof body.projectName === "string" && body.projectName.trim()) ||
          designAppName ||
          userInput.slice(0, 40);
        const userId =
          (typeof body.userId === "string" && body.userId.trim()) || "anonymous";

        send({ type: "status", message: "배포 중..." });
        const deployResult = await callJsonRoute<{ deployUrl: string }>(
          req,
          "/api/deploy",
          { userId, projectName, files: qaFiles },
          "배포 단계"
        );

        send({
          type: "done",
          message: `완료! URL: ${deployResult.deployUrl}`,
          deployUrl: deployResult.deployUrl,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        send({ type: "error", message: `오케스트레이션 실패: ${msg}` });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

