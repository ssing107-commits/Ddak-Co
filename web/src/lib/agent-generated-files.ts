import { stripUnusedReactStateSetters } from "./strip-unused-react-state-setters";

function isTsConfigRootPath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/").trim();
  return normalized === "tsconfig.json" || normalized.endsWith("/tsconfig.json");
}

/** Next 14 기본 빌드에서 거부되는 compilerOptions 제거 */
export function sanitizeAgentTsConfigJson(content: string): string {
  const trimmed = content.trim();
  const stripKeys = (obj: Record<string, unknown>) => {
    const co = obj.compilerOptions;
    if (co && typeof co === "object" && !Array.isArray(co)) {
      const opts = { ...(co as Record<string, unknown>) };
      delete opts.useDefineForEnumMembers;
      obj.compilerOptions = opts;
    }
    return obj;
  };
  try {
    const j = JSON.parse(trimmed) as Record<string, unknown>;
    return `${JSON.stringify(stripKeys(j), null, 2)}\n`;
  } catch {
    let out = trimmed;
    out = out.replace(/"useDefineForEnumMembers"\s*:\s*(true|false)\s*,?/g, "");
    out = out.replace(/,(\s*[}\]])/g, "$1");
    return out;
  }
}

/** next.config.mjs 등에서 빌드/린트 무시 플래그 제거 (Vercel 빌드 통과용) */
export function removeNextConfigLooseBuildSkips(content: string): string {
  return content
    .replace(/\n\s*typescript:\s*\{\s*ignoreBuildErrors:\s*true\s*\},?/g, "")
    .replace(/\n\s*eslint:\s*\{\s*ignoreDuringBuilds:\s*true\s*\},?/g, "");
}

function isNextConfigRootPath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/").trim();
  return (
    normalized === "next.config.mjs" ||
    normalized.endsWith("/next.config.mjs")
  );
}

/** 에이전트가 반환한 단일 파일 본문 후처리 */
export function postProcessAgentFile(path: string, content: string): string {
  let out = content;
  if (/\.(ts|tsx)$/i.test(path)) {
    out = stripUnusedReactStateSetters(out);
  }
  if (isNextConfigRootPath(path)) {
    out = removeNextConfigLooseBuildSkips(out);
  }
  if (isTsConfigRootPath(path)) {
    out = sanitizeAgentTsConfigJson(out);
  }
  return out;
}

/** 파일 목록에 동일 규칙 적용 */
export function postProcessAgentFiles<T extends { path: string; content: string }>(
  files: T[]
): T[] {
  return files.map((file) => ({
    ...file,
    content: postProcessAgentFile(file.path, file.content),
  }));
}
