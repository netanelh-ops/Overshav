import fs from "node:fs";
import crypto from "node:crypto";
import { SCHEDULE_PATH } from "./paths.js";

const CHECK_INTERVAL_MS = 15_000;

/**
 * Persisted queue of scheduled outgoing messages. Polls every
 * CHECK_INTERVAL_MS and hands any due job to `sendFn`.
 */
export class Scheduler {
  constructor(sendFn) {
    this.sendFn = sendFn; // async (jid, text) => void
    this.jobs = new Map(); // id -> job
    this._timer = null;
    this._load();
  }

  start() {
    if (this._timer) return;
    this._timer = setInterval(() => {
      this._tick().catch((err) => console.error("[scheduler] tick error:", err.message));
    }, CHECK_INTERVAL_MS);
    // also run once immediately so overdue jobs from a restart go out promptly
    this._tick().catch((err) => console.error("[scheduler] initial tick error:", err.message));
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }

  _load() {
    try {
      if (!fs.existsSync(SCHEDULE_PATH)) return;
      const raw = JSON.parse(fs.readFileSync(SCHEDULE_PATH, "utf8"));
      for (const job of raw) this.jobs.set(job.id, job);
    } catch (err) {
      console.error("[scheduler] failed to load schedule:", err.message);
    }
  }

  _save() {
    try {
      fs.writeFileSync(SCHEDULE_PATH, JSON.stringify([...this.jobs.values()], null, 2));
    } catch (err) {
      console.error("[scheduler] failed to persist schedule:", err.message);
    }
  }

  schedule({ jid, text, sendAt }) {
    const id = crypto.randomUUID();
    const job = { id, jid, text, sendAt, status: "pending", createdAt: Date.now() };
    this.jobs.set(id, job);
    this._save();
    return job;
  }

  cancel(id) {
    const job = this.jobs.get(id);
    if (!job || job.status !== "pending") return false;
    job.status = "cancelled";
    this._save();
    return true;
  }

  list({ includeCompleted = false } = {}) {
    const all = [...this.jobs.values()].sort((a, b) => a.sendAt - b.sendAt);
    return includeCompleted ? all : all.filter((j) => j.status === "pending");
  }

  async _tick() {
    const now = Date.now();
    let dirty = false;
    for (const job of this.jobs.values()) {
      if (job.status !== "pending" || job.sendAt > now) continue;
      try {
        await this.sendFn(job.jid, job.text);
        job.status = "sent";
        job.sentAt = Date.now();
      } catch (err) {
        job.status = "failed";
        job.error = err.message;
      }
      dirty = true;
    }
    if (dirty) this._save();
  }
}
