"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";

export type EditableFeature = {
  id: string;
  text: string;
  checked: boolean;
};

type FeatureSelectionCardsProps = {
  items: EditableFeature[];
  disabled?: boolean;
  onToggle: (id: string, checked: boolean) => void;
  onTextChange: (id: string, text: string) => void;
};

export function FeatureSelectionCards({
  items,
  disabled = false,
  onToggle,
  onTextChange,
}: FeatureSelectionCardsProps) {
  return (
    <ul className="space-y-3">
      {items.map((item, i) => {
        const checkboxId = `selected-feature-${item.id}`;
        return (
          <li key={item.id}>
            <Card className={item.checked ? "border-primary/50" : "border-border"}>
              <CardContent className="space-y-3 p-4">
                <div className="flex items-center gap-3">
                  <Checkbox
                    id={checkboxId}
                    checked={item.checked}
                    disabled={disabled}
                    onCheckedChange={(v) => onToggle(item.id, v === true)}
                  />
                  <label
                    htmlFor={checkboxId}
                    className={`text-sm font-medium ${disabled ? "cursor-default opacity-80" : "cursor-pointer"}`}
                  >
                    추천 기능 {i + 1}
                  </label>
                </div>
                <input
                  type="text"
                  value={item.text}
                  disabled={disabled}
                  onChange={(e) => onTextChange(item.id, e.target.value)}
                  placeholder="기능 설명을 입력하세요"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring"
                />
              </CardContent>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}

