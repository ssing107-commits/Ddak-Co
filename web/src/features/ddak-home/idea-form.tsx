"use client";

import { FormEvent } from "react";

import { Button } from "@/components/ui/button";

import type { AppPhase } from "./types";

type IdeaFormProps = {
  idea: string;
  onIdeaChange: (value: string) => void;
  onSubmit: (e: FormEvent) => void;
  busy: boolean;
  running: boolean;
  phase: AppPhase;
};

export function IdeaForm({
  idea,
  onIdeaChange,
  onSubmit,
  busy,
  running,
  phase,
}: IdeaFormProps) {
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <input
        type="text"
        value={idea}
        onChange={(e) => onIdeaChange(e.target.value)}
        placeholder="프로젝트 아이디어를 한 줄로 입력"
        maxLength={2000}
        disabled={busy || running}
        aria-label="프로젝트 아이디어"
        className="w-full rounded-lg border border-input bg-card px-3 py-2.5 text-base text-foreground shadow-sm outline-none ring-ring/0 transition focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
      />
      <Button type="submit" disabled={busy || !idea.trim() || running}>
        {busy && phase === "planning" ? "기획 생성 중…" : "기획 확인 시작"}
      </Button>
    </form>
  );
}
