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

import { ROLE_OPTIONS } from "./constants";

type RoleGateProps = {
  customRoleInput: string;
  onCustomRoleInputChange: (value: string) => void;
  onSaveRole: (role: string) => void;
};

export function RoleGate({
  customRoleInput,
  onCustomRoleInputChange,
  onSaveRole,
}: RoleGateProps) {
  const canSaveCustomRole = customRoleInput.trim().length > 0;

  return (
    <div className="min-h-full flex items-center justify-center bg-background px-4 py-10">
      <Card className="w-full max-w-2xl border-border bg-card shadow-md">
        <CardHeader className="space-y-2">
          <CardTitle className="text-xl">어떤 팀/역할이신가요?</CardTitle>
          <CardDescription>
            선택한 유형은 기획서 기능 추천 우선순위에 반영됩니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {ROLE_OPTIONS.map((role) => (
              <button
                key={role.id}
                type="button"
                onClick={() => onSaveRole(role.label)}
                className="flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-3 text-left text-sm transition hover:border-primary/60 hover:bg-muted/40"
              >
                <span aria-hidden>{role.emoji}</span>
                <span>{role.label}</span>
              </button>
            ))}
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="mb-2 text-sm font-medium">⚙️ 기타 (직접 입력)</p>
            <div className="flex gap-2">
              <input
                type="text"
                value={customRoleInput}
                onChange={(e) => onCustomRoleInputChange(e.target.value)}
                placeholder="예: CS팀, 운영기획, 연구소..."
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring"
              />
              <Button
                type="button"
                disabled={!canSaveCustomRole}
                onClick={() => onSaveRole(customRoleInput.trim())}
              >
                저장
              </Button>
            </div>
          </div>
        </CardContent>
        <CardFooter className="justify-between text-xs text-muted-foreground">
          <span>
            나중에 localStorage에서 값을 지우면 다시 선택할 수 있습니다.
          </span>
        </CardFooter>
      </Card>
    </div>
  );
}
