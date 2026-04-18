/**
 * setter가 선언부에만 등장하는 useState 구문을 const [value] = useState 로 줄인다.
 * (에이전트 생성 코드의 미사용 setter TS 경고 완화용)
 */
export function stripUnusedReactStateSetters(content: string): string {
  const stateDecl =
    /const\s*\[\s*([A-Za-z_$][\w$]*)\s*,\s*(set[A-Za-z_$][\w$]*)\s*\]\s*=\s*useState\b/g;
  let out = content;
  let match: RegExpExecArray | null;
  while ((match = stateDecl.exec(content)) !== null) {
    const valueName = match[1];
    const setterName = match[2];
    const setterUsage = (content.match(new RegExp(`\\b${setterName}\\b`, "g")) || []).length;
    if (setterUsage === 1) {
      const exactDecl = new RegExp(
        `const\\s*\\[\\s*${valueName}\\s*,\\s*${setterName}\\s*\\]\\s*=\\s*useState\\b`,
        "g"
      );
      out = out.replace(exactDecl, `const [${valueName}] = useState`);
    }
  }
  return out;
}
