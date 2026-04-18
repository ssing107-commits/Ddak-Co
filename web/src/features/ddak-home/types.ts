export type AppPhase =
  | "planning"
  | "draft-running"
  | "draft-ready"
  | "final-running"
  | "done";

export type DesignDoc = {
  appName: string;
  coreFeatures: string[];
  pages: Array<{ name: string; purpose: string }>;
  dataStructure: Array<{ entity: string; fields: string[] }>;
};

export type FileItem = { path: string; content: string };

export type DeployPayload = {
  deployUrl: string;
  repoName?: string;
  projectId?: string;
};

/** Vercel 배포 단계 실패 시 `/api/deploy` 502 본문(그 외 502와 필드가 다를 수 있음) */
export type DeployFailurePayload = {
  error: string;
  deploymentId: string;
  inspectorUrl?: string;
  buildLogTail: string;
};

export type DeployContext = {
  repoName: string;
  projectId: string;
};
