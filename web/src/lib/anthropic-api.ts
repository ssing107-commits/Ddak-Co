/**
 * Anthropic Messages API — REST 직접 호출.
 * 공식 스펙: x-api-key + anthropic-version 헤더 (Bearer 아님).
 * POST https://api.anthropic.com/v1/messages
 */

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

export type AnthropicMessageContent =
  | { type: "text"; text: string }
  | { type: string; [key: string]: unknown };

/** Prompt caching: system을 문자열로 보낼 때 Messages API 콘텐츠 블록 형태로 변환 */
export type AnthropicSystemCachedTextBlock = {
  type: "text";
  text: string;
  cache_control: { type: "ephemeral" };
};

export type AnthropicMessagesResponse = {
  id?: string;
  role?: string;
  content?: AnthropicMessageContent[];
  stop_reason?: string | null;
  usage?: { input_tokens?: number; output_tokens?: number };
};

export type AnthropicErrorBody = {
  error?: { type?: string; message?: string };
  type?: string;
  message?: string;
};

export function normalizeAnthropicApiKey(raw: string | undefined): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "";
  if (/^bearer\s+/i.test(trimmed)) {
    return trimmed.replace(/^bearer\s+/i, "").trim();
  }
  return trimmed;
}

export function getAnthropicApiKeyFromEnv(): string {
  return normalizeAnthropicApiKey(process.env.ANTHROPIC_API_KEY);
}

function extractFirstTextBlock(res: AnthropicMessagesResponse): string {
  const blocks = Array.isArray(res.content) ? res.content : [];
  const text = blocks.find((b): b is { type: "text"; text: string } => b.type === "text");
  return typeof text?.text === "string" ? text.text : "";
}

function systemParamToRequestBody(
  system: string | AnthropicSystemCachedTextBlock[]
): string | AnthropicSystemCachedTextBlock[] {
  if (typeof system === "string") {
    return [
      {
        type: "text",
        text: system,
        cache_control: { type: "ephemeral" },
      },
    ];
  }
  return system;
}

export async function callAnthropicMessages(params: {
  apiKey: string;
  model: string;
  max_tokens: number;
  /** 문자열이면 prompt caching(ephemeral)이 적용된 콘텐츠 블록 배열로 변환되어 전송됩니다. */
  system: string | AnthropicSystemCachedTextBlock[];
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}): Promise<{ status: number; raw: AnthropicMessagesResponse; text: string }> {
  const system = systemParamToRequestBody(params.system);

  const res = await fetch(ANTHROPIC_MESSAGES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": params.apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: params.model,
      max_tokens: params.max_tokens,
      system,
      messages: params.messages,
    }),
  });

  const bodyText = await res.text();
  let parsed: unknown;
  try {
    parsed = bodyText ? (JSON.parse(bodyText) as unknown) : {};
  } catch {
    throw new Error(
      `Anthropic 응답이 JSON이 아닙니다 (HTTP ${res.status}). 앞 200자: ${bodyText.slice(0, 200)}`
    );
  }

  if (!res.ok) {
    const err = parsed as AnthropicErrorBody;
    const msg =
      err.error?.message ||
      err.message ||
      (typeof parsed === "object" && parsed !== null && "message" in parsed
        ? String((parsed as { message?: unknown }).message)
        : bodyText.slice(0, 300));
    throw new Error(`Anthropic API 오류 (HTTP ${res.status}): ${msg}`);
  }

  const raw = parsed as AnthropicMessagesResponse;
  const text = extractFirstTextBlock(raw);
  return { status: res.status, raw, text };
}
