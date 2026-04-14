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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
      errorMessage?: string;
    }>(
      `/v13/deployments/${encodeURIComponent(deployment.id)}?teamId=${encodeURIComponent(teamId)}`,
      { method: "GET" }
    );

    if (status.readyState === "READY") {
      const finalUrl = status.url || status.inspectorUrl;
      if (!finalUrl) {
        throw new Error("[vercel] Deployment completed but URL was not returned");
      }
      return { deployUrl: normalizeDeployUrl(finalUrl) };
    }
    if (status.readyState === "ERROR" || status.readyState === "CANCELED") {
      throw new Error(
        `[vercel] Deployment failed: ${status.errorMessage || status.readyState}`
      );
    }

    await sleep(3000);
  }

  throw new Error("[vercel] Deployment polling timed out after 3 minutes");
}

