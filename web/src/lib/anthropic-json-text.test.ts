import { describe, expect, it } from "vitest";

import { peelOuterMarkdownJsonFences, sliceGreedyJsonObject } from "./anthropic-json-text";

describe("peelOuterMarkdownJsonFences", () => {
  it("펜스 없이 순수 JSON이면 그대로 반환한다", () => {
    const raw = `  {"ok":true}  `;
    expect(peelOuterMarkdownJsonFences(raw)).toBe('{"ok":true}');
  });

  it("바깥 한 겹 ```json 펜스를 제거한다", () => {
    const raw = "```json\n{\"a\":1}\n```";
    expect(peelOuterMarkdownJsonFences(raw)).toBe('{"a":1}');
  });

  it("``` 펜스(json 라벨 없이)도 제거한다", () => {
    const raw = "```\n{\"b\":2}\n```";
    expect(peelOuterMarkdownJsonFences(raw)).toBe('{"b":2}');
  });

  it("펜스가 여러 겹이면 반복 제거한다", () => {
    const raw = "```json\n```json\n{\"c\":3}\n```\n```";
    expect(peelOuterMarkdownJsonFences(raw)).toBe('{"c":3}');
  });

  it("빈 문자열은 빈 문자열로 끝난다", () => {
    expect(peelOuterMarkdownJsonFences("")).toBe("");
  });
});

describe("sliceGreedyJsonObject", () => {
  it("앞뒤 잡담이 있어도 첫 {부터 마지막 }까지 잘라낸다", () => {
    const raw = '설명입니다.\n{"files":[]}\n끝.';
    expect(sliceGreedyJsonObject(raw)).toBe('{"files":[]}');
  });

  it("중괄호가 없으면 원문을 그대로 반환한다", () => {
    expect(sliceGreedyJsonObject("no braces")).toBe("no braces");
  });
});
