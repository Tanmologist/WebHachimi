import type { AutonomousRoundSummary } from "./summaryModels";
import type { TaskPanelSummary } from "./taskPanelViews";

export class TaskSummaryController {
  private sweepSummary = "";
  private scriptedRunSummary = "";
  private autonomousSuiteSummary = "";
  private maintenanceSummary = "";
  private autonomousRoundCounter = 0;
  private autonomousRoundSummary: AutonomousRoundSummary | undefined;
  private cachedSummaries: TaskPanelSummary[] | undefined;
  private cachedSignature: string | undefined;

  reset(): void {
    this.sweepSummary = "";
    this.scriptedRunSummary = "";
    this.autonomousSuiteSummary = "";
    this.maintenanceSummary = "";
    this.autonomousRoundSummary = undefined;
    this.autonomousRoundCounter = 0;
    this.invalidateCache();
  }

  setSweep(body: string): void {
    this.sweepSummary = body;
    this.invalidateCache();
  }

  setScriptedRun(body: string): void {
    this.scriptedRunSummary = body;
    this.invalidateCache();
  }

  setAutonomousSuite(body: string): void {
    this.autonomousSuiteSummary = body;
    this.invalidateCache();
  }

  clearAutonomousRound(): void {
    this.autonomousRoundSummary = undefined;
    this.invalidateCache();
  }

  nextAutonomousRoundNumber(): number {
    this.autonomousRoundCounter += 1;
    return this.autonomousRoundCounter;
  }

  setAutonomousRound(summary: AutonomousRoundSummary): void {
    this.autonomousRoundSummary = summary;
    this.invalidateCache();
  }

  setMaintenance(body: string): void {
    this.maintenanceSummary = body;
    this.invalidateCache();
  }

  summaries(): TaskPanelSummary[] {
    if (this.cachedSummaries) return this.cachedSummaries;
    const summaries: TaskPanelSummary[] = [];
    if (this.sweepSummary) summaries.push({ title: "Timing sweep", body: this.sweepSummary });
    if (this.scriptedRunSummary) summaries.push({ title: "Scripted run", body: this.scriptedRunSummary });
    if (this.autonomousSuiteSummary) summaries.push({ title: "Autonomous suite", body: this.autonomousSuiteSummary });
    if (this.autonomousRoundSummary) summaries.push({ title: "Autonomous round", body: JSON.stringify(this.autonomousRoundSummary, null, 2) });
    if (this.maintenanceSummary) summaries.push({ title: "Maintenance", body: this.maintenanceSummary });
    this.cachedSummaries = summaries;
    return summaries;
  }

  signature(): string {
    if (this.cachedSignature !== undefined) return this.cachedSignature;
    this.cachedSignature = this.summaries().map((summary) => `${summary.title}:${summary.body}`).join("||");
    return this.cachedSignature;
  }

  private invalidateCache(): void {
    this.cachedSummaries = undefined;
    this.cachedSignature = undefined;
  }
}
