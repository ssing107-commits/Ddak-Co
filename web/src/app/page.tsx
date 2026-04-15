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

type AppPhase =
  | "planning"
  | "draft-running"
  | "draft-ready"
  | "final-running"
  | "done";
type DesignDoc = {
  appName: string;
  coreFeatures: string[];
  pages: Array<{ name: string; purpose: string }>;
  dataStructure: Array<{ entity: string; fields: string[] }>;
};
type FileItem = { path: string; content: string };
type DeployPayload = {
  deployUrl: string;
  repoName?: string;
  projectId?: string;
};
type DeployContext = {
  repoName: string;
  projectId: string;
};

const ROLE_STORAGE_KEY = "ddakco:user-role";
const ROLE_OPTIONS = [
  { id: "solo-founder", label: "개인사업자 / 1인 창업자", emoji: "👤" },
  { id: "hr", label: "인사팀", emoji: "🏢" },
  { id: "ops-procurement", label: "총무팀 / 구매팀", emoji: "📦" },
  { id: "finance", label: "재무팀 / 회계팀", emoji: "💰" },
  { id: "marketing", label: "마케팅팀", emoji: "📣" },
] as const;
const COMPLETE_MESSAGE = "🎉 완성 배포가 끝났습니다.";

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

async function postJson<T>(path: string, payload: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let data: unknown;
  try {
    data = text ? (JSON.parse(text) as unknown) : {};
  } catch {
    throw new Error(`${path} 응답이 JSON이 아닙니다. (status=${res.status})`);
  }

  if (!res.ok) {
    const message =
      data && typeof data === "object" && "error" in data
        ? String((data as { error?: unknown }).error ?? `${path} 실패`)
        : `${path} 실패 (${res.status})`;
    throw new Error(message);
  }

  return data as T;
}

export default function Home() {
  const [idea, setIdea] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [designDoc, setDesignDoc] = useState<DesignDoc | null>(null);
  const [featureDrafts, setFeatureDrafts] = useState<EditableFeature[]>([]);
  const [phase, setPhase] = useState<AppPhase>("planning");
  const [logMessages, setLogMessages] = useState<string[]>([]);
  const [draftDeployUrl, setDraftDeployUrl] = useState<string | null>(null);
  const [finalDeployUrl, setFinalDeployUrl] = useState<string | null>(null);
  const [draftFiles, setDraftFiles] = useState<FileItem[]>([]);
  const [deployContext, setDeployContext] = useState<DeployContext | null>(null);
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

  function resetFlow() {
    setPhase("planning");
    setLogMessages([]);
    setDraftDeployUrl(null);
    setFinalDeployUrl(null);
    setDraftFiles([]);
    setDeployContext(null);
    setError(null);
  }

  function appendLog(message: string) {
    setLogMessages((prev) => [...prev, message]);
  }

  async function onSubmitPlanning(e: FormEvent) {
    e.preventDefault();
    const input = idea.trim();
    if (!input) return;

    setBusy(true);
    setError(null);
    setFinalDeployUrl(null);
    setDraftDeployUrl(null);
    setDraftFiles([]);
    setDeployContext(null);
    setLogMessages([]);
    setDesignDoc(null);
    setFeatureDrafts([]);
    setPhase("planning");

    try {
      appendLog("1단계 시작: 기획 생성 중...");
      const data = await postJson<DesignDoc>("/api/agent/design", {
        input,
        userRole: userRole ?? undefined,
      });
      if (!isDesignPayload(data)) {
        throw new Error("설계 결과 형식이 올바르지 않습니다.");
      }

      setDesignDoc(data);
      setFeatureDrafts(buildEditableFeatures(data.coreFeatures));
      appendLog("1단계 완료: 기능 목록을 확인해 주세요.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "요청 처리 중 오류가 발생했습니다.";
      setError(msg);
      appendLog(`1단계 실패: ${msg}`);
    } finally {
      setBusy(false);
    }
  }

  async function startDraftDeployment() {
    if (!designDoc) return;
    const selectedFeatures = pickSelectedFeatures(featureDrafts);
    if (selectedFeatures.length === 0) return;

    setPhase("draft-running");
    setBusy(true);
    setError(null);
    setDraftDeployUrl(null);
    setFinalDeployUrl(null);
    setDraftFiles([]);
    setDeployContext(null);
    setLogMessages([]);

    try {
      const designForBuild: DesignDoc = {
        ...designDoc,
        coreFeatures: selectedFeatures,
      };

      appendLog("2단계 시작: code 에이전트로 빠른 초안 생성 중...");
      const codeResult = await postJson<{ files: FileItem[] }>("/api/agent/code", {
        designDoc: designForBuild,
        draft: true,
      });
      if (!Array.isArray(codeResult.files) || codeResult.files.length === 0) {
        throw new Error("초안 코드 파일이 비어 있습니다.");
      }

      appendLog("2단계 진행: GitHub 업로드 + Vercel 초안 배포 중...");
      const deployResult = await postJson<DeployPayload>("/api/deploy", {
        userId: userRole ?? "anonymous",
        projectName: designDoc.appName,
        files: codeResult.files,
      });

      if (!deployResult.deployUrl) {
        throw new Error("초안 배포 URL을 받지 못했습니다.");
      }
      if (!deployResult.repoName || !deployResult.projectId) {
        throw new Error("재배포에 필요한 repo/project 정보가 없습니다.");
      }

      setDraftFiles(codeResult.files);
      setDraftDeployUrl(deployResult.deployUrl);
      setDeployContext({
        repoName: deployResult.repoName,
        projectId: deployResult.projectId,
      });
      setPhase("draft-ready");
      appendLog("2단계 완료: 초안 배포가 끝났습니다. 계속 진행하기를 눌러 완성하세요.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "네트워크 오류가 발생했습니다.";
      setError(msg);
      setPhase("planning");
      appendLog(`2단계 실패: ${msg}`);
    } finally {
      setBusy(false);
    }
  }

  async function continueToFinalize() {
    if (!designDoc || !deployContext || draftFiles.length === 0) return;

    setPhase("final-running");
    setBusy(true);
    setError(null);
    setFinalDeployUrl(null);

    try {
      appendLog("3단계 시작: UI 에이전트 실행 중...");
      const uiResult = await postJson<{ files: FileItem[] }>("/api/agent/ui", {
        files: draftFiles,
      });
      if (!Array.isArray(uiResult.files) || uiResult.files.length === 0) {
        throw new Error("UI 개선 결과 파일이 비어 있습니다.");
      }

      appendLog("3단계 진행: QA 에이전트 실행 중...");
      const qaResult = await postJson<{ files: FileItem[] }>("/api/agent/qa", {
        files: uiResult.files,
      });
      if (!Array.isArray(qaResult.files) || qaResult.files.length === 0) {
        throw new Error("QA 결과 파일이 비어 있습니다.");
      }

      appendLog("3단계 진행: 동일 레포 업데이트 및 재배포 중...");
      const redeployResult = await postJson<DeployPayload>("/api/deploy", {
        userId: userRole ?? "anonymous",
        projectName: designDoc.appName,
        files: qaResult.files,
        repoName: deployContext.repoName,
        projectId: deployContext.projectId,
      });
      if (!redeployResult.deployUrl) {
        throw new Error("최종 배포 URL을 받지 못했습니다.");
      }

      setFinalDeployUrl(redeployResult.deployUrl);
      setPhase("done");
      appendLog("3단계 완료: 최종 배포가 완료되었습니다.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "네트워크 오류가 발생했습니다.";
      setError(msg);
      setPhase("draft-ready");
      appendLog(`3단계 실패: ${msg}`);
    } finally {
      setBusy(false);
    }
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

  const running = phase === "draft-running" || phase === "final-running";
  const anyFeatureSelected = pickSelectedFeatures(featureDrafts).length > 0;
  const stageRows = [
    {
      title: "1단계 · 기획 확인",
      state: designDoc ? "완료" : "대기",
    },
    {
      title: "2단계 · 빠른 초안 배포",
      state:
        phase === "draft-running"
          ? "진행 중"
          : draftDeployUrl
            ? "완료"
            : "대기",
    },
    {
      title: "3단계 · 완성 배포",
      state:
        phase === "final-running"
          ? "진행 중"
          : finalDeployUrl
            ? "완료"
            : "대기",
    },
  ] as const;

  return (
    <div className="min-h-full bg-background px-4 py-10 lg:py-12">
      <div
        className={`mx-auto flex w-full max-w-6xl flex-col gap-8 ${running ? "lg:flex-row lg:items-start lg:gap-10" : ""}`}
      >
        <div
          className={`mx-auto w-full max-w-lg shrink-0 space-y-8 ${running ? "lg:mx-0" : ""}`}
        >
          <div className="flex items-center justify-between gap-4">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">딱코</h1>
          </div>

          <Card className="border-border bg-card shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">진행 단계</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm">
                {stageRows.map((row) => (
                  <li key={row.title} className="flex items-center justify-between">
                    <span>{row.title}</span>
                    <span className="text-muted-foreground">{row.state}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <form onSubmit={onSubmitPlanning} className="flex flex-col gap-3">
            <input
              type="text"
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
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
                    disabled={busy || running}
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
                  disabled={busy || running || !anyFeatureSelected || phase !== "planning"}
                  onClick={startDraftDeployment}
                >
                  만들기 시작
                </Button>
              </CardFooter>
            </Card>
          )}

          {draftDeployUrl && (
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
                  onClick={continueToFinalize}
                >
                  계속 진행하기
                </Button>
              </CardFooter>
            </Card>
          )}

          {finalDeployUrl && (
            <Card className="border-border bg-card shadow-md">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{COMPLETE_MESSAGE}</CardTitle>
                <CardDescription>동일 레포 업데이트 후 최종 재배포 URL입니다.</CardDescription>
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
                <Button type="button" variant="secondary" className="flex-1" onClick={resetFlow}>
                  새로 시작
                </Button>
              </CardFooter>
            </Card>
          )}
        </div>

        {running && (
          <aside className="mx-auto w-full max-w-lg shrink-0 lg:sticky lg:top-8 lg:mx-0 lg:max-w-sm lg:self-start">
            <Card className="border-border bg-card shadow-md">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">에이전트 작업 로그</CardTitle>
                <CardDescription>
                  단계별 진행 상태를 실시간으로 보여줍니다.
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
                {busy && (
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
