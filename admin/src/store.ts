import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { NormalizedStat } from "./managerClient.ts";

export type EventLevel = "error" | "info" | "warn";

export type StoredEvent = {
  detail: string | null;
  level: EventLevel;
  message: string;
  ts: number;
};

export type TrafficPoint = {
  bytes: number;
  timestamp: number;
};

export type TrafficSummary = {
  points: TrafficPoint[];
  range: string;
  since: number;
  totalBytes: number;
  until: number;
};

export type Store = {
  close(): void;
  dataDir: string;
  getEvents(limit?: number): StoredEvent[];
  getLatestSamples(): Array<{ bytes: number; port: string; ts: number }>;
  getRecordedTotalBytes(): number;
  getTraffic(range: string): TrafficSummary;
  recordEvent(level: EventLevel, message: string, detail?: unknown): void;
  recordSample(stat: NormalizedStat, ts?: number): void;
};

function ensureWritableDir(preferredDir: string): string {
  const candidates = [preferredDir, path.join(os.tmpdir(), "railway-shadowsocks-admin")];

  for (const candidate of candidates) {
    try {
      fs.mkdirSync(candidate, { recursive: true });
      const probe = path.join(candidate, ".write-probe");
      fs.writeFileSync(probe, "ok");
      fs.unlinkSync(probe);
      return candidate;
    } catch {
      continue;
    }
  }

  throw new Error("No writable data directory is available");
}

function rangeToMs(range: string): number {
  if (range === "1h") return 60 * 60 * 1000;
  if (range === "7d") return 7 * 24 * 60 * 60 * 1000;
  return 24 * 60 * 60 * 1000;
}

function stringifyDetail(detail: unknown): string | null {
  if (detail === undefined || detail === null) return null;
  if (typeof detail === "string") return detail;

  try {
    return JSON.stringify(detail);
  } catch {
    return String(detail);
  }
}

export function openStore(preferredDataDir: string): Store {
  const dataDir = ensureWritableDir(preferredDataDir);
  const db = new DatabaseSync(path.join(dataDir, "admin.sqlite"));

  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS samples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      port TEXT NOT NULL,
      bytes INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS samples_ts_port_idx ON samples (ts, port);
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      detail TEXT
    );
    CREATE INDEX IF NOT EXISTS events_ts_idx ON events (ts);
  `);

  const insertSample = db.prepare("INSERT INTO samples (ts, port, bytes) VALUES (?, ?, ?)");
  const insertEvent = db.prepare("INSERT INTO events (ts, level, message, detail) VALUES (?, ?, ?, ?)");

  function prune(now = Date.now()): void {
    const sampleCutoff = now - 30 * 24 * 60 * 60 * 1000;
    const eventCutoff = now - 14 * 24 * 60 * 60 * 1000;
    db.prepare("DELETE FROM samples WHERE ts < ?").run(sampleCutoff);
    db.prepare("DELETE FROM events WHERE ts < ?").run(eventCutoff);
  }

  return {
    close(): void {
      db.close();
    },
    dataDir,
    getEvents(limit = 100): StoredEvent[] {
      return db
        .prepare("SELECT ts, level, message, detail FROM events ORDER BY ts DESC LIMIT ?")
        .all(limit) as StoredEvent[];
    },
    getLatestSamples(): Array<{ bytes: number; port: string; ts: number }> {
      return db
        .prepare(`
          SELECT s.port, s.bytes, s.ts
          FROM samples s
          JOIN (
            SELECT port, MAX(id) AS id
            FROM samples
            GROUP BY port
          ) latest ON latest.id = s.id
          ORDER BY s.port
        `)
        .all() as Array<{ bytes: number; port: string; ts: number }>;
    },
    getRecordedTotalBytes(): number {
      const rows = db
        .prepare("SELECT port, ts, bytes FROM samples ORDER BY port, ts")
        .all() as Array<{ bytes: number; port: string; ts: number }>;
      const previous = new Map<string, number>();
      let total = 0;

      for (const row of rows) {
        const last = previous.get(row.port);
        if (last !== undefined) {
          total += row.bytes >= last ? row.bytes - last : row.bytes;
        }
        previous.set(row.port, row.bytes);
      }

      return total;
    },
    getTraffic(range: string): TrafficSummary {
      const normalizedRange = range === "1h" || range === "7d" ? range : "24h";
      const until = Date.now();
      const since = until - rangeToMs(normalizedRange);
      const rows = db
        .prepare("SELECT port, ts, bytes FROM samples WHERE ts >= ? ORDER BY port, ts")
        .all(since) as Array<{ bytes: number; port: string; ts: number }>;

      const previous = new Map<string, number>();
      const pointsByTimestamp = new Map<number, number>();
      let totalBytes = 0;

      for (const row of rows) {
        const last = previous.get(row.port);
        const delta = last === undefined ? 0 : row.bytes >= last ? row.bytes - last : row.bytes;
        previous.set(row.port, row.bytes);

        if (delta <= 0) continue;
        totalBytes += delta;
        pointsByTimestamp.set(row.ts, (pointsByTimestamp.get(row.ts) || 0) + delta);
      }

      const points = Array.from(pointsByTimestamp.entries())
        .sort(([left], [right]) => left - right)
        .map(([timestamp, bytes]) => ({ bytes, timestamp }));

      return {
        points,
        range: normalizedRange,
        since,
        totalBytes,
        until
      };
    },
    recordEvent(level: EventLevel, message: string, detail?: unknown): void {
      insertEvent.run(Date.now(), level, message, stringifyDetail(detail));
      prune();
    },
    recordSample(stat: NormalizedStat, ts = Date.now()): void {
      db.exec("BEGIN");
      try {
        for (const [port, bytes] of Object.entries(stat.ports)) {
          insertSample.run(ts, port, Math.max(0, Math.round(bytes)));
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      prune(ts);
    }
  };
}
