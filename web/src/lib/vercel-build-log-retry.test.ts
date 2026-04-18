import { describe, expect, it } from "vitest";

import { shouldRetryBuildLogFetch } from "./vercel";

describe("shouldRetryBuildLogFetch", () => {
  it("빈 본문·플레이스홀더면 재시도", () => {
    expect(shouldRetryBuildLogFetch("")).toBe(true);
    expect(
      shouldRetryBuildLogFetch(
        "(빌드 로그 본문이 비어 있음 — 이벤트 API 응답에 텍스트가 없습니다.)"
      )
    ).toBe(true);
  });

  it("짧고 실패 힌트가 없으면 재시도", () => {
    const preamble =
      "Running build in Washington, D.C., USA (East) – iad1\nBuild machine configuration: 2 cores, 8 GB";
    expect(shouldRetryBuildLogFetch(preamble)).toBe(true);
  });

  it("stderr·npm 오류 등이 있으면 재시도 안 함", () => {
    expect(shouldRetryBuildLogFetch("npm ERR! code ELIFECYCLE")).toBe(false);
    expect(shouldRetryBuildLogFetch("Error: Module not found")).toBe(false);
    expect(shouldRetryBuildLogFetch("Command \"npm run build\" exited with 1")).toBe(false);
  });

  it("충분히 길면 재시도 안 함", () => {
    const long = "x".repeat(800);
    expect(shouldRetryBuildLogFetch(long)).toBe(false);
  });
});
