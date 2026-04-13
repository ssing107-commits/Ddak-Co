"use client";

import { FormEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";

type FeatureItem = {
  title: string;
  description: string;
};

type Brief = {
  projectName: string;
  features: FeatureItem[];
  timeline: string;
};

function isBriefPayload(data: unknown): data is Brief {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const o = data as Record<string, unknown>;
  if (typeof o.projectName !== "string" || typeof o.timeline !== "string")
    return false;
  if (!Array.isArray(o.features) || o.features.length !== 5) return false;
  return o.features.every(
    (f) =>
      f &&
      typeof f === "object" &&
      typeof (f as FeatureItem).title === "string" &&
      typeof (f as FeatureItem).description === "string"
  );
}

export default function Home() {
  const [idea, setIdea] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [featureChecked, setFeatureChecked] = useState<boolean[]>([]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBrief(null);
    setFeatureChecked([]);
    setLoading(true);
    try {
      const res = await fetch("/api/brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idea: idea.trim() }),
      });
      const data = (await res.json()) as Brief & { error?: string };
      if (!res.ok) {
        setError(data.error ?? "요청에 실패했습니다.");
        return;
      }
      if (!isBriefPayload(data)) {
        setError("응답 형식이 올바르지 않습니다.");
        return;
      }
      setBrief(data);
      setFeatureChecked(data.features.map(() => true));
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-full flex flex-col items-center bg-background px-4 py-16">
      <div className="w-full max-w-lg space-y-8">
        <h1 className="text-center text-2xl font-semibold tracking-tight text-foreground">
          딱코
        </h1>

        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <input
            type="text"
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            placeholder="프로젝트 아이디어를 한 줄로 입력"
            maxLength={2000}
            disabled={loading}
            aria-label="프로젝트 아이디어"
            className="w-full rounded-lg border border-input bg-card px-3 py-2.5 text-base text-foreground shadow-sm outline-none ring-ring/0 transition focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          />
          <Button type="submit" disabled={loading || !idea.trim()}>
            {loading ? "생성 중…" : "기획서 만들기"}
          </Button>
        </form>

        {error && (
          <p className="text-center text-sm text-destructive">{error}</p>
        )}

        {brief && (
          <Card className="border-border bg-card shadow-md">
            <CardHeader className="pb-4">
              <CardDescription>프로젝트명</CardDescription>
              <CardTitle className="text-xl">{brief.projectName}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  예상 일정
                </p>
                <p className="text-sm leading-relaxed whitespace-pre-wrap text-card-foreground">
                  {brief.timeline}
                </p>
              </div>
              <div>
                <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  주요 기능
                </p>
                <ul className="space-y-4">
                  {brief.features.map((f, i) => {
                    const id = `feature-${i}`;
                    return (
                      <li key={id} className="flex gap-3">
                        <Checkbox
                          id={id}
                          checked={featureChecked[i]}
                          onCheckedChange={(v) =>
                            setFeatureChecked((prev) =>
                              prev.map((c, j) =>
                                j === i ? v === true : c
                              )
                            )
                          }
                          className="mt-0.5"
                        />
                        <label
                          htmlFor={id}
                          className="min-w-0 flex-1 cursor-pointer leading-snug"
                        >
                          <span className="block font-medium text-card-foreground">
                            {f.title}
                          </span>
                          <span className="mt-1 block text-sm text-muted-foreground">
                            {f.description}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </CardContent>
            <CardFooter className="flex w-full flex-col pt-2">
              <Button type="button" className="w-full" size="lg">
                이 기능들로 개발 시작하기
              </Button>
            </CardFooter>
          </Card>
        )}
      </div>
    </div>
  );
}
