"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import type { EditableFeature } from "@/components/feature-selection-cards";

import { ROLE_STORAGE_KEY } from "./constants";
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

export function useDdakHomeFlow() {
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
  const [deployContext, setDeployContext] = useState<DeployContext | null>(
    null
  );
  const [userRole, setUserRole] = useState<string | null>(null);
  const [roleReady, setRoleReady] = useState(false);
  const [customRoleInput, setCustomRoleInput] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem(ROLE_STORAGE_KEY);
    if (saved) setUserRole(saved);
    setRoleReady(true);
  }, []);

  const saveRole = useCallback((role: string) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(ROLE_STORAGE_KEY, role);
    }
    setUserRole(role);
  }, []);

  const resetFlow = useCallback(() => {
    setPhase("planning");
    setLogMessages([]);
    setDraftDeployUrl(null);
    setFinalDeployUrl(null);
    setDraftFiles([]);
    setDeployContext(null);
    setError(null);
  }, []);

  const appendLog = useCallback((message: string) => {
    setLogMessages((prev) => [...prev, message]);
  }, []);

  const onSubmitPlanning = useCallback(
    async (e: FormEvent) => {
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
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : "요청 처리 중 오류가 발생했습니다.";
        setError(msg);
        appendLog(`1단계 실패: ${msg}`);
      } finally {
        setBusy(false);
      }
    },
    [appendLog, idea, userRole]
  );

  const startDraftDeployment = useCallback(async () => {
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
      const codeResult = await postJson<{ files: FileItem[] }>(
        "/api/agent/code",
        {
          designDoc: designForBuild,
          draft: true,
        }
      );
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
      appendLog(
        "2단계 완료: 초안 배포가 끝났습니다. 계속 진행하기를 눌러 완성하세요."
      );
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : "네트워크 오류가 발생했습니다.";
      setError(msg);
      setPhase("planning");
      appendLog(`2단계 실패: ${msg}`);
    } finally {
      setBusy(false);
    }
  }, [appendLog, designDoc, featureDrafts, userRole]);

  const continueToFinalize = useCallback(async () => {
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
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : "네트워크 오류가 발생했습니다.";
      setError(msg);
      setPhase("draft-ready");
      appendLog(`3단계 실패: ${msg}`);
    } finally {
      setBusy(false);
    }
  }, [appendLog, deployContext, designDoc, draftFiles, userRole]);

  const running =
    phase === "draft-running" || phase === "final-running";
  const anyFeatureSelected =
    pickSelectedFeatures(featureDrafts).length > 0;

  const stageRows = useMemo(
    () =>
      [
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
      ] as const,
    [designDoc, draftDeployUrl, finalDeployUrl, phase]
  );

  return {
    idea,
    setIdea,
    busy,
    error,
    designDoc,
    featureDrafts,
    setFeatureDrafts,
    phase,
    logMessages,
    draftDeployUrl,
    finalDeployUrl,
    roleReady,
    userRole,
    customRoleInput,
    setCustomRoleInput,
    saveRole,
    resetFlow,
    onSubmitPlanning,
    startDraftDeployment,
    continueToFinalize,
    running,
    anyFeatureSelected,
    stageRows,
  };
}
