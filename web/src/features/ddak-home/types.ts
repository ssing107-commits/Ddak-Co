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

export type DeployContext = {
  repoName: string;
  projectId: string;
};
