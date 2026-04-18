"use client";

import {
  FeatureSelectionCards,
  type EditableFeature,
} from "@/components/feature-selection-cards";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import type { AppPhase, DesignDoc } from "./types";

type DesignDocCardProps = {
  designDoc: DesignDoc;
  featureDrafts: EditableFeature[];
  onToggleFeature: (id: string, checked: boolean) => void;
  onFeatureTextChange: (id: string, text: string) => void;
  onStartDraft: () => void;
  busy: boolean;
  running: boolean;
  anyFeatureSelected: boolean;
  phase: AppPhase;
};

export function DesignDocCard({
  designDoc,
  featureDrafts,
  onToggleFeature,
  onFeatureTextChange,
  onStartDraft,
  busy,
  running,
  anyFeatureSelected,
  phase,
}: DesignDocCardProps) {
  return (
    <Card className="border-border bg-card shadow-md">
      <CardHeader className="pb-4">
        <CardDescription>프로젝트명</CardDescription>
        <CardTitle className="text-xl">{designDoc.appName}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            추천 기능 선택/수정
          </p>
          <FeatureSelectionCards
            items={featureDrafts}
            disabled={busy || running}
            onToggle={onToggleFeature}
            onTextChange={onFeatureTextChange}
          />
        </div>
      </CardContent>
      <CardFooter className="flex w-full flex-col gap-2 pt-2">
        <Button
          type="button"
          className="w-full"
          size="lg"
          disabled={
            busy || running || !anyFeatureSelected || phase !== "planning"
          }
          onClick={onStartDraft}
        >
          만들기 시작
        </Button>
      </CardFooter>
    </Card>
  );
}
