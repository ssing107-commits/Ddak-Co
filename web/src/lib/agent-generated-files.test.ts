import { describe, expect, it } from "vitest";

import {
  postProcessAgentFile,
  removeNextConfigLooseBuildSkips,
  sanitizeAgentTsConfigJson,
} from "./agent-generated-files";

describe("removeNextConfigLooseBuildSkips", () => {
  it("typescript ignoreBuildErrors 블록을 제거한다", () => {
    const src = `export default {\n  typescript: { ignoreBuildErrors: true },\n};`;
    expect(removeNextConfigLooseBuildSkips(src)).not.toContain("ignoreBuildErrors");
  });

  it("eslint ignoreDuringBuilds 블록을 제거한다", () => {
    const src = `export default {\n  eslint: { ignoreDuringBuilds: true },\n};`;
    expect(removeNextConfigLooseBuildSkips(src)).not.toContain("ignoreDuringBuilds");
  });
});

describe("sanitizeAgentTsConfigJson", () => {
  it("useDefineForEnumMembers를 제거한다", () => {
    const raw = JSON.stringify(
      {
        compilerOptions: {
          strict: true,
          useDefineForEnumMembers: true,
          jsx: "preserve",
        },
      },
      null,
      2
    );
    const out = sanitizeAgentTsConfigJson(raw);
    expect(out).not.toContain("useDefineForEnumMembers");
    expect(out).toContain('"strict": true');
  });
});

describe("postProcessAgentFile", () => {
  it("next.config.mjs에 느슨한 빌드 스킵 제거를 적용한다", () => {
    const cfg = `export default {\n  typescript: { ignoreBuildErrors: true },\n};`;
    const out = postProcessAgentFile("next.config.mjs", cfg);
    expect(out).not.toContain("ignoreBuildErrors");
  });

  it("tsx에는 미사용 setter 정리를 적용한다", () => {
    const src = `const [x, setX] = useState(0);\nexport default function A(){ return x; }`;
    const out = postProcessAgentFile("app/a.tsx", src);
    expect(out).toContain("const [x] = useState");
  });

  it("tsconfig.json에서 useDefineForEnumMembers를 제거한다", () => {
    const cfg = `{\n  "compilerOptions": {\n    "strict": true,\n    "useDefineForEnumMembers": true\n  }\n}`;
    const out = postProcessAgentFile("tsconfig.json", cfg);
    expect(out).not.toContain("useDefineForEnumMembers");
  });
});
