import { z } from "zod";

/** 코드/UI/QA/fix-build 에이전트 공통 출력 */
export const agentFilesSchema = z.object({
  files: z.array(
    z.object({
      path: z.string(),
      content: z.string(),
    })
  ),
});

export type AgentFilesOutput = z.infer<typeof agentFilesSchema>;

/** 1단계 설계 에이전트 출력 */
export const designDocSchema = z.object({
  appName: z.string().min(1),
  coreFeatures: z.array(z.string().min(1)).min(3).max(5),
  pages: z
    .array(
      z.object({
        name: z.string().min(1),
        purpose: z.string().min(1),
      })
    )
    .min(1),
  dataStructure: z
    .array(
      z.object({
        entity: z.string().min(1),
        fields: z.array(z.string().min(1)).min(1),
      })
    )
    .min(1),
});

export type DesignDocOutput = z.infer<typeof designDocSchema>;
