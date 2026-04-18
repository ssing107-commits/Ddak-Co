type VercelErrorBody = {
  error?: { message?: string };
  message?: string;
};

type VercelProject = {
  id: string;
  name: string;
  link?: {
    type?: string;
    org?: string;
    repo?: string;
    productionBranch?: string;
  };
};

function getRequiredEnv(name: "VERCEL_TOKEN" | "VERCEL_TEAM_ID"): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`[vercel] Missing required environment variable: ${name}`);
  }
  return value;
}

function normalizeDeployUrl(url: string): string {
  return url.startsWith("http://") || url.startsWith("https://") ? url : `https://${url}`;
}

function toHostname(input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  try {
    return new URL(normalizeDeployUrl(value)).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function toVercelAppUrl(input: string): string | null {
  const host = toHostname(input);
  if (!host || !host.endsWith(".vercel.app")) return null;
  return `https://${host}`;
}

function selectShortestVercelAlias(aliases: unknown): string | null {
  if (!Array.isArray(aliases)) return null;
  const candidates = aliases
    .filter((v): v is string => typeof v === "string")
    .map((v) => toVercelAppUrl(v))
    .filter((v): v is string => Boolean(v));

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.length - b.length || a.localeCompare(b));
  return candidates[0];
}

function deriveProductionUrlFromPreviewUrl(previewUrl: string, projectName: string): string | null {
  const host = toHostname(previewUrl);
  if (!host || !host.endsWith(".vercel.app")) return null;
  const root = host.slice(0, -".vercel.app".length);
  const normalizedProjectName = projectName.trim().toLowerCase();
  if (normalizedProjectName && root.startsWith(`${normalizedProjectName}-`)) {
    return `https://${normalizedProjectName}.vercel.app`;
  }

  // preview host 형태: <project>-<hash>-<scope>.vercel.app 에서 hash/scope 구간 제거
  const stripped = root.replace(/-[a-z0-9]{8,}-.*$/i, "");
  if (stripped && stripped !== root) {
    return `https://${stripped}.vercel.app`;
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Vercel 배포가 ERROR/CANCELED로 끝났을 때 `/api/deploy` 등에서 구조화 응답으로 옮길 수 있는 정보 */
export type VercelDeploymentFailureDetails = {
  summary: string;
  deploymentId: string;
  inspectorUrl?: string;
  buildLogTail: string;
};

export class VercelDeploymentFailedError extends Error {
  readonly details: VercelDeploymentFailureDetails;

  constructor(details: VercelDeploymentFailureDetails) {
    super(`[vercel] Deployment failed: ${details.summary}`);
    this.name = "VercelDeploymentFailedError";
    this.details = details;
  }
}

const BUILD_LOG_FETCH_MAX_EVENTS = 4000;
const BUILD_LOG_ERROR_APPEND_MAX_CHARS = 14_000;
const BUILD_LOG_RAW_MAX_CHARS = 350_000;

type DeploymentEventRow = {
  type?: string;
  text?: string;
  payload?: { text?: string };
  created?: number;
};

function parseDeploymentEventsPayload(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object" && Array.isArray((data as { events?: unknown[] }).events)) {
    return (data as { events: unknown[] }).events;
  }
  return [];
}

function deploymentEventToLine(ev: unknown): string | null {
  if (!ev || typeof ev !== "object") return null;
  const o = ev as DeploymentEventRow & { payload?: { text?: string } };
  const type = typeof o.type === "string" ? o.type : "?";
  const payload = o.payload && typeof o.payload === "object" ? o.payload : null;
  const text =
    (typeof o.text === "string" ? o.text : null) ??
    (payload && typeof payload.text === "string" ? payload.text : null);
  if (text && text.trim()) {
    return type === "stdout" || type === "stderr" ? text : `[${type}] ${text}`;
  }
  if (type === "fatal" || type === "exit" || type === "command") {
    try {
      return `[${type}] ${JSON.stringify(o).slice(0, 800)}`;
    } catch {
      return `[${type}]`;
    }
  }
  return null;
}

function formatDeploymentBuildLog(events: unknown[]): string {
  const lines: string[] = [];
  for (const ev of events) {
    const line = deploymentEventToLine(ev);
    if (line) lines.push(line);
  }
  return lines.join("\n").trim();
}

/** Vercel 빌드 로그(배포 이벤트 스트림). 실패 원인 파악용. */
export async function fetchDeploymentBuildLogs(
  deploymentId: string,
  options?: { maxChars?: number }
): Promise<string> {
  const teamId = getRequiredEnv("VERCEL_TEAM_ID");
  const id = deploymentId.trim();
  if (!id) {
    throw new Error("[vercel] deploymentId is required for build logs");
  }

  const qs = new URLSearchParams({
    teamId,
    limit: String(BUILD_LOG_FETCH_MAX_EVENTS),
    direction: "backward",
  });
  const data = await vercelRequest<unknown>(
    `/v3/deployments/${encodeURIComponent(id)}/events?${qs.toString()}`,
    {
      method: "GET",
      headers: { Accept: "application/json" },
    }
  );

  const raw = parseDeploymentEventsPayload(data);
  const chronological = [...raw].reverse();
  let text = formatDeploymentBuildLog(chronological);
  if (text.length > BUILD_LOG_RAW_MAX_CHARS) {
    text =
      `…(중간 생략, 총 ${text.length}자 중 마지막 ${BUILD_LOG_RAW_MAX_CHARS}자)\n` +
      text.slice(-BUILD_LOG_RAW_MAX_CHARS);
  }

  const maxChars = options?.maxChars;
  if (typeof maxChars === "number" && maxChars > 0 && text.length > maxChars) {
    text = `…(앞부분 생략, 마지막 ${maxChars}자)\n` + text.slice(-maxChars);
  }
  return text || "(빌드 로그 본문이 비어 있음 — 이벤트 API 응답에 텍스트가 없습니다.)";
}

function truncateForErrorMessage(log: string, max = BUILD_LOG_ERROR_APPEND_MAX_CHARS): string {
  if (log.length <= max) return log;
  return `…(총 ${log.length}자 중 마지막 ${max}자)\n` + log.slice(-max);
}

async function vercelRequest<T>(path: string, init: RequestInit): Promise<T> {
  const token = getRequiredEnv("VERCEL_TOKEN");
  const res = await fetch(`https://api.vercel.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });

  if (!res.ok) {
    const raw = await res.text();
    let detail = `${res.status} ${res.statusText}`;
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as VercelErrorBody;
        const msg = parsed.error?.message?.trim() || parsed.message?.trim();
        if (msg) detail = msg;
      } catch {
        detail = raw;
      }
    }
    throw new Error(`[vercel] API request failed: ${init.method ?? "GET"} ${path} - ${detail}`);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function parseRepoSlug(repoName: string): { org: string; repo: string; fullRepo: string } {
  const trimmed = repoName.trim();
  if (!trimmed) throw new Error("[vercel] repoName is required");

  if (trimmed.includes("/")) {
    const parts = trimmed.split("/").filter(Boolean);
    if (parts.length !== 2) {
      throw new Error('[vercel] repoName must be "repo" or "org/repo" format');
    }
    const [org, repo] = parts;
    return { org, repo, fullRepo: `${org}/${repo}` };
  }

  const org = process.env.GITHUB_ORG?.trim();
  if (!org) {
    throw new Error(
      '[vercel] repoName without org requires GITHUB_ORG (or pass "org/repo")'
    );
  }
  const repo = trimmed;
  return { org, repo, fullRepo: `${org}/${repo}` };
}

export async function createProject(
  projectName: string,
  repoName: string
): Promise<{ projectId: string }> {
  const teamId = getRequiredEnv("VERCEL_TEAM_ID");
  const trimmedProjectName = projectName.trim();
  if (!trimmedProjectName) {
    throw new Error("[vercel] projectName is required");
  }

  const { fullRepo } = parseRepoSlug(repoName);
  const created = await vercelRequest<{ id: string }>(
    `/v11/projects?teamId=${encodeURIComponent(teamId)}`,
    {
      method: "POST",
      body: JSON.stringify({
        name: trimmedProjectName,
        framework: "nextjs",
        gitRepository: {
          type: "github",
          repo: fullRepo,
        },
      }),
    }
  );

  return { projectId: created.id };
}

export async function deployAndGetUrl(
  projectId: string
): Promise<{ deployUrl: string }> {
  const teamId = getRequiredEnv("VERCEL_TEAM_ID");
  const trimmedProjectId = projectId.trim();
  if (!trimmedProjectId) {
    throw new Error("[vercel] projectId is required");
  }

  const project = await vercelRequest<VercelProject>(
    `/v9/projects/${encodeURIComponent(trimmedProjectId)}?teamId=${encodeURIComponent(teamId)}`,
    { method: "GET" }
  );
  const org = project.link?.org?.trim();
  const repo = project.link?.repo?.trim();
  const ref = project.link?.productionBranch?.trim() || "main";
  if (!org || !repo) {
    throw new Error("[vercel] Project is not linked to a GitHub repository");
  }

  const deployment = await vercelRequest<{ id: string }>(
    `/v13/deployments?teamId=${encodeURIComponent(teamId)}`,
    {
      method: "POST",
      body: JSON.stringify({
        project: project.name,
        name: project.name,
        gitSource: {
          type: "github",
          org,
          repo,
          ref,
        },
        projectSettings: {
          framework: "nextjs",
        },
      }),
    }
  );

  const deadline = Date.now() + 3 * 60 * 1000;
  while (Date.now() < deadline) {
    const status = await vercelRequest<{
      readyState?: string;
      url?: string;
      inspectorUrl?: string;
      alias?: string[];
      errorMessage?: string;
    }>(
      `/v13/deployments/${encodeURIComponent(deployment.id)}?teamId=${encodeURIComponent(teamId)}`,
      { method: "GET" }
    );

    if (status.readyState === "READY") {
      const previewUrl = status.url || status.inspectorUrl;
      const aliasUrl = selectShortestVercelAlias(status.alias);
      const derivedProductionUrl = previewUrl
        ? deriveProductionUrlFromPreviewUrl(previewUrl, project.name)
        : null;
      const finalUrl = aliasUrl || derivedProductionUrl || (previewUrl ? normalizeDeployUrl(previewUrl) : null);
      if (!finalUrl) {
        throw new Error("[vercel] Deployment completed but URL was not returned");
      }
      return { deployUrl: finalUrl };
    }
    if (status.readyState === "ERROR" || status.readyState === "CANCELED") {
      const summary = status.errorMessage || status.readyState;
      let buildLog = "";
      try {
        buildLog = await fetchDeploymentBuildLogs(deployment.id);
      } catch (logErr) {
        const logMsg = logErr instanceof Error ? logErr.message : String(logErr);
        buildLog = `(빌드 로그 조회 실패: ${logMsg})`;
      }
      console.error(
        "[vercel] Deployment build logs (deploymentId=%s):\n%s",
        deployment.id,
        buildLog
      );
      const logForError = truncateForErrorMessage(buildLog);
      const inspector = status.inspectorUrl?.trim();
      throw new VercelDeploymentFailedError({
        summary,
        deploymentId: deployment.id,
        ...(inspector ? { inspectorUrl: inspector } : {}),
        buildLogTail: logForError,
      });
    }

    await sleep(3000);
  }

  throw new Error("[vercel] Deployment polling timed out after 3 minutes");
}

