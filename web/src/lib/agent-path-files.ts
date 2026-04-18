export type PathContentFile = {
  path: string;
  content: string;
};

/** API 본문의 files 배열을 { path, content } 목록으로 정규화한다. */
export function normalizePathContentFiles(raw: unknown): PathContentFile[] {
  const list = Array.isArray(raw) ? raw : [];
  return list
    .filter((f) => f && typeof f === "object" && !Array.isArray(f))
    .map((f) => {
      const rec = f as Record<string, unknown>;
      return {
        path:
          typeof rec.path === "string" ? rec.path.trim().replace(/\\/g, "/") : "",
        content: typeof rec.content === "string" ? rec.content : "",
      };
    })
    .filter((f) => f.path && f.content);
}
