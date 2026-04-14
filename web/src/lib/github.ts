type GitHubFile = { path: string; content: string };

type GitHubErrorPayload = {
  message?: string;
  errors?: Array<{ message?: string }>;
};

function getRequiredEnv(name: "GITHUB_TOKEN" | "GITHUB_ORG"): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`[github] Missing required environment variable: ${name}`);
  }
  return value;
}

async function githubRequest<T>(path: string, init: RequestInit): Promise<T> {
  const token = getRequiredEnv("GITHUB_TOKEN");
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });

  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as GitHubErrorPayload;
      const msg = body.message?.trim();
      const sub = body.errors
        ?.map((e) => e.message?.trim())
        .filter((v): v is string => Boolean(v))
        .join(", ");
      if (msg && sub) detail = `${msg} (${sub})`;
      else if (msg) detail = msg;
    } catch {
      // keep default status detail
    }
    throw new Error(`[github] API request failed: ${init.method ?? "GET"} ${path} - ${detail}`);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function normalizeFiles(files: GitHubFile[]): GitHubFile[] {
  const dedup = new Map<string, string>();
  for (const file of files) {
    const normalizedPath = file.path.replace(/\\/g, "/").replace(/^\/+/, "").trim();
    if (!normalizedPath || normalizedPath.includes("..")) {
      throw new Error(`[github] Invalid file path: "${file.path}"`);
    }
    dedup.set(normalizedPath, file.content);
  }

  return Array.from(dedup.entries()).map(([path, content]) => ({ path, content }));
}

export async function createRepo(
  repoName: string
): Promise<{ repoUrl: string; cloneUrl: string }> {
  const org = getRequiredEnv("GITHUB_ORG");
  const trimmedName = repoName.trim();
  if (!trimmedName) {
    throw new Error("[github] repoName is required");
  }

  const created = await githubRequest<{
    html_url: string;
    clone_url: string;
  }>(`/orgs/${encodeURIComponent(org)}/repos`, {
    method: "POST",
    body: JSON.stringify({
      name: trimmedName,
      private: true,
      auto_init: true,
    }),
  });

  return {
    repoUrl: created.html_url,
    cloneUrl: created.clone_url,
  };
}

export async function pushCode(repoName: string, files: GitHubFile[]): Promise<void> {
  const org = getRequiredEnv("GITHUB_ORG");
  const trimmedName = repoName.trim();
  if (!trimmedName) {
    throw new Error("[github] repoName is required");
  }
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error("[github] files must be a non-empty array");
  }

  const normalizedFiles = normalizeFiles(files);

  const ref = await githubRequest<{ object: { sha: string } }>(
    `/repos/${encodeURIComponent(org)}/${encodeURIComponent(trimmedName)}/git/ref/heads/main`,
    { method: "GET" }
  );
  const parentSha = ref.object.sha;

  const parentCommit = await githubRequest<{ tree: { sha: string } }>(
    `/repos/${encodeURIComponent(org)}/${encodeURIComponent(trimmedName)}/git/commits/${parentSha}`,
    { method: "GET" }
  );
  const baseTreeSha = parentCommit.tree.sha;

  const treeItems: Array<{ path: string; mode: "100644"; type: "blob"; sha: string }> = [];
  for (const file of normalizedFiles) {
    const blob = await githubRequest<{ sha: string }>(
      `/repos/${encodeURIComponent(org)}/${encodeURIComponent(trimmedName)}/git/blobs`,
      {
        method: "POST",
        body: JSON.stringify({
          content: file.content,
          encoding: "utf-8",
        }),
      }
    );
    treeItems.push({
      path: file.path,
      mode: "100644",
      type: "blob",
      sha: blob.sha,
    });
  }

  const newTree = await githubRequest<{ sha: string }>(
    `/repos/${encodeURIComponent(org)}/${encodeURIComponent(trimmedName)}/git/trees`,
    {
      method: "POST",
      body: JSON.stringify({
        base_tree: baseTreeSha,
        tree: treeItems,
      }),
    }
  );

  const newCommit = await githubRequest<{ sha: string }>(
    `/repos/${encodeURIComponent(org)}/${encodeURIComponent(trimmedName)}/git/commits`,
    {
      method: "POST",
      body: JSON.stringify({
        message: "딱코: initial code push",
        tree: newTree.sha,
        parents: [parentSha],
      }),
    }
  );

  await githubRequest(
    `/repos/${encodeURIComponent(org)}/${encodeURIComponent(trimmedName)}/git/refs/heads/main`,
    {
      method: "PATCH",
      body: JSON.stringify({
        sha: newCommit.sha,
        force: false,
      }),
    }
  );
}

