import { NextRequest, NextResponse } from "next/server";

import { createRepo, pushCode } from "@/lib/github";
import { createProject, deployAndGetUrl } from "@/lib/vercel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type DeployFile = { path: string; content: string };
type DeployRequest = {
  userId?: string;
  projectName?: string;
  files?: DeployFile[];
};

function slugifyRepoName(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "ddakco-app"
  );
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

function normalizeFiles(files: unknown[]): DeployFile[] {
  return files
    .filter(
      (f) =>
        f &&
        typeof f === "object" &&
        typeof (f as DeployFile).path === "string" &&
        typeof (f as DeployFile).content === "string"
    )
    .map((f) => ({
      path: (f as DeployFile).path.trim(),
      content: (f as DeployFile).content,
    }))
    .filter((f) => f.path.length > 0);
}

function getSupabaseConfig(): { url: string; serviceRoleKey: string } {
  const url = process.env.SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceRoleKey) {
    throw new Error("SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY가 설정되지 않았습니다.");
  }
  return { url, serviceRoleKey };
}

async function insertDeploymentRow(params: {
  userId: string;
  projectName: string;
  deployUrl: string;
}): Promise<void> {
  const { url, serviceRoleKey } = getSupabaseConfig();
  const restUrl = `${url.replace(/\/+$/, "")}/rest/v1/deployments`;

  const res = await fetch(restUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Prefer: "return=minimal",
    },
    body: JSON.stringify([
      {
        userId: params.userId,
        projectName: params.projectName,
        deployUrl: params.deployUrl,
        createdAt: new Date().toISOString(),
      },
    ]),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase 저장 실패 (${res.status}): ${body}`);
  }
}

export async function POST(req: NextRequest) {
  let body: DeployRequest;
  try {
    body = (await req.json()) as DeployRequest;
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const userId =
    typeof body.userId === "string" && body.userId.trim()
      ? body.userId.trim()
      : "anonymous";
  const projectName = typeof body.projectName === "string" ? body.projectName.trim() : "";
  const files = Array.isArray(body.files) ? normalizeFiles(body.files) : [];

  if (!projectName) {
    return NextResponse.json({ error: "projectName이 필요합니다." }, { status: 400 });
  }
  if (files.length === 0) {
    return NextResponse.json({ error: "files가 비어 있습니다." }, { status: 400 });
  }

  const baseName = slugifyRepoName(projectName);
  const suffix = randomSuffix();
  const repoName = `${baseName}-${suffix}`;
  const vercelProjectName = `${baseName}-${suffix}`;

  try {
    await createRepo(repoName);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: `GitHub 레포 생성 실패: ${msg}` },
      { status: 502 }
    );
  }

  try {
    await pushCode(repoName, files);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: `GitHub 코드 푸시 실패: ${msg}` },
      { status: 502 }
    );
  }

  let projectId: string;
  try {
    const created = await createProject(vercelProjectName, repoName);
    projectId = created.projectId;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: `Vercel 프로젝트 생성 실패: ${msg}` },
      { status: 502 }
    );
  }

  let deployUrl: string;
  try {
    const deployed = await deployAndGetUrl(projectId);
    deployUrl = deployed.deployUrl;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `Vercel 배포 실패: ${msg}` }, { status: 502 });
  }

  try {
    await insertDeploymentRow({ userId, projectName, deployUrl });
  } catch (e) {
    console.error("[deploy] Supabase 저장 실패 (무시):", e);
    // 저장 실패해도 배포 성공으로 처리
  }

  return NextResponse.json({ deployUrl });
}

