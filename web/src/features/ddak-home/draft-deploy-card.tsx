"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import type { AppPhase } from "./types";

type DraftDeployCardProps = {
  draftDeployUrl: string;
  busy: boolean;
  phase: AppPhase;
  onContinue: () => void;
};

export function DraftDeployCard({
  draftDeployUrl,
  busy,
  phase,
  onContinue,
}: DraftDeployCardProps) {
  return (
    <Card className="border-border bg-card shadow-md">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">2단계 초안 배포 완료</CardTitle>
        <CardDescription>
          빠른 초안 URL입니다. 확인 후 계속 진행하기를 눌러 주세요.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <a
          href={draftDeployUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="break-all text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          {draftDeployUrl}
        </a>
      </CardContent>
      <CardFooter className="flex w-full gap-2">
        <Button asChild variant="secondary" className="flex-1">
          <a href={draftDeployUrl} target="_blank" rel="noopener noreferrer">
            초안 보기
          </a>
        </Button>
        <Button
          type="button"
          className="flex-1"
          disabled={busy || phase === "final-running" || phase === "done"}
          onClick={onContinue}
        >
          계속 진행하기
        </Button>
      </CardFooter>
    </Card>
  );
}
