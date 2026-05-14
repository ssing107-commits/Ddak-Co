import { jsonrepair } from "jsonrepair";

import { peelOuterMarkdownJsonFences, sliceGreedyJsonObject } from "@/lib/anthropic-json-text";

/** `# 설명` 등 앞부분을 잘라 `{"files":` 로 시작하도록 함 */
export function stripToLeadingFilesJson(text: string): string {
  const m = text.match(/\{\s*"files"\s*:/);
  if (!m || m.index === undefined) return text.trim();
  return text.slice(m.index).trim();
}

function extractBalancedJsonObjectFallback(text: string): string | null {
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first < 0 || last <= first) return null;
  return text.slice(first, last + 1);
}

function extractJsonCandidates(originalRaw: string, preprocessed: string): string[] {
  const candidates: string[] = [];
  const pushUnique = (value: string) => {
    const v = value.trim();
    if (!v) return;
    if (!candidates.includes(v)) candidates.push(v);
  };

  const anchored = stripToLeadingFilesJson(originalRaw);
  const peeledAnchored = peelOuterMarkdownJsonFences(anchored);
  const greedyAnchored = sliceGreedyJsonObject(peeledAnchored);

  const pushJsonLike = (value: string) => {
    const v = value.trim();
    if (!v.startsWith("{")) return;
    pushUnique(v);
  };

  pushJsonLike(peeledAnchored);
  pushJsonLike(greedyAnchored);
  pushJsonLike(anchored);

  const jsonFence = /```json\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = jsonFence.exec(originalRaw)) !== null) {
    pushJsonLike(match[1]);
  }

  const genericFence = /```\s*([\s\S]*?)```/gi;
  while ((match = genericFence.exec(originalRaw)) !== null) {
    pushJsonLike(match[1]);
  }

  pushJsonLike(preprocessed);
  pushJsonLike(peelOuterMarkdownJsonFences(originalRaw));
  pushJsonLike(sliceGreedyJsonObject(preprocessed));
  pushJsonLike(sliceGreedyJsonObject(originalRaw));

  const bracePre = extractBalancedJsonObjectFallback(peeledAnchored);
  if (bracePre) pushJsonLike(bracePre);

  const braceOrig = extractBalancedJsonObjectFallback(originalRaw);
  if (braceOrig) pushJsonLike(braceOrig);

  return candidates;
}

function formatParseError(e: unknown): string {
  if (e instanceof Error) {
    return `${e.name}: ${e.message}${e.stack ? `\n${e.stack}` : ""}`;
  }
  return String(e);
}

/**
 * 에이전트가 `{"files":[...]}` 형태로 줘야 하는 응답을 마크다운·깨진 JSON까지 복구해 파싱한다.
 * @param errorLabel 예: "코드 생성", "UI 개선"
 */
export function parseAgentFilesJsonResponse(rawText: string, errorLabel: string): unknown {
  const preprocessed = peelOuterMarkdownJsonFences(stripToLeadingFilesJson(rawText));
  const candidates = extractJsonCandidates(rawText, preprocessed);
  const attemptErrors: string[] = [];

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    const label = `#${i + 1}`;
    try {
      return JSON.parse(candidate);
    } catch (e1) {
      try {
        const repaired = jsonrepair(candidate);
        return JSON.parse(repaired);
      } catch (e2) {
        attemptErrors.push(
          `${label} candidate(앞 400자): ${candidate.slice(0, 400).replace(/\s+/g, " ")}\n` +
            `  JSON.parse: ${formatParseError(e1)}\n` +
            `  jsonrepair+JSON.parse: ${formatParseError(e2)}`
        );
      }
    }
  }

  const rawHead = rawText.slice(0, 1500);
  throw new Error(
    `${errorLabel} 응답 JSON 파싱에 실패했습니다.\n` +
      `시도별 parseError(전체):\n${attemptErrors.join("\n---\n")}\n` +
      `raw(앞 1500자):\n${rawHead}`
  );
}
