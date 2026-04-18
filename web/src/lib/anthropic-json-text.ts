/**
 * Claude 등이 붙이는 바깥쪽 ```json / ``` 마크다운 펜스를 반복 제거한다.
 */
export function peelOuterMarkdownJsonFences(text: string): string {
  let t = text.trim();
  let prev = "";
  while (prev !== t) {
    prev = t;
    t = t
      .replace(/^```(?:json)?\s*\r?\n?/i, "")
      .replace(/\r?\n?\s*```\s*$/i, "")
      .trim();
  }
  return t;
}

/**
 * 앞뒤 설명 문장이 섞인 응답에서 `{ ... }` 구간을 탐욕적으로 잘라 JSON.parse 후보로 쓴다.
 */
export function sliceGreedyJsonObject(text: string): string {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  return jsonMatch ? jsonMatch[0] : text;
}
