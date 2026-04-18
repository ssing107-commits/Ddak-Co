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
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

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
