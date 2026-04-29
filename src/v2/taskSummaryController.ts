import type { AutonomousRoundSummary } from "./summaryModels";
import type { TaskPanelSummary } from "./taskPanelViews";

export class TaskSummaryController {
  private sweepSummary = "";
  private scriptedRunSummary = "";
  private autonomousSuiteSummary = "";
  private maintenanceSummary = "";
  private autonomousRoundCounter = 0;
  private autonomousRoundSummary: AutonomousRoundSummary | undefined;

  reset(): void {
    this.sweepSummary = "";
    this.scriptedRunSummary = "";
    this.autonomousSuiteSummary = "";
    this.maintenanceSummary = "";
    this.autonomousRoundSummary = undefined;
    this.autonomousRoundCounter = 0;
  }

  setSweep(body: string): void {
    this.sweepSummary = body;
  }

  setScriptedRun(body: string): void {
    this.scriptedRunSummary = body;
  }

  setAutonomousSuite(body: string): void {
    this.autonomousSuiteSummary = body;
  }

  clearAutonomousRound(): void {
    this.autonomousRoundSummary = undefined;
  }

  nextAutonomousRoundNumber(): number {
    this.autonomousRoundCounter += 1;
    return this.autonomousRoundCounter;
  }

  setAutonomousRound(summary: AutonomousRoundSummary): void {
    this.autonomousRoundSummary = summary;
  }

  setMaintenance(body: string): void {
    this.maintenanceSummary = body;
  }

  summaries(): TaskPanelSummary[] {
    const summaries: TaskPanelSummary[] = [];
    if (this.sweepSummary) summaries.push({ title: "Timing sweep", body: this.sweepSummary });
    if (this.scriptedRunSummary) summaries.push({ title: "Scripted run", body: this.scriptedRunSummary });
    if (this.autonomousSuiteSummary) summaries.push({ title: "Autonomous suite", body: this.autonomousSuiteSummary });
    if (this.autonomousRoundSummary) summaries.push({ title: "Autonomous round", body: JSON.stringify(this.autonomousRoundSummary, null, 2) });
    if (this.maintenanceSummary) summaries.push({ title: "Maintenance", body: this.maintenanceSummary });
    return summaries;
  }

  signature(): string {
    return this.summaries().map((summary) => `${summary.title}:${summary.body}`).join("||");
  }
}
