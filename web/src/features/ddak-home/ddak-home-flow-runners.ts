import type { Dispatch, FormEvent, SetStateAction } from "react";

import type { EditableFeature } from "@/components/feature-selection-cards";

import { isDesignPayload } from "./design-validation";
import {
  buildEditableFeatures,
  pickSelectedFeatures,
} from "./feature-helpers";
import { postJson } from "./post-json";
import type {
  AppPhase,
  DeployContext,
  DesignDoc,
  FileItem,
  DeployPayload,
} from "./types";

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/** 1단계: 아이디어 → design API → 기획서·기능 초안 */
export async function runPlanningSubmit(
  e: FormEvent,
  ctx: {
    idea: string;
    userRole: string | null;
    appendLog: (message: string) => void;
    setBusy: (v: boolean) => void;
    setError: (v: string | null) => void;
    setFinalDeployUrl: (v: string | null) => void;
    setDraftDeployUrl: (v: string | null) => void;
    setDraftFiles: (v: FileItem[]) => void;
    setDeployContext: (v: DeployContext | null) => void;
    setLogMessages: Dispatch<SetStateAction<string[]>>;
    setDesignDoc: (v: DesignDoc | null) => void;
    setFeatureDrafts: Dispatch<SetStateAction<EditableFeature[]>>;
    setPhase: (v: AppPhase) => void;
  }
): Promise<void> {
  e.preventDefault();
  const input = ctx.idea.trim();
  if (!input) return;

  ctx.setBusy(true);
  ctx.setError(null);
  ctx.setFinalDeployUrl(null);
  ctx.setDraftDeployUrl(null);
  ctx.setDraftFiles([]);
  ctx.setDeployContext(null);
  ctx.setLogMessages([]);
  ctx.setDesignDoc(null);
  ctx.setFeatureDrafts([]);
  ctx.setPhase("planning");

  try {
    ctx.appendLog("1단계 시작: 기획 생성 중...");
    const data = await postJson<DesignDoc>("/api/agent/design", {
      input,
      userRole: ctx.userRole ?? undefined,
    });
    if (!isDesignPayload(data)) {
      throw new Error("설계 결과 형식이 올바르지 않습니다.");
    }

    ctx.setDesignDoc(data);
    ctx.setFeatureDrafts(buildEditableFeatures(data.coreFeatures));
    ctx.appendLog("1단계 완료: 기능 목록을 확인해 주세요.");
  } catch (err) {
    const msg = errorMessage(err, "요청 처리 중 오류가 발생했습니다.");
    ctx.setError(msg);
    ctx.appendLog(`1단계 실패: ${msg}`);
  } finally {
    ctx.setBusy(false);
  }
}

/** 2단계: code → deploy (초안) */
export async function runDraftDeployment(ctx: {
  designDoc: DesignDoc;
  featureDrafts: EditableFeature[];
  userRole: string | null;
  appendLog: (message: string) => void;
  setPhase: (v: AppPhase) => void;
  setBusy: (v: boolean) => void;
  setError: (v: string | null) => void;
  setDraftDeployUrl: (v: string | null) => void;
  setFinalDeployUrl: (v: string | null) => void;
  setDraftFiles: (v: FileItem[]) => void;
  setDeployContext: (v: DeployContext | null) => void;
  setLogMessages: Dispatch<SetStateAction<string[]>>;
}): Promise<void> {
  const selectedFeatures = pickSelectedFeatures(ctx.featureDrafts);
  if (selectedFeatures.length === 0) return;

  ctx.setPhase("draft-running");
  ctx.setBusy(true);
  ctx.setError(null);
  ctx.setDraftDeployUrl(null);
  ctx.setFinalDeployUrl(null);
  ctx.setDraftFiles([]);
  ctx.setDeployContext(null);
  ctx.setLogMessages([]);

  try {
    const designForBuild: DesignDoc = {
      ...ctx.designDoc,
      coreFeatures: selectedFeatures,
    };

    ctx.appendLog("2단계 시작: code 에이전트로 빠른 초안 생성 중...");
    const codeResult = await postJson<{ files: FileItem[] }>("/api/agent/code", {
      designDoc: designForBuild,
      draft: true,
    });
    if (!Array.isArray(codeResult.files) || codeResult.files.length === 0) {
      throw new Error("초안 코드 파일이 비어 있습니다.");
    }

    ctx.appendLog("2단계 진행: GitHub 업로드 + Vercel 초안 배포 중...");
    const deployResult = await postJson<DeployPayload>("/api/deploy", {
      userId: ctx.userRole ?? "anonymous",
      projectName: ctx.designDoc.appName,
      files: codeResult.files,
    });

    if (!deployResult.deployUrl) {
      throw new Error("초안 배포 URL을 받지 못했습니다.");
    }
    if (!deployResult.repoName || !deployResult.projectId) {
      throw new Error("재배포에 필요한 repo/project 정보가 없습니다.");
    }

    ctx.setDraftFiles(codeResult.files);
    ctx.setDraftDeployUrl(deployResult.deployUrl);
    ctx.setDeployContext({
      repoName: deployResult.repoName,
      projectId: deployResult.projectId,
    });
    ctx.setPhase("draft-ready");
    ctx.appendLog(
      "2단계 완료: 초안 배포가 끝났습니다. 계속 진행하기를 눌러 완성하세요."
    );
  } catch (err) {
    const msg = errorMessage(err, "네트워크 오류가 발생했습니다.");
    ctx.setError(msg);
    ctx.setPhase("planning");
    ctx.appendLog(`2단계 실패: ${msg}`);
  } finally {
    ctx.setBusy(false);
  }
}

/** 3단계: ui → qa → deploy (재배포) */
export async function runFinalizeDeployment(ctx: {
  designDoc: DesignDoc;
  deployContext: DeployContext;
  draftFiles: FileItem[];
  userRole: string | null;
  appendLog: (message: string) => void;
  setPhase: (v: AppPhase) => void;
  setBusy: (v: boolean) => void;
  setError: (v: string | null) => void;
  setFinalDeployUrl: (v: string | null) => void;
}): Promise<void> {
  if (ctx.draftFiles.length === 0) return;

  ctx.setPhase("final-running");
  ctx.setBusy(true);
  ctx.setError(null);
  ctx.setFinalDeployUrl(null);

  try {
    ctx.appendLog("3단계 시작: UI 에이전트 실행 중...");
    const uiResult = await postJson<{ files: FileItem[] }>("/api/agent/ui", {
      files: ctx.draftFiles,
    });
    if (!Array.isArray(uiResult.files) || uiResult.files.length === 0) {
      throw new Error("UI 개선 결과 파일이 비어 있습니다.");
    }

    ctx.appendLog("3단계 진행: QA 에이전트 실행 중...");
    const qaResult = await postJson<{ files: FileItem[] }>("/api/agent/qa", {
      files: uiResult.files,
    });
    if (!Array.isArray(qaResult.files) || qaResult.files.length === 0) {
      throw new Error("QA 결과 파일이 비어 있습니다.");
    }

    ctx.appendLog("3단계 진행: 동일 레포 업데이트 및 재배포 중...");
    const redeployResult = await postJson<DeployPayload>("/api/deploy", {
      userId: ctx.userRole ?? "anonymous",
      projectName: ctx.designDoc.appName,
      files: qaResult.files,
      repoName: ctx.deployContext.repoName,
      projectId: ctx.deployContext.projectId,
    });
    if (!redeployResult.deployUrl) {
      throw new Error("최종 배포 URL을 받지 못했습니다.");
    }

    ctx.setFinalDeployUrl(redeployResult.deployUrl);
    ctx.setPhase("done");
    ctx.appendLog("3단계 완료: 최종 배포가 완료되었습니다.");
  } catch (err) {
    const msg = errorMessage(err, "네트워크 오류가 발생했습니다.");
    ctx.setError(msg);
    ctx.setPhase("draft-ready");
    ctx.appendLog(`3단계 실패: ${msg}`);
  } finally {
    ctx.setBusy(false);
  }
}
