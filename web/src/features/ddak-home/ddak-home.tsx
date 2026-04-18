"use client";

import { AgentLogAside } from "./agent-log-aside";
import { DesignDocCard } from "./design-doc-card";
import { DraftDeployCard } from "./draft-deploy-card";
import { FinalDeployCard } from "./final-deploy-card";
import { IdeaForm } from "./idea-form";
import { RoleGate } from "./role-gate";
import { StageSummaryCard } from "./stage-summary-card";
import { useDdakHomeFlow } from "./use-ddak-home-flow";

export function DdakHome() {
  const flow = useDdakHomeFlow();

  if (flow.roleReady && !flow.userRole) {
    return (
      <RoleGate
        customRoleInput={flow.customRoleInput}
        onCustomRoleInputChange={flow.setCustomRoleInput}
        onSaveRole={flow.saveRole}
      />
    );
  }

  const { running } = flow;

  return (
    <div className="min-h-full bg-background px-4 py-10 lg:py-12">
      <div
        className={`mx-auto flex w-full max-w-6xl flex-col gap-8 ${running ? "lg:flex-row lg:items-start lg:gap-10" : ""}`}
      >
        <div
          className={`mx-auto w-full max-w-lg shrink-0 space-y-8 ${running ? "lg:mx-0" : ""}`}
        >
          <div className="flex items-center justify-between gap-4">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              딱코
            </h1>
          </div>

          <StageSummaryCard rows={flow.stageRows} />

          <IdeaForm
            idea={flow.idea}
            onIdeaChange={flow.setIdea}
            onSubmit={flow.onSubmitPlanning}
            busy={flow.busy}
            running={running}
            phase={flow.phase}
          />

          {flow.error && (
            <p className="text-center text-sm text-destructive lg:text-left">
              {flow.error}
            </p>
          )}

          {flow.designDoc && (
            <DesignDocCard
              designDoc={flow.designDoc}
              featureDrafts={flow.featureDrafts}
              onToggleFeature={(id, checked) =>
                flow.setFeatureDrafts((prev) =>
                  prev.map((item) =>
                    item.id === id ? { ...item, checked } : item
                  )
                )
              }
              onFeatureTextChange={(id, text) =>
                flow.setFeatureDrafts((prev) =>
                  prev.map((item) =>
                    item.id === id ? { ...item, text } : item
                  )
                )
              }
              onStartDraft={flow.startDraftDeployment}
              busy={flow.busy}
              running={running}
              anyFeatureSelected={flow.anyFeatureSelected}
              phase={flow.phase}
            />
          )}

          {flow.draftDeployUrl && (
            <DraftDeployCard
              draftDeployUrl={flow.draftDeployUrl}
              busy={flow.busy}
              phase={flow.phase}
              onContinue={flow.continueToFinalize}
            />
          )}

          {flow.finalDeployUrl && (
            <FinalDeployCard
              finalDeployUrl={flow.finalDeployUrl}
              onReset={flow.resetFlow}
            />
          )}
        </div>

        {running && (
          <AgentLogAside logMessages={flow.logMessages} busy={flow.busy} />
        )}
      </div>
    </div>
  );
}
