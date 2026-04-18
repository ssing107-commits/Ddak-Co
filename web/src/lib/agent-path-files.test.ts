import { describe, expect, it } from "vitest";

import { normalizePathContentFiles } from "./agent-path-files";

describe("normalizePathContentFiles", () => {
  it("undefined/null/비배열이면 빈 배열", () => {
    expect(normalizePathContentFiles(undefined)).toEqual([]);
    expect(normalizePathContentFiles(null)).toEqual([]);
    expect(normalizePathContentFiles({})).toEqual([]);
    expect(normalizePathContentFiles("x")).toEqual([]);
  });

  it("빈 배열이면 빈 배열", () => {
    expect(normalizePathContentFiles([])).toEqual([]);
  });

  it("path·content가 모두 있으면 정규화해 반환", () => {
    expect(
      normalizePathContentFiles([
        { path: "app/page.tsx", content: "export default function Page(){}" },
      ])
    ).toEqual([
      { path: "app/page.tsx", content: "export default function Page(){}" },
    ]);
  });

  it("백슬래시 경로를 슬래시로 바꾼다", () => {
    expect(
      normalizePathContentFiles([{ path: "app\\foo\\page.tsx", content: "x" }])
    ).toEqual([{ path: "app/foo/page.tsx", content: "x" }]);
  });

  it("path만 있거나 content만 있으면 제외", () => {
    expect(
      normalizePathContentFiles([
        { path: "a.ts", content: "" },
        { path: "", content: "body" },
        { path: "ok.ts", content: "ok" },
      ])
    ).toEqual([{ path: "ok.ts", content: "ok" }]);
  });

  it("문자열·배열 요소는 무시", () => {
    expect(
      normalizePathContentFiles(["skip", { path: "p.ts", content: "c" }, 42, null])
    ).toEqual([{ path: "p.ts", content: "c" }]);
  });
});
