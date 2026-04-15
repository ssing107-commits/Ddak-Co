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

export async function callAnthropicMessages(params: {
  apiKey: string;
  model: string;
  max_tokens: number;
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}): Promise<{ status: number; raw: AnthropicMessagesResponse; text: string }> {
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
      system: params.system,
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
