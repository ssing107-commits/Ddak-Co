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

import { COMPLETE_MESSAGE } from "./constants";

type FinalDeployCardProps = {
  finalDeployUrl: string;
  onReset: () => void;
};

export function FinalDeployCard({
  finalDeployUrl,
  onReset,
}: FinalDeployCardProps) {
  return (
    <Card className="border-border bg-card shadow-md">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{COMPLETE_MESSAGE}</CardTitle>
        <CardDescription>
          동일 레포 업데이트 후 최종 재배포 URL입니다.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <a
          href={finalDeployUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="break-all text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          {finalDeployUrl}
        </a>
      </CardContent>
      <CardFooter className="flex w-full gap-2">
        <Button asChild className="flex-1">
          <a href={finalDeployUrl} target="_blank" rel="noopener noreferrer">
            최종 앱 열기
          </a>
        </Button>
        <Button type="button" variant="secondary" className="flex-1" onClick={onReset}>
          새로 시작
        </Button>
      </CardFooter>
    </Card>
  );
}
