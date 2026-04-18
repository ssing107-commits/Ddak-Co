export const ROLE_STORAGE_KEY = "ddakco:user-role";

export const ROLE_OPTIONS = [
  { id: "solo-founder", label: "개인사업자 / 1인 창업자", emoji: "👤" },
  { id: "hr", label: "인사팀", emoji: "🏢" },
  { id: "ops-procurement", label: "총무팀 / 구매팀", emoji: "📦" },
  { id: "finance", label: "재무팀 / 회계팀", emoji: "💰" },
  { id: "marketing", label: "마케팅팀", emoji: "📣" },
] as const;

export const COMPLETE_MESSAGE = "🎉 완성 배포가 끝났습니다.";
