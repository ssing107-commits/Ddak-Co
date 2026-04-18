"use client";

import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import type { EditableFeature } from "@/components/feature-selection-cards";

import { ROLE_STORAGE_KEY } from "./constants";
import {
  runDraftDeployment,
  runFinalizeDeployment,
  runPlanningSubmit,
} from "./ddak-home-flow-runners";
import { pickSelectedFeatures } from "./feature-helpers";
import type {
  AppPhase,
  DeployContext,
  DesignDoc,
  FileItem,
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
    (e: FormEvent) =>
      runPlanningSubmit(e, {
        idea,
        userRole,
        appendLog,
        setBusy,
        setError,
        setFinalDeployUrl,
        setDraftDeployUrl,
        setDraftFiles,
        setDeployContext,
        setLogMessages,
        setDesignDoc,
        setFeatureDrafts,
        setPhase,
      }),
    [appendLog, idea, userRole]
  );

  const startDraftDeployment = useCallback(async () => {
    if (!designDoc) return;
    await runDraftDeployment({
      designDoc,
      featureDrafts,
      userRole,
      appendLog,
      setPhase,
      setBusy,
      setError,
      setDraftDeployUrl,
      setFinalDeployUrl,
      setDraftFiles,
      setDeployContext,
      setLogMessages,
    });
  }, [appendLog, designDoc, featureDrafts, userRole]);

  const continueToFinalize = useCallback(async () => {
    if (!designDoc || !deployContext || draftFiles.length === 0) return;
    await runFinalizeDeployment({
      designDoc,
      deployContext,
      draftFiles,
      userRole,
      appendLog,
      setPhase,
      setBusy,
      setError,
      setFinalDeployUrl,
    });
  }, [appendLog, deployContext, designDoc, draftFiles, userRole]);

  const running =
    phase === "draft-running" || phase === "final-running";
  /** 배포 실패 후 phase가 planning으로 돌아가도 로그·링크를 볼 수 있게 함 */
  const showAgentLog =
    running || logMessages.length > 0;
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
    showAgentLog,
    anyFeatureSelected,
    stageRows,
  };
}
