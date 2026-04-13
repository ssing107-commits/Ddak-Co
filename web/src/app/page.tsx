"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

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

type WorkflowPhase = "brief" | "agents" | "done";

const AGENT_LOG_MESSAGES = [
  "📋 PM이 기획서를 검토하고 있습니다...",
  "🎨 디자인 에이전트가 UI를 설계 중입니다...",
  "⚙️ 백엔드 에이전트가 데이터 구조를 설계 중입니다...",
  "💻 프론트엔드 에이전트가 화면을 개발 중입니다...",
  "✅ QA 에이전트가 검토 완료했습니다! 곧 완성됩니다.",
] as const;

const COMPLETE_MESSAGE = "🎉 완성! 사장님의 앱이 준비됐습니다.";

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
  const [workflow, setWorkflow] = useState<WorkflowPhase>("brief");
  const [logMessages, setLogMessages] = useState<string[]>([]);
  const [runId, setRunId] = useState(0);
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    if (runId === 0) return;

    timeoutsRef.current.forEach(clearTimeout);
    timeoutsRef.current = [];

    setLogMessages([]);

    AGENT_LOG_MESSAGES.forEach((msg, i) => {
      const id = setTimeout(() => {
        setLogMessages((prev) => [...prev, msg]);
      }, i * 1000);
      timeoutsRef.current.push(id);
    });

    const doneId = setTimeout(() => {
      setWorkflow("done");
    }, AGENT_LOG_MESSAGES.length * 1000);

    timeoutsRef.current.push(doneId);

    return () => {
      timeoutsRef.current.forEach(clearTimeout);
      timeoutsRef.current = [];
    };
  }, [runId]);

  function startAgentRun() {
    setWorkflow("agents");
    setRunId((n) => n + 1);
  }

  function backToBrief() {
    timeoutsRef.current.forEach(clearTimeout);
    timeoutsRef.current = [];
    setWorkflow("brief");
    setLogMessages([]);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBrief(null);
    setFeatureChecked([]);
    setWorkflow("brief");
    setLogMessages([]);
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

  if (workflow === "done") {
    return (
      <div className="min-h-full flex flex-col items-center justify-center bg-background px-6 py-16">
        <div className="flex max-w-md flex-col items-center gap-6 text-center">
          <span className="text-5xl" aria-hidden>
            🎉
          </span>
          <p className="text-xl font-semibold leading-snug text-foreground">
            {COMPLETE_MESSAGE}
          </p>
          <Button type="button" size="lg" onClick={backToBrief}>
            기획서로 돌아가기
          </Button>
        </div>
      </div>
    );
  }

  const agentRunning = workflow === "agents";
  const anyFeatureSelected = featureChecked.some(Boolean);

  return (
    <div className="min-h-full bg-background px-4 py-10 lg:py-12">
      <div
        className={`mx-auto flex w-full max-w-6xl flex-col gap-8 ${agentRunning ? "lg:flex-row lg:items-start lg:gap-10" : ""}`}
      >
        <div
          className={`mx-auto w-full max-w-lg shrink-0 space-y-8 ${agentRunning ? "lg:mx-0" : ""}`}
        >
          <h1 className="text-center text-2xl font-semibold tracking-tight text-foreground lg:text-left">
            딱코
          </h1>

          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            <input
              type="text"
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              placeholder="프로젝트 아이디어를 한 줄로 입력"
              maxLength={2000}
              disabled={loading || agentRunning}
              aria-label="프로젝트 아이디어"
              className="w-full rounded-lg border border-input bg-card px-3 py-2.5 text-base text-foreground shadow-sm outline-none ring-ring/0 transition focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            />
            <Button
              type="submit"
              disabled={loading || !idea.trim() || agentRunning}
            >
              {loading ? "생성 중…" : "기획서 만들기"}
            </Button>
          </form>

          {error && (
            <p className="text-center text-sm text-destructive lg:text-left">
              {error}
            </p>
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
                            disabled={agentRunning}
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
                            className={`min-w-0 flex-1 leading-snug ${agentRunning ? "cursor-default opacity-80" : "cursor-pointer"}`}
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
                <Button
                  type="button"
                  className="w-full"
                  size="lg"
                  disabled={agentRunning || !anyFeatureSelected}
                  onClick={startAgentRun}
                >
                  이 기능들로 개발 시작하기
                </Button>
              </CardFooter>
            </Card>
          )}
        </div>

        {agentRunning && (
          <aside className="mx-auto w-full max-w-lg shrink-0 lg:sticky lg:top-8 lg:mx-0 lg:max-w-sm lg:self-start">
            <Card className="border-border bg-card shadow-md">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">에이전트 작업 로그</CardTitle>
                <CardDescription>
                  선택한 기능을 바탕으로 에이전트가 순차적으로 작업합니다.
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
                      style={{
                        animation: "logFade 0.35s ease-out",
                      }}
                    >
                      {line}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </aside>
        )}
      </div>
    </div>
  );
}
