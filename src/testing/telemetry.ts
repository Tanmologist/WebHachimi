import type { TaskId, TestRecordId, TransactionId } from "../shared/types";

export type TraceChannel = "input" | "runtime" | "collision" | "combat" | "task" | "test" | "ai";

export type TraceLevel = "debug" | "info" | "warning" | "error";

export type EngineTraceEvent = {
  id: string;
  channel: TraceChannel;
  level: TraceLevel;
  frame: number;
  timeMs?: number;
  message: string;
  taskId?: TaskId;
  transactionId?: TransactionId;
  testRecordId?: TestRecordId;
  data?: Record<string, unknown>;
  createdAt: string;
};

export type TraceSink = {
  publish(event: Omit<EngineTraceEvent, "id" | "createdAt">): EngineTraceEvent;
};

export class MemoryTraceSink implements TraceSink {
  private readonly events: EngineTraceEvent[] = [];
  private readonly subscribers = new Set<(event: EngineTraceEvent) => void>();

  publish(event: Omit<EngineTraceEvent, "id" | "createdAt">): EngineTraceEvent {
    const next: EngineTraceEvent = {
      ...event,
      id: `trace-${this.events.length + 1}-${Date.now().toString(36)}`,
      createdAt: new Date().toISOString(),
    };
    this.events.push(next);
    this.subscribers.forEach((subscriber) => subscriber(next));
    return next;
  }

  drain(): EngineTraceEvent[] {
    return [...this.events];
  }

  clear(): void {
    this.events.length = 0;
  }

  subscribe(subscriber: (event: EngineTraceEvent) => void): () => void {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }
}

export function summarizeTraceForAi(events: EngineTraceEvent[], limit = 80): string {
  return events
    .slice(-limit)
    .map((event) => {
      const prefix = `[${event.frame}] ${event.channel}/${event.level}`;
      const data = event.data ? ` ${JSON.stringify(event.data)}` : "";
      return `${prefix}: ${event.message}${data}`;
    })
    .join("\n");
}
