"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type AgentLogAsideProps = {
  logMessages: string[];
  busy: boolean;
};

export function AgentLogAside({ logMessages, busy }: AgentLogAsideProps) {
  return (
    <aside className="mx-auto w-full max-w-lg shrink-0 lg:sticky lg:top-8 lg:mx-0 lg:max-w-sm lg:self-start">
      <Card className="border-border bg-card shadow-md">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">에이전트 작업 로그</CardTitle>
          <CardDescription>
            단계별 진행 상태를 실시간으로 보여줍니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul
            className="max-h-[min(420px,50vh)] space-y-3 overflow-y-auto pr-1"
            aria-live="polite"
            aria-label="에이전트 작업 로그 목록"
          >
            {logMessages.map((line, i) => (
              <li
                key={`${i}-${line.slice(0, 12)}`}
                className="border-l-2 border-primary/40 pl-3 text-sm leading-relaxed text-card-foreground"
                style={{ animation: "logFade 0.35s ease-out" }}
              >
                {line}
              </li>
            ))}
          </ul>
          {busy && (
            <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
              ☁️ GitHub 레포 생성/푸시 및 Vercel 배포를 진행 중입니다. 수 분
              걸릴 수 있습니다…
            </p>
          )}
        </CardContent>
      </Card>
    </aside>
  );
}
