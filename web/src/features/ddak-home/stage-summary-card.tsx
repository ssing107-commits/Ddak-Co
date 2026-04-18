"use client";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type StageRow = { title: string; state: string };

type StageSummaryCardProps = {
  rows: readonly StageRow[];
};

export function StageSummaryCard({ rows }: StageSummaryCardProps) {
  return (
    <Card className="border-border bg-card shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">진행 단계</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2 text-sm">
          {rows.map((row) => (
            <li key={row.title} className="flex items-center justify-between">
              <span>{row.title}</span>
              <span className="text-muted-foreground">{row.state}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
