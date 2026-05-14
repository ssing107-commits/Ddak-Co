import { generateObject, generateText } from "ai";
import type { LanguageModel } from "ai";

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

function parseJsonFromModelText(raw: string): unknown {
  const peeled = peelOuterMarkdownJsonFences(raw.trim());
  const balanced = sliceBalancedJsonObject(peeled);
  const candidate = balanced ?? peeled.trim();
  try {
    return JSON.parse(candidate);
  } catch {
    throw new Error(`JSON.parse 실패 (앞 200자): ${candidate.slice(0, 200)}`);
  }
}

const FILES_JSON_FALLBACK_SUFFIX = `

---
위 작업 결과만 출력하세요. 설명·마크다운·코드펜스 금지.
반드시 단일 JSON 객체이고, 첫 문자는 { 이어야 합니다.
스키마: { "files": [ { "path": string, "content": string }, ... ] }
files는 비어 있지 않은 배열이어야 합니다.`;

const DESIGN_JSON_FALLBACK_SUFFIX = `

---
위 작업 결과만 출력하세요. 설명·마크다운·코드펜스 금지.
반드시 단일 JSON 객체이고, 첫 문자는 { 이어야 합니다.
스키마: { "appName": string, "coreFeatures": string[], "pages": {name,purpose}[], "dataStructure": {entity, fields[]}[] }`;

/**
 * Anthropic에서 `generateObject`가 `{}`로 끝나 `files` 검증에 실패하는 경우가 있어,
 * `mode: "tool"` 한 번 시도 후 `generateText` + Zod 검증으로 폴백한다.
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

    const { text } = await generateText({
      model: params.model,
      system: `${params.system}\n\n출력은 유효한 JSON 객체 하나뿐이어야 합니다.`,
      prompt: params.prompt + FILES_JSON_FALLBACK_SUFFIX,
      maxTokens: params.maxTokens,
    });
    if (!text?.trim()) throw e;
    const parsed = parseJsonFromModelText(text);
    const object = agentFilesSchema.parse(parsed);
    return { object };
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

    const { text } = await generateText({
      model: params.model,
      system: `${params.system}\n\n출력은 유효한 JSON 객체 하나뿐이어야 합니다.`,
      prompt: params.prompt + DESIGN_JSON_FALLBACK_SUFFIX,
      maxTokens: params.maxTokens,
    });
    if (!text?.trim()) throw e;
    const parsed = parseJsonFromModelText(text);
    const object = designDocSchema.parse(parsed);
    return { object };
  }
}
