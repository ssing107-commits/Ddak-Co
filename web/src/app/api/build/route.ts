import Anthropic, { APIError } from "@anthropic-ai/sdk";
import { Sandbox } from "@e2b/code-interpreter";
import { CommandExitError } from "e2b";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 300;

/**
 * E2B 공식: 공개 URL은 sandbox.getHost(포트)만 제공합니다. getHostname() API는 없습니다.
 * 브라우저/서버에서 접속: https://${sandbox.getHost(3000)}
 * network.allowPublicTraffic === false 이면 헤더 e2b-traffic-access-token 필수.
 */
const TRAFFIC_TOKEN_HEADER = "e2b-traffic-access-token";

const CODEGEN_SYSTEM = `당신은 Next.js 14(App Router) 초소형 프로젝트만 생성합니다.

반드시 아래 형식의 JSON만 출력하세요. 마크다운·설명·코드펜스 금지.

{"files":[{"path":"파일경로","content":"파일전체내용"},...]}

규칙:
- path는 프로젝트 루트 기준 상대 경로(슬래시 /). ".." 금지, 절대경로 금지.
- 허용되는 path 접두사만 사용: package.json, tsconfig.json, next.config.mjs, app/
- TypeScript + Next.js 14.2.x, React 18. next, react, react-dom, typescript, @types/node, @types/react, @types/react-dom 만 package.json dependencies에 포함.
- next.config.mjs는 ESM 한 줄이라도 되는 유효한 설정 export.
- tsconfig.json은 "jsx": "preserve", "moduleResolution": "bundler" 등 next 기본에 맞게.
- app/layout.tsx 루트 레이아웃, app/page.tsx는 선택된 기능을 반영한 단일 페이지(한국어 UI). 필요 시 "use client".
- app/globals.css는 Tailwind 없이 순수 CSS만.
- package.json scripts에 "dev": "next dev -H 0.0.0.0 -p 3000", "build": "next build" 포함.
- 모든 문자열은 JSON 이스케이프 규칙을 지켜 유효한 JSON이 되게 할 것.`;

function stripJsonFence(text: string): string {
  let s = text.trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  return s.trim();
}

const ALLOWED_PREFIXES = [
  "package.json",
  "tsconfig.json",
  "next.config.mjs",
  "next.config.js",
  "next.config.ts",
  "app/",
];

function isAllowedPath(p: string): boolean {
  const n = p.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!n || n.includes("..")) return false;
  return ALLOWED_PREFIXES.some(
    (pre) => n === pre || n.startsWith(pre.endsWith("/") ? pre : `${pre}/`)
  );
}

type BuildLog = string[];

function logStep(log: BuildLog, message: string) {
  const line = `[${new Date().toISOString()}] ${message}`;
  log.push(line);
  console.log(`[api/build] ${message}`);
}

function formatFetchError(e: unknown): string {
  if (e instanceof Error) {
    const withCause = e as Error & { cause?: unknown };
    const c = withCause.cause;
    const causePart =
      c instanceof Error
        ? c.message
        : c !== undefined && c !== null
          ? String(c)
          : "";
    return [withCause.message, causePart].filter(Boolean).join(" | ");
  }
  return String(e);
}

function buildPreviewUrl(host: string): string {
  const h = host.trim();
  if (h.startsWith("http://") || h.startsWith("https://")) return h;
  return `https://${h}`;
}

async function waitForPreviewUrl(
  previewUrl: string,
  trafficAccessToken: string | undefined,
  log: BuildLog,
  attempts = 45,
  intervalMs = 2000
): Promise<{ ok: boolean; lastStatus?: number; lastError?: string }> {
  const headers: Record<string, string> = {
    Accept: "text/html,application/json;q=0.9,*/*;q=0.8",
    "User-Agent": "Ddak-Co-BuildProbe/1.0",
  };
  if (trafficAccessToken) {
    headers[TRAFFIC_TOKEN_HEADER] = trafficAccessToken;
    logStep(
      log,
      `미리보기 요청에 ${TRAFFIC_TOKEN_HEADER} 헤더를 포함합니다(비공개 트래픽 샌드박스).`
    );
  } else {
    logStep(
      log,
      "trafficAccessToken 없음 — 공개 트래픽 샌드박스로 가정하고 헤더 없이 요청합니다."
    );
  }

  let lastError: string | undefined;
  let lastStatus: number | undefined;

  for (let i = 0; i < attempts; i++) {
    try {
      logStep(log, `헬스 체크 시도 ${i + 1}/${attempts}: GET ${previewUrl}`);
      const res = await fetch(previewUrl, {
        redirect: "follow",
        signal: AbortSignal.timeout(12_000),
        headers,
      });
      lastStatus = res.status;
      if (res.ok || res.status === 304) {
        logStep(
          log,
          `응답 성공 status=${res.status} (시도 ${i + 1}/${attempts})`
        );
        return { ok: true, lastStatus };
      }
      const snippet = (await res.text()).slice(0, 200).replace(/\s+/g, " ");
      logStep(
        log,
        `비정상 HTTP status=${res.status}, 본문 앞부분: ${snippet || "(비어 있음)"}`
      );
      lastError = `HTTP ${res.status}`;
    } catch (e) {
      const msg = formatFetchError(e);
      lastError = msg;
      logStep(
        log,
        `fetch 실패 (시도 ${i + 1}/${attempts}): ${msg}`
      );
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  return { ok: false, lastStatus, lastError };
}

export async function POST(req: NextRequest) {
  const buildLog: BuildLog = [];
  logStep(buildLog, "POST /api/build 처리 시작");

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const e2bKey = process.env.E2B_API_KEY;
  if (!anthropicKey) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY가 설정되지 않았습니다.", buildLog },
      { status: 500 }
    );
  }
  if (!e2bKey) {
    return NextResponse.json(
      { error: "E2B_API_KEY가 설정되지 않았습니다.", buildLog },
      { status: 500 }
    );
  }

  let body: {
    projectName?: string;
    features?: { title: string; description: string }[];
    originalIdea?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "잘못된 요청입니다.", buildLog },
      { status: 400 }
    );
  }

  const projectName =
    typeof body.projectName === "string" ? body.projectName.trim() : "";
  const features = Array.isArray(body.features) ? body.features : [];
  if (!projectName || features.length === 0) {
    return NextResponse.json(
      {
        error: "projectName과 최소 1개의 기능(features)이 필요합니다.",
        buildLog,
      },
      { status: 400 }
    );
  }

  const sanitizedFeatures = features
    .filter(
      (f) =>
        f &&
        typeof f.title === "string" &&
        typeof f.description === "string" &&
        f.title.trim()
    )
    .map((f) => ({
      title: f.title.trim(),
      description: f.description.trim(),
    }));

  if (sanitizedFeatures.length === 0) {
    return NextResponse.json(
      { error: "유효한 기능 목록이 없습니다.", buildLog },
      { status: 400 }
    );
  }

  const model =
    process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-4-20250514";
  const template =
    process.env.E2B_SANDBOX_TEMPLATE?.trim() || "node";

  const userPayload = {
    projectName,
    features: sanitizedFeatures,
    originalIdea:
      typeof body.originalIdea === "string" ? body.originalIdea.trim() : "",
  };

  const anthropic = new Anthropic({ apiKey: anthropicKey });

  let files: { path: string; content: string }[];
  try {
    logStep(buildLog, `Claude 코드 생성 시작 (model=${model})`);
    const msg = await anthropic.messages.create({
      model,
      max_tokens: 16384,
      system: CODEGEN_SYSTEM,
      messages: [
        {
          role: "user",
          content: `다음 정보로 Next.js 앱 파일들의 JSON을 출력하세요.\n\n${JSON.stringify(userPayload, null, 2)}`,
        },
      ],
    });

    const block = msg.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") {
      return NextResponse.json(
        {
          error: "코드 생성 응답을 처리할 수 없습니다.",
          buildLog,
        },
        { status: 502 }
      );
    }

    const raw = stripJsonFence(block.text);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return NextResponse.json(
        { error: "생성된 JSON 파싱에 실패했습니다.", buildLog },
        { status: 502 }
      );
    }

    if (
      !parsed ||
      typeof parsed !== "object" ||
      !("files" in parsed) ||
      !Array.isArray((parsed as { files: unknown }).files)
    ) {
      return NextResponse.json(
        { error: "생성 형식이 올바르지 않습니다.", buildLog },
        { status: 502 }
      );
    }

    const rawFiles = (parsed as { files: unknown[] }).files;
    files = [];
    for (const item of rawFiles) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      const path =
        typeof rec.path === "string" ? rec.path.replace(/\\/g, "/") : "";
      const content = typeof rec.content === "string" ? rec.content : "";
      if (!path || !isAllowedPath(path)) continue;
      files.push({ path, content });
    }

    if (!files.some((f) => f.path === "package.json")) {
      return NextResponse.json(
        { error: "package.json이 생성되지 않았습니다.", buildLog },
        { status: 502 }
      );
    }
    logStep(buildLog, `코드 생성 완료, 파일 ${files.length}개`);
  } catch (e) {
    console.error(e);
    logStep(
      buildLog,
      `Claude 단계 오류: ${e instanceof Error ? e.message : String(e)}`
    );
    if (e instanceof APIError) {
      return NextResponse.json(
        {
          error: e.message || "Claude API 오류",
          buildLog,
        },
        { status: e.status && e.status < 500 ? e.status : 502 }
      );
    }
    return NextResponse.json(
      { error: "코드 생성 중 오류가 발생했습니다.", buildLog },
      { status: 502 }
    );
  }

  const workdir = "/home/user/ddak-preview";
  let sandbox: InstanceType<typeof Sandbox> | null = null;

  try {
    logStep(
      buildLog,
      `E2B Sandbox.create(template=${template}, allowPublicTraffic=true)`
    );
    sandbox = await Sandbox.create(template, {
      apiKey: e2bKey,
      timeoutMs: 300_000,
      network: {
        allowPublicTraffic: true,
      },
    });

    logStep(
      buildLog,
      `샌드박스 준비됨 sandboxId=${sandbox.sandboxId} domain=${sandbox.sandboxDomain}`
    );
    if (sandbox.trafficAccessToken) {
      logStep(
        buildLog,
        "sandbox.trafficAccessToken 존재 — 미리보기 fetch 시 헤더에 포함합니다."
      );
    }

    await sandbox.commands.run(`mkdir -p ${workdir}`, {
      timeoutMs: 60_000,
    });
    logStep(buildLog, `작업 디렉터리 생성: ${workdir}`);

    for (const f of files) {
      const fullPath = `${workdir}/${f.path}`;
      await sandbox.files.write(fullPath, f.content);
    }
    logStep(buildLog, `파일 쓰기 완료 (${files.length}개)`);

    try {
      logStep(buildLog, "npm install 실행 중…");
      const installResult = await sandbox.commands.run(
        `cd ${workdir} && npm install`,
        { timeoutMs: 420_000 }
      );
      if (installResult.exitCode !== 0) {
        const errOut =
          installResult.stderr?.slice(-2000) ||
          installResult.stdout?.slice(-2000) ||
          "npm install 실패";
        logStep(buildLog, `npm install 실패 exit=${installResult.exitCode}`);
        return NextResponse.json(
          { error: `의존성 설치 실패: ${errOut}`, buildLog },
          { status: 502 }
        );
      }
      logStep(buildLog, "npm install 성공");
    } catch (e) {
      if (e instanceof CommandExitError) {
        const errOut =
          e.stderr?.slice(-2000) || e.stdout?.slice(-2000) || e.message;
        logStep(buildLog, `npm install CommandExitError: ${e.message}`);
        return NextResponse.json(
          { error: `의존성 설치 실패: ${errOut}`, buildLog },
          { status: 502 }
        );
      }
      throw e;
    }

    logStep(buildLog, "next dev 백그라운드 시작 (0.0.0.0:3000)");
    await sandbox.commands.run(
      `cd ${workdir} && npx next dev -H 0.0.0.0 -p 3000`,
      {
        background: true,
        timeoutMs: 15_000,
      }
    );

    const hostOnly = sandbox.getHost(3000);
    const previewUrl = buildPreviewUrl(hostOnly);
    logStep(
      buildLog,
      `getHost(3000) → "${hostOnly}" (SDK에 getHostname은 없음) → 미리보기 URL: ${previewUrl}`
    );

    const probe = await waitForPreviewUrl(
      previewUrl,
      sandbox.trafficAccessToken,
      buildLog
    );

    if (!probe.ok) {
      logStep(
        buildLog,
        `헬스 체크 최종 실패 lastStatus=${probe.lastStatus ?? "n/a"} lastError=${probe.lastError ?? "n/a"}`
      );
      return NextResponse.json(
        {
          error:
            "개발 서버가 제한 시간 내에 응답하지 않았습니다. buildLog의 fetch 오류(로컬 방화벽·DNS·프록시 또는 allowPublicTraffic 설정)를 확인하세요.",
          previewUrl,
          sandboxId: sandbox.sandboxId,
          buildLog,
          probe: {
            lastStatus: probe.lastStatus,
            lastError: probe.lastError,
          },
        },
        { status: 504 }
      );
    }

    logStep(buildLog, "미리보기 URL 검증 완료, 응답 반환");
    return NextResponse.json({
      previewUrl,
      sandboxId: sandbox.sandboxId,
      buildLog,
    });
  } catch (e) {
    console.error(e);
    const message = e instanceof Error ? e.message : "E2B 샌드박스 오류";
    logStep(buildLog, `E2B 예외: ${message}`);
    return NextResponse.json(
      { error: message, buildLog },
      { status: 502 }
    );
  }
}
