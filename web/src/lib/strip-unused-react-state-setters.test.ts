import { describe, expect, it } from "vitest";

import { stripUnusedReactStateSetters } from "./strip-unused-react-state-setters";

describe("stripUnusedReactStateSetters", () => {
  it("setter가 선언에만 있으면 한 요소 useState로 바꾼다", () => {
    const src = `const [count, setCount] = useState(0);
return <p>{count}</p>;`;
    expect(stripUnusedReactStateSetters(src)).toContain("const [count] = useState");
    expect(stripUnusedReactStateSetters(src)).not.toContain("setCount");
  });

  it("setter가 다른 곳에서도 쓰이면 그대로 둔다", () => {
    const src = `const [n, setN] = useState(0);
const inc = () => setN(n + 1);
return <button onClick={inc}>{n}</button>;`;
    expect(stripUnusedReactStateSetters(src)).toContain("setN");
  });
});
