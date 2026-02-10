import type { IJobQueue } from "../types.js";

export class InlineJobQueue implements IJobQueue {
  private handlers = new Map<string, (payload: any) => Promise<void>>();

  process(jobType: string, handler: (payload: any) => Promise<void>): void {
    this.handlers.set(jobType, handler);
  }

  async enqueue<T>(jobType: string, payload: T): Promise<string> {
    const handler = this.handlers.get(jobType);
    if (!handler) {
      throw new Error(`No handler registered for job type: ${jobType}`);
    }
    await handler(payload);
    return crypto.randomUUID();
  }

  async close(): Promise<void> {
    this.handlers.clear();
  }
}
