"use client";

import { FormEvent, useEffect, useState } from "react";

import {
  EditableFeature,
  FeatureSelectionCards,
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

type WorkflowPhase = "brief" | "agents" | "done";
type DesignDoc = {
  appName: string;
  coreFeatures: string[];
  pages: Array<{ name: string; purpose: string }>;
  dataStructure: Array<{ entity: string; fields: string[] }>;
};

const ROLE_STORAGE_KEY = "ddakco:user-role";
const ROLE_OPTIONS = [
  { id: "solo-founder", label: "개인사업자 / 1인 창업자", emoji: "👤" },
  { id: "hr", label: "인사팀", emoji: "🏢" },
  { id: "ops-procurement", label: "총무팀 / 구매팀", emoji: "📦" },
  { id: "finance", label: "재무팀 / 회계팀", emoji: "💰" },
  { id: "marketing", label: "마케팅팀", emoji: "📣" },
] as const;
const COMPLETE_MESSAGE = "🎉 완성! 사장님의 앱이 준비됐습니다.";

function pickDeployUrl(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const o = data as Record<string, unknown>;

  const direct =
    (typeof o.deployUrl === "string" && o.deployUrl) ||
    (typeof o.deploymentUrl === "string" && o.deploymentUrl);
  if (direct) return direct;

  const response = o.response;
  if (response && typeof response === "object") {
    const ro = response as Record<string, unknown>;
    if (typeof ro.deployUrl === "string" && ro.deployUrl) return ro.deployUrl;
    if (typeof ro.deploymentUrl === "string" && ro.deploymentUrl) {
      return ro.deploymentUrl;
    }
  }

  const result = o.result;
  if (result && typeof result === "object") {
    const rr = result as Record<string, unknown>;
    if (typeof rr.deployUrl === "string" && rr.deployUrl) return rr.deployUrl;
    if (typeof rr.deploymentUrl === "string" && rr.deploymentUrl) {
      return rr.deploymentUrl;
    }
  }

  return undefined;
}

function isDesignPayload(data: unknown): data is DesignDoc {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const o = data as Record<string, unknown>;
  if (typeof o.appName !== "string") return false;
  if (
    !Array.isArray(o.coreFeatures) ||
    !o.coreFeatures.every((f) => typeof f === "string")
  ) {
    return false;
  }
  if (
    !Array.isArray(o.pages) ||
    !o.pages.every(
      (p) =>
        p &&
        typeof p === "object" &&
        typeof (p as { name?: unknown }).name === "string" &&
        typeof (p as { purpose?: unknown }).purpose === "string"
    )
  ) {
    return false;
  }
  if (
    !Array.isArray(o.dataStructure) ||
    !o.dataStructure.every(
      (d) =>
        d &&
        typeof d === "object" &&
        typeof (d as { entity?: unknown }).entity === "string" &&
        Array.isArray((d as { fields?: unknown[] }).fields)
    )
  ) {
    return false;
  }
  return true;
}

function buildEditableFeatures(features: string[]): EditableFeature[] {
  const stamp = Date.now().toString(36);
  return features.map((feature, i) => ({
    id: `${stamp}-${i}`,
    text: feature,
    checked: true,
  }));
}

function pickSelectedFeatures(features: EditableFeature[]): string[] {
  return features
    .filter((f) => f.checked)
    .map((f) => f.text.trim())
    .filter(Boolean);
}

export default function Home() {
  const [idea, setIdea] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [designDoc, setDesignDoc] = useState<DesignDoc | null>(null);
  const [featureDrafts, setFeatureDrafts] = useState<EditableFeature[]>([]);
  const [workflow, setWorkflow] = useState<WorkflowPhase>("brief");
  const [logMessages, setLogMessages] = useState<string[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [buildPending, setBuildPending] = useState(false);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [roleReady, setRoleReady] = useState(false);
  const [customRoleInput, setCustomRoleInput] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem(ROLE_STORAGE_KEY);
    if (saved) setUserRole(saved);
    setRoleReady(true);
  }, []);

  function saveRole(role: string) {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(ROLE_STORAGE_KEY, role);
    }
    setUserRole(role);
  }

  function backToBrief() {
    setWorkflow("brief");
    setLogMessages([]);
    setPreviewUrl(null);
    setBuildError(null);
    setBuildPending(false);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const input = idea.trim();
    if (!input) return;

    setLoading(true);
    setError(null);
    setBuildError(null);
    setPreviewUrl(null);
    setBuildPending(false);
    setLogMessages([]);
    setDesignDoc(null);
    setFeatureDrafts([]);
    setWorkflow("brief");

    try {
      const res = await fetch("/api/agent/design", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input,
          userRole: userRole ?? undefined,
        }),
      });
      const text = await res.text();
      let data: unknown;
      try {
        data = text ? (JSON.parse(text) as unknown) : {};
      } catch {
        throw new Error(`설계 API 응답이 JSON이 아닙니다. (status=${res.status})`);
      }

      if (!res.ok) {
        const message =
          data && typeof data === "object" && "error" in data
            ? String((data as { error?: unknown }).error ?? `요청 실패 (${res.status})`)
            : `요청 실패 (${res.status})`;
        throw new Error(message);
      }

      if (!isDesignPayload(data)) {
        throw new Error("설계 결과 형식이 올바르지 않습니다.");
      }

      setDesignDoc(data);
      setFeatureDrafts(buildEditableFeatures(data.coreFeatures));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "요청 처리 중 오류가 발생했습니다.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  async function startAgentRun() {
    if (!designDoc) return;
    const selectedFeatures = pickSelectedFeatures(featureDrafts);
    if (selectedFeatures.length === 0) return;

    setWorkflow("agents");
    setPreviewUrl(null);
    setBuildError(null);
    setBuildPending(true);
    setLoading(true);
    setLogMessages([]);

    const appendLog = (message: string) => {
      setLogMessages((prev) => [...prev, message]);
    };

    try {
      const res = await fetch("/api/agent/orchestrate/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: idea.trim() || undefined,
          projectName: designDoc.appName,
          userRole: userRole ?? undefined,
          designDoc,
          selectedFeatures,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        let message = `요청 실패 (${res.status})`;
        try {
          const data = JSON.parse(text) as { error?: string };
          if (typeof data.error === "string" && data.error) {
            message = data.error;
          }
        } catch {
          // keep default message
        }
        throw new Error(message);
      }

      if (!res.body) {
        throw new Error("스트림 응답을 받을 수 없습니다.");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";

        for (const eventChunk of events) {
          const line = eventChunk.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          const jsonText = line.slice("data: ".length).trim();
          if (!jsonText) continue;

          let evt: { type?: string; message?: string; deployUrl?: string };
          try {
            evt = JSON.parse(jsonText) as typeof evt;
          } catch {
            continue;
          }

          if (typeof evt.message === "string" && evt.message) {
            appendLog(evt.message);
          }
          if (evt.type === "done") {
            if (typeof evt.deployUrl === "string" && evt.deployUrl) {
              setPreviewUrl(evt.deployUrl);
            }
            setWorkflow("done");
          }
          if (evt.type === "error") {
            throw new Error(evt.message || "오케스트레이션 중 오류가 발생했습니다.");
          }
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "네트워크 오류가 발생했습니다.";
      setBuildError(msg);
      setWorkflow("done");
    } finally {
      setBuildPending(false);
      setLoading(false);
    }
  }

  if (workflow === "done") {
    return (
      <div className="min-h-full flex flex-col items-center justify-center bg-background px-6 py-16">
        <div className="flex max-w-lg flex-col items-center gap-6 text-center">
          <span className="text-5xl" aria-hidden>
            🎉
          </span>
          <p className="text-xl font-semibold leading-snug text-foreground">
            {COMPLETE_MESSAGE}
          </p>
          {previewUrl && (
            <Card className="w-full border-border text-left shadow-md">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">배포된 앱</CardTitle>
                <CardDescription>
                  Vercel이 자동으로 배포한 앱입니다. 새 탭에서 열어 보세요.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <a
                  href={previewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all text-sm font-medium text-primary underline-offset-4 hover:underline"
                >
                  {previewUrl}
                </a>
              </CardContent>
              <CardFooter>
                <Button asChild className="w-full" size="lg">
                  <a href={previewUrl} target="_blank" rel="noopener noreferrer">
                    앱 열기
                  </a>
                </Button>
              </CardFooter>
            </Card>
          )}
          {buildError && <p className="text-sm text-destructive">{buildError}</p>}
          <Button type="button" size="lg" variant="secondary" onClick={backToBrief}>
            기능 선택 화면으로 돌아가기
          </Button>
        </div>
      </div>
    );
  }

  if (roleReady && !userRole) {
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
                  onClick={() => saveRole(role.label)}
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
                  onChange={(e) => setCustomRoleInput(e.target.value)}
                  placeholder="예: CS팀, 운영기획, 연구소..."
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring"
                />
                <Button
                  type="button"
                  disabled={!canSaveCustomRole}
                  onClick={() => saveRole(customRoleInput.trim())}
                >
                  저장
                </Button>
              </div>
            </div>
          </CardContent>
          <CardFooter className="justify-between text-xs text-muted-foreground">
            <span>나중에 localStorage에서 값을 지우면 다시 선택할 수 있습니다.</span>
          </CardFooter>
        </Card>
      </div>
    );
  }

  const agentRunning = workflow === "agents";
  const anyFeatureSelected = pickSelectedFeatures(featureDrafts).length > 0;
  return (
    <div className="min-h-full bg-background px-4 py-10 lg:py-12">
      <div
        className={`mx-auto flex w-full max-w-6xl flex-col gap-8 ${agentRunning ? "lg:flex-row lg:items-start lg:gap-10" : ""}`}
      >
        <div
          className={`mx-auto w-full max-w-lg shrink-0 space-y-8 ${agentRunning ? "lg:mx-0" : ""}`}
        >
          <div className="flex items-center justify-between gap-4">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">딱코</h1>
          </div>

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
            <Button type="submit" disabled={loading || !idea.trim() || agentRunning}>
              {loading && !agentRunning ? "설계 중…" : "기능 추천 받기"}
            </Button>
          </form>

          {error && <p className="text-center text-sm text-destructive lg:text-left">{error}</p>}

          {designDoc && (
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
                    disabled={agentRunning}
                    onToggle={(id, checked) =>
                      setFeatureDrafts((prev) =>
                        prev.map((item) =>
                          item.id === id ? { ...item, checked } : item
                        )
                      )
                    }
                    onTextChange={(id, text) =>
                      setFeatureDrafts((prev) =>
                        prev.map((item) =>
                          item.id === id ? { ...item, text } : item
                        )
                      )
                    }
                  />
                </div>
              </CardContent>
              <CardFooter className="flex w-full flex-col gap-2 pt-2">
                <Button
                  type="button"
                  className="w-full"
                  size="lg"
                  disabled={agentRunning || !anyFeatureSelected}
                  onClick={startAgentRun}
                >
                  이 기능으로 만들기
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
                  선택한 기능으로 code → ui → qa → deploy 순서로 자동 진행합니다.
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
                {buildPending && (
                  <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
                    ☁️ GitHub 레포 생성/푸시 및 Vercel 배포를 진행 중입니다. 수 분
                    걸릴 수 있습니다…
                  </p>
                )}
              </CardContent>
            </Card>
          </aside>
        )}
      </div>
    </div>
  );
}
