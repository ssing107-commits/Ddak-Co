/** HTTP 오류 응답 시 파싱된 JSON 본문을 함께 실어 보냄(예: /api/deploy 구조화 실패) */
export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

export async function postJson<T>(path: string, payload: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    const hint =
      err instanceof TypeError && err.message === "Failed to fetch"
        ? " (네트워크 끊김·요청 본문 과대·서버 시간 초과일 수 있습니다.)"
        : "";
    throw new Error(`${path} 요청 실패${hint}: ${err instanceof Error ? err.message : String(err)}`);
  }

  const text = await res.text();
  let data: unknown;
  try {
    data = text ? (JSON.parse(text) as unknown) : {};
  } catch {
    throw new Error(`${path} 응답이 JSON이 아닙니다. (status=${res.status})`);
  }

  if (!res.ok) {
    const message =
      data && typeof data === "object" && "error" in data
        ? String((data as { error?: unknown }).error ?? `${path} 실패`)
        : `${path} 실패 (${res.status})`;
    throw new ApiError(message, res.status, data);
  }

  return data as T;
}
