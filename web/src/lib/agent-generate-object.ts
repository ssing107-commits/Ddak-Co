import { generateObject, generateText } from "ai";
import type { LanguageModel } from "ai";
import { jsonrepair } from "jsonrepair";

import {
  agentFilesSchema,
  designDocSchema,
  type AgentFilesOutput,
  type DesignDocOutput,
} from "@/lib/agent-schemas";
import { peelOuterMarkdownJsonFences } from "@/lib/anthropic-json-text";

function isStructuredOutputFailure(message: string): boolean {
  return (
    message.includes("Type validation failed") ||
    message.includes("No object generated") ||
    message.includes("did not return a response") ||
    message.includes("could not parse") ||
    message.includes("Invalid JSON")
  );
}

/** 문자열 리터럴·이스케이프를 고려해 첫 `{`부터 균형이 맞는 JSON 오브젝트 구간만 잘라낸다. */
function sliceBalancedJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (c === "\\" && inString) {
      escape = true;
      continue;
    }
    if (c === '"' && !escape) {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

const FILES_JSON_ANCHOR = /\{\s*"files"\s*:/;

function trimToJsonStart(peeled: string, anchor: RegExp | null): string {
  if (!anchor) return peeled.trim();
  const m = peeled.match(anchor);
  if (!m || m.index === undefined) return peeled.trim();
  return peeled.slice(m.index).trim();
}

function tryJsonParse(candidate: string): unknown | null {
  const t = candidate.trim();
  if (!t) return null;
  try {
    return JSON.parse(t);
  } catch {
    try {
      return JSON.parse(jsonrepair(t));
    } catch {
      return null;
    }
  }
}

/**
 * 모델 텍스트에서 JSON 추출·복구(jsonrepair)·파싱.
 * `files` 응답은 앞부분 잡담·펜스 뒤에 `{ "files":` 가 오는 경우가 많아 anchor로 정렬한다.
 */
function parseJsonFromModelText(
  raw: string,
  options?: { filesAnchor?: boolean }
): unknown {
  let peeled = peelOuterMarkdownJsonFences(raw.trim());
  peeled = trimToJsonStart(peeled, options?.filesAnchor ? FILES_JSON_ANCHOR : null);

  const balanced = sliceBalancedJsonObject(peeled);
  const candidates = [balanced, peeled.trim()].filter((s): s is string => !!s?.length);

  for (const c of candidates) {
    const parsed = tryJsonParse(c);
    if (parsed !== null) return parsed;
  }

  const head = peeled.slice(0, 200);
  const tail = peeled.slice(Math.max(0, peeled.length - 120));
  throw new Error(
    `JSON 복구 실패 (길이 ${peeled.length}자). 앞: ${head}… 끝: …${tail}`
  );
}

const FILES_JSON_FALLBACK_SUFFIX = `

---
위 작업 결과만 출력하세요. 설명·마크다운·코드펜스 금지.
반드시 단일 JSON 객체이고, 첫 문자는 { 이어야 합니다.
스키마: { "files": [ { "path": string, "content": string }, ... ] }
files는 비어 있지 않은 배열이어야 합니다.
각 파일 content 문자열 안의 따옴표·줄바꿈·역슬래시는 JSON 규칙대로 반드시 이스케이프(\\", \\n, \\\\) 하세요.
응답이 출력 토큰 한도로 잘리지 않게, 불필요한 공백·주석은 넣지 마세요.`;

const FILES_JSON_RETRY_SUFFIX = `

이전 출력은 JSON.parse/jsonrepair로도 복구할 수 없을 만큼 불완전했습니다.
동일 요구로 **문법적으로 완결된 단일 JSON 한 개만** 다시 출력하세요.
닫는 ] 와 } 까지 포함하고, 문자열은 반드시 유효하게 이스케이프하세요.`;

const DESIGN_JSON_FALLBACK_SUFFIX = `

---
위 작업 결과만 출력하세요. 설명·마크다운·코드펜스 금지.
반드시 단일 JSON 객체이고, 첫 문자는 { 이어야 합니다.
스키마: { "appName": string, "coreFeatures": string[], "pages": {name,purpose}[], "dataStructure": {entity, fields[]}[] }`;

const DESIGN_JSON_RETRY_SUFFIX = `

이전 출력이 불완전한 JSON이었습니다. 동일 요구로 문법적으로 완결된 단일 JSON만 다시 출력하세요.`;

function fallbackMaxTokensForFiles(requested?: number): number {
  const base = requested ?? 16_384;
  return Math.min(Math.max(base * 2, 16_384), 64_000);
}

/**
 * Anthropic에서 `generateObject`가 `{}`로 끝나 `files` 검증에 실패하는 경우가 있어,
 * `mode: "tool"` 한 번 시도 후 `generateText` + 복구 파싱 + Zod 검증으로 폴백한다.
 */
export async function generateAgentFilesObject(params: {
  model: LanguageModel;
  system: string;
  prompt: string;
  maxTokens?: number;
}): Promise<{ object: AgentFilesOutput }> {
  try {
    const result = await generateObject({
      model: params.model,
      schema: agentFilesSchema,
      system: params.system,
      prompt: params.prompt,
      maxTokens: params.maxTokens,
      mode: "tool",
      schemaName: "ProjectSourceFiles",
      schemaDescription:
        "Next.js 프로젝트 소스. 최상위 키 files는 필수이며 비어 있지 않은 배열. 각 원소는 path(루트 기준 상대 경로)와 content(파일 전체 문자열)를 포함.",
    });
    return { object: result.object };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!isStructuredOutputFailure(msg)) throw e;
    console.warn(
      "[generateAgentFilesObject] generateObject(tool) 실패, generateText 폴백:",
      msg.slice(0, 280)
    );

    const maxTokens = fallbackMaxTokensForFiles(params.maxTokens);
    let lastErr: unknown = e;

    for (let attempt = 0; attempt < 2; attempt++) {
      const extra =
        attempt === 0 ? FILES_JSON_FALLBACK_SUFFIX : FILES_JSON_RETRY_SUFFIX;
      const { text } = await generateText({
        model: params.model,
        system: `${params.system}\n\n출력은 유효한 JSON 객체 하나뿐이어야 합니다.`,
        prompt: params.prompt + extra,
        maxTokens,
        temperature: 0,
      });
      if (!text?.trim()) continue;
      try {
        const parsed = parseJsonFromModelText(text, { filesAnchor: true });
        const object = agentFilesSchema.parse(parsed);
        return { object };
      } catch (parseErr) {
        lastErr = parseErr;
        console.warn(
          `[generateAgentFilesObject] 폴백 파싱 실패 (시도 ${attempt + 1}/2):`,
          parseErr instanceof Error ? parseErr.message : String(parseErr)
        );
      }
    }

    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }
}

export async function generateDesignDocObject(params: {
  model: LanguageModel;
  system: string;
  prompt: string;
  maxTokens?: number;
}): Promise<{ object: DesignDocOutput }> {
  try {
    const result = await generateObject({
      model: params.model,
      schema: designDocSchema,
      system: params.system,
      prompt: params.prompt,
      maxTokens: params.maxTokens,
      mode: "tool",
      schemaName: "AppDesignDoc",
      schemaDescription:
        "앱 설계서. appName, coreFeatures(3~5개), pages, dataStructure 필드를 모두 채울 것.",
    });
    return { object: result.object };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!isStructuredOutputFailure(msg)) throw e;
    console.warn(
      "[generateDesignDocObject] generateObject(tool) 실패, generateText 폴백:",
      msg.slice(0, 280)
    );

    const maxTokens = Math.min(Math.max((params.maxTokens ?? 2048) * 2, 4096), 16_384);
    let lastErr: unknown = e;

    for (let attempt = 0; attempt < 2; attempt++) {
      const extra =
        attempt === 0 ? DESIGN_JSON_FALLBACK_SUFFIX : DESIGN_JSON_RETRY_SUFFIX;
      const { text } = await generateText({
        model: params.model,
        system: `${params.system}\n\n출력은 유효한 JSON 객체 하나뿐이어야 합니다.`,
        prompt: params.prompt + extra,
        maxTokens,
        temperature: 0,
      });
      if (!text?.trim()) continue;
      try {
        const parsed = parseJsonFromModelText(text);
        const object = designDocSchema.parse(parsed);
        return { object };
      } catch (parseErr) {
        lastErr = parseErr;
        console.warn(
          `[generateDesignDocObject] 폴백 파싱 실패 (시도 ${attempt + 1}/2):`,
          parseErr instanceof Error ? parseErr.message : String(parseErr)
        );
      }
    }

    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }
}
