/**
 * Anthropic — Vercel AI SDK (`@ai-sdk/anthropic`) 기반.
 * API 키는 x-api-key(환경변수 ANTHROPIC_API_KEY)로 전달됩니다.
 */

import { createAnthropic } from "@ai-sdk/anthropic";
import { APICallError, type LanguageModel } from "ai";

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

export function createAnthropicLanguageModel(apiKey: string, modelId: string): LanguageModel {
  const key = normalizeAnthropicApiKey(apiKey);
  const anthropic = createAnthropic({ apiKey: key });
  // `ai`와 `@ai-sdk/anthropic`이 각각 다른 @ai-sdk/provider 해상도를 쓸 때 TS 구조 호환 경고를 막기 위함
  return anthropic.languageModel(modelId) as unknown as LanguageModel;
}

export function isAnthropicUnauthorizedError(error: unknown): boolean {
  return APICallError.isInstance(error) && error.statusCode === 401;
}
