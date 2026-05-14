import { generateObject } from "ai";
import type { LanguageModel } from "ai";

import { agentFilesSchema, designDocSchema } from "@/lib/agent-schemas";

function isRetryableStructuredOutputError(message: string): boolean {
  return (
    message.includes("Type validation failed") ||
    message.includes("No object generated") ||
    message.includes("did not return a response") ||
    message.includes("could not parse") ||
    message.includes("Invalid JSON")
  );
}

/** Anthropic은 json 모드 구조화 생성 미지원 → tool 우선, 검증 실패 시 auto만 재시도 */
export async function generateAgentFilesObject(params: {
  model: LanguageModel;
  system: string;
  prompt: string;
  maxTokens?: number;
}) {
  const modes = ["tool", "auto"] as const;
  let lastErr: unknown;
  for (const mode of modes) {
    try {
      return await generateObject({
        model: params.model,
        schema: agentFilesSchema,
        system: params.system,
        prompt: params.prompt,
        maxTokens: params.maxTokens,
        mode,
        schemaName: "ProjectSourceFiles",
        schemaDescription:
          "Next.js 프로젝트 소스. 최상위 키 files는 필수이며 비어 있지 않은 배열. 각 원소는 path(루트 기준 상대 경로)와 content(파일 전체 문자열)를 포함.",
      });
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      if (mode === "auto" || !isRetryableStructuredOutputError(msg)) {
        throw e;
      }
      console.warn(
        `[generateAgentFilesObject] mode=${mode} 실패, auto 모드로 재시도:`,
        msg.slice(0, 280)
      );
    }
  }
  throw lastErr;
}

export async function generateDesignDocObject(params: {
  model: LanguageModel;
  system: string;
  prompt: string;
  maxTokens?: number;
}) {
  const modes = ["tool", "auto"] as const;
  let lastErr: unknown;
  for (const mode of modes) {
    try {
      return await generateObject({
        model: params.model,
        schema: designDocSchema,
        system: params.system,
        prompt: params.prompt,
        maxTokens: params.maxTokens,
        mode,
        schemaName: "AppDesignDoc",
        schemaDescription:
          "앱 설계서. appName, coreFeatures(3~5개), pages, dataStructure 필드를 모두 채울 것.",
      });
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      if (mode === "auto" || !isRetryableStructuredOutputError(msg)) {
        throw e;
      }
      console.warn(
        `[generateDesignDocObject] mode=${mode} 실패, auto 모드로 재시도:`,
        msg.slice(0, 280)
      );
    }
  }
  throw lastErr;
}
