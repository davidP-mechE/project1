import { db } from "../db";

/**
 * Writes job progress to the database so the status page can show it.
 * Updates are throttled to about one per second to avoid hammering the DB.
 */
export class ProgressReporter {
  private lastWrite = 0;

  constructor(
    private readonly jobId: string | null,
    private readonly minIntervalMs = 1000,
  ) {}

  async update(step: string, progress: number, message: string, force = false) {
    if (!this.jobId) return;
    const now = Date.now();
    if (!force && now - this.lastWrite < this.minIntervalMs) return;
    this.lastWrite = now;
    await db.job.updateMany({
      where: { id: this.jobId },
      data: { step, progress: Math.max(0, Math.min(100, Math.round(progress))), message },
    });
  }
}
