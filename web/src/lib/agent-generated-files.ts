import { stripUnusedReactStateSetters } from "./strip-unused-react-state-setters";

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
