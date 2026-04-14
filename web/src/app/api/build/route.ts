import Anthropic, { APIError } from "@anthropic-ai/sdk";
import { Octokit } from "@octokit/rest";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type FeatureItem = { title: string; description: string };

const CODEGEN_SYSTEM = `당신은 Next.js(App Router) 초소형 프로젝트만 생성합니다.

반드시 아래 형식의 JSON만 출력하세요. 마크다운·설명·코드펜스 금지.

{"files":[{"path":"파일경로","content":"파일전체내용"},...]}

규칙:
- path는 프로젝트 루트 기준 상대 경로(슬래시 /). ".." 금지, 절대경로 금지.
- 허용되는 path 접두사만 사용: package.json, tsconfig.json, next.config.mjs, app/, public/
- Next.js App Router를 사용하고, 최소한 app/layout.tsx, app/page.tsx를 포함.
- app/page.tsx는 선택된 기능을 반영한 단일 페이지(한국어 UI).
- package.json scripts에 "dev", "build", "start" 포함.
- 모든 문자열은 JSON 이스케이프 규칙을 지켜 유효한 JSON이 되게 할 것.`;

function stripJsonFence(text: string): string {
  let s = text.trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  return s.trim();
}

const ALLOWED_PREFIXES = ["package.json", "tsconfig.json", "next.config.mjs", "app/", "public/"];

function isAllowedPath(p: string): boolean {
  const n = p.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!n || n.includes("..")) return false;
  return ALLOWED_PREFIXES.some((pre) => n === pre || n.startsWith(pre));
}

type BuildLog = string[];
function logStep(log: BuildLog, message: string) {
  const line = `[${new Date().toISOString()}] ${message}`;
  log.push(line);
  console.log(`[api/build] ${message}`);
}

function slugifyRepoName(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "ddakco-app";
}

function randomSuffix(): string {
  // URL-safe-ish short random
  return Math.random().toString(36).slice(2, 8);
}

async function vercelFetch<T>(
  token: string,
  path: string,
  init: RequestInit
): Promise<{ ok: true; data: T } | { ok: false; status: number; body: string }> {
  const res = await fetch(`https://api.vercel.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const body = await res.text();
  if (!res.ok) return { ok: false, status: res.status, body };
  return { ok: true, data: JSON.parse(body) as T };
}

export async function POST(req: NextRequest) {
  const buildLog: BuildLog = [];
  logStep(buildLog, "POST /api/build 시작");

  const githubToken = process.env.GITHUB_TOKEN?.trim();
  const githubOrg = process.env.GITHUB_ORG?.trim();
  const vercelTeamId = process.env.VERCEL_TEAM_ID?.trim();
  if (!githubToken) {
    return NextResponse.json(
      { error: "GITHUB_TOKEN이 설정되지 않았습니다.", buildLog },
      { status: 500 }
    );
  }
  if (!githubOrg) {
    return NextResponse.json(
      { error: "GITHUB_ORG가 설정되지 않았습니다.", buildLog },
      { status: 500 }
    );
  }
  if (!vercelTeamId) {
    return NextResponse.json(
      { error: "VERCEL_TEAM_ID가 설정되지 않았습니다.", buildLog },
      { status: 500 }
    );
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const vercelToken = process.env.VERCEL_TOKEN;
  if (!anthropicKey) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY가 설정되지 않았습니다.", buildLog },
      { status: 500 }
    );
  }
  if (!vercelToken) {
    return NextResponse.json(
      { error: "VERCEL_TOKEN이 설정되지 않았습니다.", buildLog },
      { status: 500 }
    );
  }

  let body: { projectName?: string; features?: FeatureItem[]; originalIdea?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다.", buildLog }, { status: 400 });
  }

  const projectName = typeof body.projectName === "string" ? body.projectName.trim() : "";
  const features = Array.isArray(body.features) ? body.features : [];
  const selectedFeatures = features
    .filter((f) => f && typeof f.title === "string" && typeof f.description === "string" && f.title.trim())
    .map((f) => ({ title: f.title.trim(), description: f.description.trim() }));

  if (!projectName || selectedFeatures.length === 0) {
    return NextResponse.json(
      { error: "projectName과 선택된 기능(features)이 필요합니다.", buildLog },
      { status: 400 }
    );
  }

  // 1) Claude로 코드 생성
  const model = process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-4-20250514";
  const anthropic = new Anthropic({ apiKey: anthropicKey });
  let files: { path: string; content: string }[] = [];

  try {
    logStep(buildLog, `Claude 코드 생성 시작 (model=${model})`);
    const msg = await anthropic.messages.create({
      model,
      max_tokens: 16384,
      system: CODEGEN_SYSTEM,
      messages: [
        {
          role: "user",
          content: `다음 정보를 바탕으로 Next.js 프로젝트 파일 JSON을 출력하세요.\n\n${JSON.stringify(
            {
              projectName,
              features: selectedFeatures,
              originalIdea: typeof body.originalIdea === "string" ? body.originalIdea.trim() : "",
            },
            null,
            2
          )}`,
        },
      ],
    });

    const block = msg.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") {
      return NextResponse.json({ error: "코드 생성 응답 처리 실패", buildLog }, { status: 502 });
    }
    const raw = stripJsonFence(block.text);
    const parsed = JSON.parse(raw) as { files?: unknown[] };
    const rawFiles = Array.isArray(parsed.files) ? parsed.files : [];
    for (const it of rawFiles) {
      if (!it || typeof it !== "object") continue;
      const rec = it as Record<string, unknown>;
      const path = typeof rec.path === "string" ? rec.path.replace(/\\/g, "/") : "";
      const content = typeof rec.content === "string" ? rec.content : "";
      if (!path || !content) continue;
      if (!isAllowedPath(path)) continue;
      files.push({ path, content });
    }
    if (!files.some((f) => f.path === "package.json")) {
      return NextResponse.json({ error: "package.json이 생성되지 않았습니다.", buildLog }, { status: 502 });
    }
    logStep(buildLog, `코드 생성 완료: ${files.length}개 파일`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logStep(buildLog, `Claude 오류: ${msg}`);
    if (e instanceof APIError) {
      return NextResponse.json({ error: e.message || "Claude API 오류", buildLog }, { status: 502 });
    }
    return NextResponse.json({ error: "코드 생성 중 오류가 발생했습니다.", buildLog }, { status: 502 });
  }

  // 2) GitHub에 새 repo 생성 + 단일 커밋으로 파일 업로드
  const octokit = new Octokit({ auth: githubToken });
  const owner = githubOrg;

  const repoName = `${slugifyRepoName(projectName)}-${randomSuffix()}`;

  let defaultBranch = "main";
  let repoId: number | undefined;
  try {
    logStep(buildLog, `GitHub repo 생성: ${owner}/${repoName}`);
    const created = await octokit.repos.createInOrg({
      org: owner,
      name: repoName,
      private: false,
      auto_init: true,
      description: `딱코가 생성한 프로젝트: ${projectName}`,
    });
    defaultBranch = created.data.default_branch || "main";
    repoId = created.data.id;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logStep(buildLog, `GitHub repo 생성 실패: ${msg}`);
    return NextResponse.json({ error: `GitHub repo 생성 실패: ${msg}`, buildLog }, { status: 502 });
  }

  try {
    logStep(buildLog, `GitHub 기본 브랜치: ${defaultBranch}`);
    const ref = await octokit.git.getRef({
      owner,
      repo: repoName,
      ref: `heads/${defaultBranch}`,
    });
    const parentSha = ref.data.object.sha;
    const parentCommit = await octokit.git.getCommit({
      owner,
      repo: repoName,
      commit_sha: parentSha,
    });

    const baseTreeSha = parentCommit.data.tree.sha;
    const treeItems: { path: string; mode: "100644"; type: "blob"; sha: string }[] = [];

    logStep(buildLog, "GitHub blobs 생성 중…");
    for (const f of files) {
      const blob = await octokit.git.createBlob({
        owner,
        repo: repoName,
        content: f.content,
        encoding: "utf-8",
      });
      treeItems.push({ path: f.path, mode: "100644", type: "blob", sha: blob.data.sha });
    }

    logStep(buildLog, "GitHub tree/commit 생성 중…");
    const newTree = await octokit.git.createTree({
      owner,
      repo: repoName,
      base_tree: baseTreeSha,
      tree: treeItems,
    });

    const newCommit = await octokit.git.createCommit({
      owner,
      repo: repoName,
      message: `딱코: ${projectName} 초기 생성`,
      tree: newTree.data.sha,
      parents: [parentSha],
    });

    await octokit.git.updateRef({
      owner,
      repo: repoName,
      ref: `heads/${defaultBranch}`,
      sha: newCommit.data.sha,
      force: true,
    });

    logStep(buildLog, "GitHub push 완료");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logStep(buildLog, `GitHub push 실패: ${msg}`);
    return NextResponse.json({ error: `GitHub push 실패: ${msg}`, buildLog }, { status: 502 });
  }

  // 3) Vercel 프로젝트 생성 + 배포 생성
  type VercelProjectRes = { id: string; name: string };
  type VercelDeploymentRes = { url: string; id: string };

  const createProject = await vercelFetch<VercelProjectRes>(
    vercelToken,
    `/v11/projects?teamId=${encodeURIComponent(vercelTeamId)}`,
    {
    method: "POST",
    body: JSON.stringify({
      name: repoName,
      framework: "nextjs",
      gitRepository: { type: "github", repo: `${owner}/${repoName}` },
    }),
    }
  );

  if (!createProject.ok) {
    logStep(buildLog, `Vercel 프로젝트 생성 실패 status=${createProject.status}`);
    return NextResponse.json(
      { error: `Vercel 프로젝트 생성 실패: ${createProject.body}`, buildLog },
      { status: 502 }
    );
  }
  logStep(buildLog, `Vercel 프로젝트 생성 완료: ${createProject.data.id}`);

  const createDeployment = await vercelFetch<VercelDeploymentRes>(
    vercelToken,
    `/v13/deployments?teamId=${encodeURIComponent(vercelTeamId)}`,
    {
    method: "POST",
    body: JSON.stringify({
      project: repoName,
      name: repoName,
      gitSource: {
        type: "github",
        org: owner,
        repo: repoName,
        ref: defaultBranch,
      },
      projectSettings: {
        framework: "nextjs",
      },
    }),
    }
  );

  if (!createDeployment.ok) {
    logStep(buildLog, `Vercel 배포 생성 실패 status=${createDeployment.status}`);
    return NextResponse.json(
      { error: `Vercel 배포 생성 실패: ${createDeployment.body}`, buildLog },
      { status: 502 }
    );
  }

  const deploymentUrl = `https://${createDeployment.data.url}`;
  logStep(buildLog, `배포 생성 완료: ${deploymentUrl}`);

  return NextResponse.json({
    deploymentUrl,
    repo: { owner, name: repoName, id: repoId },
    buildLog,
  });
}

