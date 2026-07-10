import { createHash, randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { NormalizedStat } from "./managerClient.ts";

export type MaybePromise<T> = T | Promise<T>;

export type EventLevel = "error" | "info" | "warn";
export type UserStatus = "active" | "disabled" | "over_quota";
export type QuotaPeriod = "none" | "daily" | "weekly" | "monthly";

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

export type UserRecord = {
  createdAt: number;
  disabledAt: number | null;
  id: string;
  name: string;
  note: string;
  quotaBytes: number | null;
  quotaPeriod: QuotaPeriod;
  status: UserStatus;
  updatedAt: number;
};

export type UserListItem = UserRecord & {
  accessCount: number;
  activeTokenCreatedAt: number | null;
  lastAccessedAt: number | null;
};

export type SubscriptionTokenRecord = {
  createdAt: number;
  id: string;
  lastAccessedAt: number | null;
  revoked: boolean;
  revokedAt: number | null;
  tokenHash: string;
  userId: string;
};

export type SubscriptionAccessLog = {
  format: string;
  id: string;
  ip: string | null;
  tokenId: string | null;
  ts: number;
  userAgent: string | null;
  userId: string;
};

export type UserDetail = {
  accessLogs: SubscriptionAccessLog[];
  activeToken: SubscriptionTokenRecord | null;
  user: UserRecord;
};

export type CreatedSubscription = {
  token: string;
  tokenRecord: SubscriptionTokenRecord;
  user: UserRecord;
};

export type CreateUserInput = {
  name: unknown;
  note?: unknown;
  quotaBytes?: unknown;
  quotaPeriod?: unknown;
};

export type UpdateUserInput = Partial<CreateUserInput> & {
  status?: unknown;
};

export type SubscriptionAccessInput = {
  format: string;
  ip?: string | null;
  userAgent?: string | null;
};

export type Store = {
  backend: "postgres" | "sqlite";
  close(): MaybePromise<void>;
  createUser(input: CreateUserInput): MaybePromise<CreatedSubscription>;
  dataDir: string;
  findSubscriptionByTokenHash(tokenHash: string): MaybePromise<{
    tokenRecord: SubscriptionTokenRecord;
    user: UserRecord;
  } | null>;
  getEvents(limit?: number): MaybePromise<StoredEvent[]>;
  getLatestSamples(): MaybePromise<Array<{ bytes: number; port: string; ts: number; userId: string | null }>>;
  getRecordedTotalBytes(): MaybePromise<number>;
  getTraffic(range: string): MaybePromise<TrafficSummary>;
  getTrafficByUser(userId: string, range: string): MaybePromise<TrafficSummary>;
  getActiveSubscriptionTokenValue(userId: string): MaybePromise<string | null>;
  getUserDetail(userId: string, limit?: number): MaybePromise<UserDetail | null>;
  listUsers(): MaybePromise<UserListItem[]>;
  recordEvent(level: EventLevel, message: string, detail?: unknown): MaybePromise<void>;
  recordSample(stat: NormalizedStat, ts?: number, userId?: string | null): MaybePromise<void>;
  recordSubscriptionAccess(userId: string, tokenId: string | null, input: SubscriptionAccessInput): MaybePromise<void>;
  resetSubscriptionToken(userId: string): MaybePromise<CreatedSubscription | null>;
  setUserStatus(userId: string, status: UserStatus): MaybePromise<UserRecord | null>;
  updateUser(userId: string, input: UpdateUserInput): MaybePromise<UserRecord | null>;
};

const QUOTA_PERIODS = new Set<QuotaPeriod>(["none", "daily", "weekly", "monthly"]);
const USER_STATUSES = new Set<UserStatus>(["active", "disabled", "over_quota"]);

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

function normalizeRange(range: string): "1h" | "24h" | "7d" {
  return range === "1h" || range === "7d" ? range : "24h";
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

function normalizeName(value: unknown): string {
  const name = String(value || "").trim().replace(/\s+/g, " ");
  if (!name) throw new Error("用户名称不能为空");
  if (name.length > 80) throw new Error("用户名称不能超过 80 个字符");
  return name;
}

function normalizeNote(value: unknown): string {
  const note = String(value || "").trim();
  if (note.length > 500) throw new Error("备注不能超过 500 个字符");
  return note;
}

function normalizeQuotaBytes(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const quota = Number(value);
  if (!Number.isFinite(quota) || quota <= 0) throw new Error("流量配额必须是正数");
  return Math.round(quota);
}

function normalizeQuotaPeriod(value: unknown, quotaBytes: number | null): QuotaPeriod {
  const period = String(value || "").trim() as QuotaPeriod;
  if (!quotaBytes) return "none";
  if (QUOTA_PERIODS.has(period) && period !== "none") return period;
  return "monthly";
}

function normalizeStatus(value: unknown): UserStatus {
  const status = String(value || "").trim() as UserStatus;
  if (!USER_STATUSES.has(status)) throw new Error("用户状态无效");
  return status;
}

function createSubscriptionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSubscriptionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function numberOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function rowToUser(row: Record<string, unknown>): UserRecord {
  return {
    createdAt: Number(row.created_at),
    disabledAt: numberOrNull(row.disabled_at),
    id: String(row.id),
    name: String(row.name),
    note: String(row.note || ""),
    quotaBytes: numberOrNull(row.quota_bytes),
    quotaPeriod: String(row.quota_period || "none") as QuotaPeriod,
    status: String(row.status || "active") as UserStatus,
    updatedAt: Number(row.updated_at)
  };
}

function rowToUserListItem(row: Record<string, unknown>): UserListItem {
  return {
    ...rowToUser(row),
    accessCount: Number(row.access_count || 0),
    activeTokenCreatedAt: numberOrNull(row.active_token_created_at),
    lastAccessedAt: numberOrNull(row.last_accessed_at)
  };
}

function rowToToken(row: Record<string, unknown>): SubscriptionTokenRecord {
  return {
    createdAt: Number(row.created_at),
    id: String(row.id),
    lastAccessedAt: numberOrNull(row.last_accessed_at),
    revoked: Boolean(Number(row.revoked)),
    revokedAt: numberOrNull(row.revoked_at),
    tokenHash: String(row.token_hash),
    userId: String(row.user_id)
  };
}

function rowToAccessLog(row: Record<string, unknown>): SubscriptionAccessLog {
  return {
    format: String(row.format),
    id: String(row.id),
    ip: row.ip ? String(row.ip) : null,
    tokenId: row.token_id ? String(row.token_id) : null,
    ts: Number(row.ts),
    userAgent: row.user_agent ? String(row.user_agent) : null,
    userId: String(row.user_id)
  };
}

function trafficSummaryFromRows(
  rows: Array<{ bytes: number; port: string; ts: number }>,
  range: string,
  until = Date.now()
): TrafficSummary {
  const normalizedRange = normalizeRange(range);
  const since = until - rangeToMs(normalizedRange);
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
}

function normalizeSampleRows(rows: Array<{ bytes: number; port: string; ts: number }>): Array<{ bytes: number; port: string; ts: number }> {
  return rows.map((row) => ({
    bytes: Number(row.bytes),
    port: String(row.port),
    ts: Number(row.ts)
  }));
}

function activeTokenSelect(alias = "t"): string {
  return `
    ${alias}.created_at AS active_token_created_at,
    ${alias}.last_accessed_at AS last_accessed_at
  `;
}

function createUserValues(input: CreateUserInput, now = Date.now()): UserRecord {
  const quotaBytes = normalizeQuotaBytes(input.quotaBytes);

  return {
    createdAt: now,
    disabledAt: null,
    id: randomUUID(),
    name: normalizeName(input.name),
    note: normalizeNote(input.note),
    quotaBytes,
    quotaPeriod: normalizeQuotaPeriod(input.quotaPeriod, quotaBytes),
    status: "active",
    updatedAt: now
  };
}

function createTokenValues(userId: string, now = Date.now()): { token: string; tokenRecord: SubscriptionTokenRecord } {
  const token = createSubscriptionToken();
  return {
    token,
    tokenRecord: {
      createdAt: now,
      id: randomUUID(),
      lastAccessedAt: null,
      revoked: false,
      revokedAt: null,
      tokenHash: hashSubscriptionToken(token),
      userId
    }
  };
}

function pruneSqlite(db: DatabaseSync, now = Date.now()): void {
  const sampleCutoff = now - 30 * 24 * 60 * 60 * 1000;
  const eventCutoff = now - 14 * 24 * 60 * 60 * 1000;
  const accessCutoff = now - 90 * 24 * 60 * 60 * 1000;
  db.prepare("DELETE FROM traffic_samples WHERE ts < ?").run(sampleCutoff);
  db.prepare("DELETE FROM events WHERE ts < ?").run(eventCutoff);
  db.prepare("DELETE FROM subscription_access_logs WHERE ts < ?").run(accessCutoff);
}

function initSqlite(db: DatabaseSync): void {
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS traffic_samples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      port TEXT NOT NULL,
      user_id TEXT,
      bytes INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS traffic_samples_ts_port_idx ON traffic_samples (ts, port);
    CREATE INDEX IF NOT EXISTS traffic_samples_user_ts_idx ON traffic_samples (user_id, ts);
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      detail TEXT
    );
    CREATE INDEX IF NOT EXISTS events_ts_idx ON events (ts);
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      quota_bytes INTEGER,
      quota_period TEXT NOT NULL DEFAULT 'none',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      disabled_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS users_status_idx ON users (status);
    CREATE TABLE IF NOT EXISTS subscription_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      token_value TEXT,
      revoked INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      last_accessed_at INTEGER,
      revoked_at INTEGER,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS subscription_tokens_user_idx ON subscription_tokens (user_id, revoked);
    CREATE TABLE IF NOT EXISTS subscription_access_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_id TEXT,
      ts INTEGER NOT NULL,
      format TEXT NOT NULL,
      ip TEXT,
      user_agent TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS subscription_access_logs_user_ts_idx ON subscription_access_logs (user_id, ts);
  `);

  const tokenColumns = db.prepare("PRAGMA table_info(subscription_tokens)").all() as Array<{ name: string }>;
  if (!tokenColumns.some((column) => column.name === "token_value")) {
    db.exec("ALTER TABLE subscription_tokens ADD COLUMN token_value TEXT");
  }

  const legacySamples = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'samples'")
    .get();
  const trafficCount = db.prepare("SELECT COUNT(*) AS count FROM traffic_samples").get() as { count: number };

  if (legacySamples && Number(trafficCount.count) === 0) {
    db.exec("INSERT INTO traffic_samples (ts, port, bytes) SELECT ts, port, bytes FROM samples");
  }
}

export function openStore(preferredDataDir: string): Store {
  const dataDir = ensureWritableDir(preferredDataDir);
  const db = new DatabaseSync(path.join(dataDir, "admin.sqlite"));
  initSqlite(db);

  const insertSample = db.prepare("INSERT INTO traffic_samples (ts, port, user_id, bytes) VALUES (?, ?, ?, ?)");
  const insertEvent = db.prepare("INSERT INTO events (ts, level, message, detail) VALUES (?, ?, ?, ?)");

  function getUser(userId: string): UserRecord | null {
    const row = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as Record<string, unknown> | undefined;
    return row ? rowToUser(row) : null;
  }

  function activeTokenForUser(userId: string): SubscriptionTokenRecord | null {
    const row = db
      .prepare("SELECT * FROM subscription_tokens WHERE user_id = ? AND revoked = 0 ORDER BY created_at DESC LIMIT 1")
      .get(userId) as Record<string, unknown> | undefined;
    return row ? rowToToken(row) : null;
  }

  return {
    backend: "sqlite",
    close(): void {
      db.close();
    },
    createUser(input: CreateUserInput): CreatedSubscription {
      const user = createUserValues(input);
      const { token, tokenRecord } = createTokenValues(user.id, user.createdAt);

      db.exec("BEGIN");
      try {
        db.prepare(`
          INSERT INTO users (id, name, note, status, quota_bytes, quota_period, created_at, updated_at, disabled_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          user.id,
          user.name,
          user.note,
          user.status,
          user.quotaBytes,
          user.quotaPeriod,
          user.createdAt,
          user.updatedAt,
          user.disabledAt
        );
        db.prepare(`
          INSERT INTO subscription_tokens (id, user_id, token_hash, token_value, revoked, created_at, last_accessed_at, revoked_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          tokenRecord.id,
          tokenRecord.userId,
          tokenRecord.tokenHash,
          token,
          0,
          tokenRecord.createdAt,
          tokenRecord.lastAccessedAt,
          tokenRecord.revokedAt
        );
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }

      return { token, tokenRecord, user };
    },
    dataDir,
    findSubscriptionByTokenHash(tokenHash: string): { tokenRecord: SubscriptionTokenRecord; user: UserRecord } | null {
      const row = db
        .prepare(`
          SELECT
            t.id AS token_id,
            t.user_id AS token_user_id,
            t.token_hash,
            t.revoked,
            t.created_at AS token_created_at,
            t.last_accessed_at,
            t.revoked_at,
            u.*
          FROM subscription_tokens t
          JOIN users u ON u.id = t.user_id
          WHERE t.token_hash = ?
          LIMIT 1
        `)
        .get(tokenHash) as Record<string, unknown> | undefined;

      if (!row) return null;
      return {
        tokenRecord: rowToToken({
          created_at: row.token_created_at,
          id: row.token_id,
          last_accessed_at: row.last_accessed_at,
          revoked: row.revoked,
          revoked_at: row.revoked_at,
          token_hash: row.token_hash,
          user_id: row.token_user_id
        }),
        user: rowToUser(row)
      };
    },
    getEvents(limit = 100): StoredEvent[] {
      return db
        .prepare("SELECT ts, level, message, detail FROM events ORDER BY ts DESC LIMIT ?")
        .all(limit) as StoredEvent[];
    },
    getLatestSamples(): Array<{ bytes: number; port: string; ts: number; userId: string | null }> {
      const rows = db
        .prepare(`
          SELECT s.port, s.bytes, s.ts, s.user_id
          FROM traffic_samples s
          JOIN (
            SELECT port, COALESCE(user_id, '') AS user_key, MAX(id) AS id
            FROM traffic_samples
            GROUP BY port, COALESCE(user_id, '')
          ) latest ON latest.id = s.id
          ORDER BY s.port
        `)
        .all() as Array<{ bytes: number; port: string; ts: number; user_id: string | null }>;
      return rows.map((row) => ({ bytes: row.bytes, port: row.port, ts: row.ts, userId: row.user_id }));
    },
    getRecordedTotalBytes(): number {
      const rows = db
        .prepare("SELECT port, ts, bytes FROM traffic_samples WHERE user_id IS NULL ORDER BY port, ts")
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
      const normalizedRange = normalizeRange(range);
      const until = Date.now();
      const since = until - rangeToMs(normalizedRange);
      const rows = db
        .prepare("SELECT port, ts, bytes FROM traffic_samples WHERE ts >= ? AND user_id IS NULL ORDER BY port, ts")
        .all(since) as Array<{ bytes: number; port: string; ts: number }>;

      return trafficSummaryFromRows(normalizeSampleRows(rows), normalizedRange, until);
    },
    getTrafficByUser(userId: string, range: string): TrafficSummary {
      const normalizedRange = normalizeRange(range);
      const until = Date.now();
      const since = until - rangeToMs(normalizedRange);
      const rows = db
        .prepare("SELECT port, ts, bytes FROM traffic_samples WHERE ts >= ? AND user_id = ? ORDER BY port, ts")
        .all(since, userId) as Array<{ bytes: number; port: string; ts: number }>;

      return trafficSummaryFromRows(normalizeSampleRows(rows), normalizedRange, until);
    },
    getActiveSubscriptionTokenValue(userId: string): string | null {
      const row = db
        .prepare("SELECT token_value FROM subscription_tokens WHERE user_id = ? AND revoked = 0 ORDER BY created_at DESC LIMIT 1")
        .get(userId) as { token_value: string | null } | undefined;
      return row?.token_value ? String(row.token_value) : null;
    },
    getUserDetail(userId: string, limit = 50): UserDetail | null {
      const user = getUser(userId);
      if (!user) return null;

      const accessLogs = db
        .prepare("SELECT * FROM subscription_access_logs WHERE user_id = ? ORDER BY ts DESC LIMIT ?")
        .all(userId, limit) as Array<Record<string, unknown>>;

      return {
        accessLogs: accessLogs.map(rowToAccessLog),
        activeToken: activeTokenForUser(userId),
        user
      };
    },
    listUsers(): UserListItem[] {
      const rows = db
        .prepare(`
          SELECT
            u.*,
            ${activeTokenSelect("t")},
            COALESCE(l.access_count, 0) AS access_count
          FROM users u
          LEFT JOIN subscription_tokens t ON t.user_id = u.id AND t.revoked = 0
          LEFT JOIN (
            SELECT user_id, COUNT(*) AS access_count
            FROM subscription_access_logs
            GROUP BY user_id
          ) l ON l.user_id = u.id
          ORDER BY u.created_at DESC
        `)
        .all() as Array<Record<string, unknown>>;

      return rows.map(rowToUserListItem);
    },
    recordEvent(level: EventLevel, message: string, detail?: unknown): void {
      insertEvent.run(Date.now(), level, message, stringifyDetail(detail));
      pruneSqlite(db);
    },
    recordSample(stat: NormalizedStat, ts = Date.now(), userId: string | null = null): void {
      db.exec("BEGIN");
      try {
        for (const [port, bytes] of Object.entries(stat.ports)) {
          insertSample.run(ts, port, userId, Math.max(0, Math.round(bytes)));
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      pruneSqlite(db, ts);
    },
    recordSubscriptionAccess(userId: string, tokenId: string | null, input: SubscriptionAccessInput): void {
      const now = Date.now();
      db.exec("BEGIN");
      try {
        db.prepare(`
          INSERT INTO subscription_access_logs (id, user_id, token_id, ts, format, ip, user_agent)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          randomUUID(),
          userId,
          tokenId,
          now,
          input.format,
          input.ip || null,
          input.userAgent || null
        );
        if (tokenId) {
          db.prepare("UPDATE subscription_tokens SET last_accessed_at = ? WHERE id = ?").run(now, tokenId);
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      pruneSqlite(db, now);
    },
    resetSubscriptionToken(userId: string): CreatedSubscription | null {
      const user = getUser(userId);
      if (!user) return null;

      const now = Date.now();
      const { token, tokenRecord } = createTokenValues(userId, now);
      db.exec("BEGIN");
      try {
        db.prepare("UPDATE subscription_tokens SET revoked = 1, revoked_at = ? WHERE user_id = ? AND revoked = 0")
          .run(now, userId);
        db.prepare(`
          INSERT INTO subscription_tokens (id, user_id, token_hash, token_value, revoked, created_at, last_accessed_at, revoked_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          tokenRecord.id,
          tokenRecord.userId,
          tokenRecord.tokenHash,
          token,
          0,
          tokenRecord.createdAt,
          tokenRecord.lastAccessedAt,
          tokenRecord.revokedAt
        );
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }

      return { token, tokenRecord, user };
    },
    setUserStatus(userId: string, status: UserStatus): UserRecord | null {
      const now = Date.now();
      db.prepare("UPDATE users SET status = ?, updated_at = ?, disabled_at = ? WHERE id = ?")
        .run(status, now, status === "active" ? null : now, userId);
      return getUser(userId);
    },
    updateUser(userId: string, input: UpdateUserInput): UserRecord | null {
      const existing = getUser(userId);
      if (!existing) return null;

      const quotaBytes = input.quotaBytes === undefined ? existing.quotaBytes : normalizeQuotaBytes(input.quotaBytes);
      const next: UserRecord = {
        ...existing,
        name: input.name === undefined ? existing.name : normalizeName(input.name),
        note: input.note === undefined ? existing.note : normalizeNote(input.note),
        quotaBytes,
        quotaPeriod: input.quotaPeriod === undefined
          ? existing.quotaPeriod
          : normalizeQuotaPeriod(input.quotaPeriod, quotaBytes),
        status: input.status === undefined ? existing.status : normalizeStatus(input.status),
        updatedAt: Date.now()
      };
      next.disabledAt = next.status === "active" ? null : existing.disabledAt || next.updatedAt;

      db.prepare(`
        UPDATE users
        SET name = ?, note = ?, status = ?, quota_bytes = ?, quota_period = ?, updated_at = ?, disabled_at = ?
        WHERE id = ?
      `).run(
        next.name,
        next.note,
        next.status,
        next.quotaBytes,
        next.quotaPeriod,
        next.updatedAt,
        next.disabledAt,
        userId
      );
      return getUser(userId);
    }
  };
}

async function initPostgres(pool: { query: (sql: string, values?: unknown[]) => Promise<unknown> }): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS traffic_samples (
      id BIGSERIAL PRIMARY KEY,
      ts BIGINT NOT NULL,
      port TEXT NOT NULL,
      user_id TEXT,
      bytes BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS traffic_samples_ts_port_idx ON traffic_samples (ts, port);
    CREATE INDEX IF NOT EXISTS traffic_samples_user_ts_idx ON traffic_samples (user_id, ts);
    CREATE TABLE IF NOT EXISTS events (
      id BIGSERIAL PRIMARY KEY,
      ts BIGINT NOT NULL,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      detail TEXT
    );
    CREATE INDEX IF NOT EXISTS events_ts_idx ON events (ts);
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      quota_bytes BIGINT,
      quota_period TEXT NOT NULL DEFAULT 'none',
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      disabled_at BIGINT
    );
    CREATE INDEX IF NOT EXISTS users_status_idx ON users (status);
    CREATE TABLE IF NOT EXISTS subscription_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      token_value TEXT,
      revoked INTEGER NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL,
      last_accessed_at BIGINT,
      revoked_at BIGINT
    );
    CREATE INDEX IF NOT EXISTS subscription_tokens_user_idx ON subscription_tokens (user_id, revoked);
    CREATE TABLE IF NOT EXISTS subscription_access_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_id TEXT,
      ts BIGINT NOT NULL,
      format TEXT NOT NULL,
      ip TEXT,
      user_agent TEXT
    );
    CREATE INDEX IF NOT EXISTS subscription_access_logs_user_ts_idx ON subscription_access_logs (user_id, ts);
  `);
  await pool.query("ALTER TABLE subscription_tokens ADD COLUMN IF NOT EXISTS token_value TEXT");
}

async function prunePostgres(pool: { query: (sql: string, values?: unknown[]) => Promise<unknown> }, now = Date.now()): Promise<void> {
  const sampleCutoff = now - 30 * 24 * 60 * 60 * 1000;
  const eventCutoff = now - 14 * 24 * 60 * 60 * 1000;
  const accessCutoff = now - 90 * 24 * 60 * 60 * 1000;
  await pool.query("DELETE FROM traffic_samples WHERE ts < $1", [sampleCutoff]);
  await pool.query("DELETE FROM events WHERE ts < $1", [eventCutoff]);
  await pool.query("DELETE FROM subscription_access_logs WHERE ts < $1", [accessCutoff]);
}

export async function openPostgresStore(databaseUrl: string): Promise<Store> {
  const pg = await import("pg");
  const Pool = pg.Pool || pg.default?.Pool;
  if (!Pool) throw new Error("PostgreSQL driver is not available");

  const pool = new Pool({ connectionString: databaseUrl });
  await initPostgres(pool);

  async function getUser(userId: string): Promise<UserRecord | null> {
    const result = await pool.query("SELECT * FROM users WHERE id = $1", [userId]);
    return result.rows[0] ? rowToUser(result.rows[0]) : null;
  }

  async function activeTokenForUser(userId: string): Promise<SubscriptionTokenRecord | null> {
    const result = await pool.query(
      "SELECT * FROM subscription_tokens WHERE user_id = $1 AND revoked = 0 ORDER BY created_at DESC LIMIT 1",
      [userId]
    );
    return result.rows[0] ? rowToToken(result.rows[0]) : null;
  }

  return {
    backend: "postgres",
    async close(): Promise<void> {
      await pool.end();
    },
    async createUser(input: CreateUserInput): Promise<CreatedSubscription> {
      const user = createUserValues(input);
      const { token, tokenRecord } = createTokenValues(user.id, user.createdAt);
      const client = await pool.connect();

      try {
        await client.query("BEGIN");
        await client.query(`
          INSERT INTO users (id, name, note, status, quota_bytes, quota_period, created_at, updated_at, disabled_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [
          user.id,
          user.name,
          user.note,
          user.status,
          user.quotaBytes,
          user.quotaPeriod,
          user.createdAt,
          user.updatedAt,
          user.disabledAt
        ]);
        await client.query(`
          INSERT INTO subscription_tokens (id, user_id, token_hash, token_value, revoked, created_at, last_accessed_at, revoked_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [
          tokenRecord.id,
          tokenRecord.userId,
          tokenRecord.tokenHash,
          token,
          0,
          tokenRecord.createdAt,
          tokenRecord.lastAccessedAt,
          tokenRecord.revokedAt
        ]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }

      return { token, tokenRecord, user };
    },
    dataDir: "postgres",
    async findSubscriptionByTokenHash(tokenHash: string): Promise<{ tokenRecord: SubscriptionTokenRecord; user: UserRecord } | null> {
      const result = await pool.query(`
        SELECT
          t.id AS token_id,
          t.user_id AS token_user_id,
          t.token_hash,
          t.revoked,
          t.created_at AS token_created_at,
          t.last_accessed_at,
          t.revoked_at,
          u.*
        FROM subscription_tokens t
        JOIN users u ON u.id = t.user_id
        WHERE t.token_hash = $1
        LIMIT 1
      `, [tokenHash]);

      const row = result.rows[0];
      if (!row) return null;
      return {
        tokenRecord: rowToToken({
          created_at: row.token_created_at,
          id: row.token_id,
          last_accessed_at: row.last_accessed_at,
          revoked: row.revoked,
          revoked_at: row.revoked_at,
          token_hash: row.token_hash,
          user_id: row.token_user_id
        }),
        user: rowToUser(row)
      };
    },
    async getEvents(limit = 100): Promise<StoredEvent[]> {
      const result = await pool.query("SELECT ts, level, message, detail FROM events ORDER BY ts DESC LIMIT $1", [limit]);
      return result.rows as StoredEvent[];
    },
    async getLatestSamples(): Promise<Array<{ bytes: number; port: string; ts: number; userId: string | null }>> {
      const result = await pool.query(`
        SELECT s.port, s.bytes, s.ts, s.user_id
        FROM traffic_samples s
        JOIN (
          SELECT port, COALESCE(user_id, '') AS user_key, MAX(id) AS id
          FROM traffic_samples
          GROUP BY port, COALESCE(user_id, '')
        ) latest ON latest.id = s.id
        ORDER BY s.port
      `);
      return result.rows.map((row: Record<string, unknown>) => ({
        bytes: Number(row.bytes),
        port: String(row.port),
        ts: Number(row.ts),
        userId: row.user_id ? String(row.user_id) : null
      }));
    },
    async getRecordedTotalBytes(): Promise<number> {
      const result = await pool.query("SELECT port, ts, bytes FROM traffic_samples WHERE user_id IS NULL ORDER BY port, ts");
      const previous = new Map<string, number>();
      let total = 0;

      for (const row of normalizeSampleRows(result.rows)) {
        const last = previous.get(row.port);
        if (last !== undefined) {
          total += row.bytes >= last ? row.bytes - last : row.bytes;
        }
        previous.set(row.port, row.bytes);
      }

      return total;
    },
    async getTraffic(range: string): Promise<TrafficSummary> {
      const normalizedRange = normalizeRange(range);
      const until = Date.now();
      const since = until - rangeToMs(normalizedRange);
      const result = await pool.query(
        "SELECT port, ts, bytes FROM traffic_samples WHERE ts >= $1 AND user_id IS NULL ORDER BY port, ts",
        [since]
      );
      return trafficSummaryFromRows(normalizeSampleRows(result.rows), normalizedRange, until);
    },
    async getTrafficByUser(userId: string, range: string): Promise<TrafficSummary> {
      const normalizedRange = normalizeRange(range);
      const until = Date.now();
      const since = until - rangeToMs(normalizedRange);
      const result = await pool.query(
        "SELECT port, ts, bytes FROM traffic_samples WHERE ts >= $1 AND user_id = $2 ORDER BY port, ts",
        [since, userId]
      );
      return trafficSummaryFromRows(normalizeSampleRows(result.rows), normalizedRange, until);
    },
    async getActiveSubscriptionTokenValue(userId: string): Promise<string | null> {
      const result = await pool.query(
        "SELECT token_value FROM subscription_tokens WHERE user_id = $1 AND revoked = 0 ORDER BY created_at DESC LIMIT 1",
        [userId]
      );
      const value = result.rows[0]?.token_value;
      return value ? String(value) : null;
    },
    async getUserDetail(userId: string, limit = 50): Promise<UserDetail | null> {
      const user = await getUser(userId);
      if (!user) return null;

      const result = await pool.query(
        "SELECT * FROM subscription_access_logs WHERE user_id = $1 ORDER BY ts DESC LIMIT $2",
        [userId, limit]
      );

      return {
        accessLogs: result.rows.map(rowToAccessLog),
        activeToken: await activeTokenForUser(userId),
        user
      };
    },
    async listUsers(): Promise<UserListItem[]> {
      const result = await pool.query(`
        SELECT
          u.*,
          ${activeTokenSelect("t")},
          COALESCE(l.access_count, 0) AS access_count
        FROM users u
        LEFT JOIN subscription_tokens t ON t.user_id = u.id AND t.revoked = 0
        LEFT JOIN (
          SELECT user_id, COUNT(*) AS access_count
          FROM subscription_access_logs
          GROUP BY user_id
        ) l ON l.user_id = u.id
        ORDER BY u.created_at DESC
      `);
      return result.rows.map(rowToUserListItem);
    },
    async recordEvent(level: EventLevel, message: string, detail?: unknown): Promise<void> {
      await pool.query(
        "INSERT INTO events (ts, level, message, detail) VALUES ($1, $2, $3, $4)",
        [Date.now(), level, message, stringifyDetail(detail)]
      );
      await prunePostgres(pool);
    },
    async recordSample(stat: NormalizedStat, ts = Date.now(), userId: string | null = null): Promise<void> {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        for (const [port, bytes] of Object.entries(stat.ports)) {
          await client.query(
            "INSERT INTO traffic_samples (ts, port, user_id, bytes) VALUES ($1, $2, $3, $4)",
            [ts, port, userId, Math.max(0, Math.round(bytes))]
          );
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
      await prunePostgres(pool, ts);
    },
    async recordSubscriptionAccess(userId: string, tokenId: string | null, input: SubscriptionAccessInput): Promise<void> {
      const now = Date.now();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(`
          INSERT INTO subscription_access_logs (id, user_id, token_id, ts, format, ip, user_agent)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [randomUUID(), userId, tokenId, now, input.format, input.ip || null, input.userAgent || null]);
        if (tokenId) {
          await client.query("UPDATE subscription_tokens SET last_accessed_at = $1 WHERE id = $2", [now, tokenId]);
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
      await prunePostgres(pool, now);
    },
    async resetSubscriptionToken(userId: string): Promise<CreatedSubscription | null> {
      const user = await getUser(userId);
      if (!user) return null;

      const now = Date.now();
      const { token, tokenRecord } = createTokenValues(userId, now);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          "UPDATE subscription_tokens SET revoked = 1, revoked_at = $1 WHERE user_id = $2 AND revoked = 0",
          [now, userId]
        );
        await client.query(`
          INSERT INTO subscription_tokens (id, user_id, token_hash, token_value, revoked, created_at, last_accessed_at, revoked_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [
          tokenRecord.id,
          tokenRecord.userId,
          tokenRecord.tokenHash,
          token,
          0,
          tokenRecord.createdAt,
          tokenRecord.lastAccessedAt,
          tokenRecord.revokedAt
        ]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }

      return { token, tokenRecord, user };
    },
    async setUserStatus(userId: string, status: UserStatus): Promise<UserRecord | null> {
      const now = Date.now();
      await pool.query(
        "UPDATE users SET status = $1, updated_at = $2, disabled_at = $3 WHERE id = $4",
        [status, now, status === "active" ? null : now, userId]
      );
      return await getUser(userId);
    },
    async updateUser(userId: string, input: UpdateUserInput): Promise<UserRecord | null> {
      const existing = await getUser(userId);
      if (!existing) return null;

      const quotaBytes = input.quotaBytes === undefined ? existing.quotaBytes : normalizeQuotaBytes(input.quotaBytes);
      const next: UserRecord = {
        ...existing,
        name: input.name === undefined ? existing.name : normalizeName(input.name),
        note: input.note === undefined ? existing.note : normalizeNote(input.note),
        quotaBytes,
        quotaPeriod: input.quotaPeriod === undefined
          ? existing.quotaPeriod
          : normalizeQuotaPeriod(input.quotaPeriod, quotaBytes),
        status: input.status === undefined ? existing.status : normalizeStatus(input.status),
        updatedAt: Date.now()
      };
      next.disabledAt = next.status === "active" ? null : existing.disabledAt || next.updatedAt;

      await pool.query(`
        UPDATE users
        SET name = $1, note = $2, status = $3, quota_bytes = $4, quota_period = $5, updated_at = $6, disabled_at = $7
        WHERE id = $8
      `, [
        next.name,
        next.note,
        next.status,
        next.quotaBytes,
        next.quotaPeriod,
        next.updatedAt,
        next.disabledAt,
        userId
      ]);
      return await getUser(userId);
    }
  };
}

export async function openConfiguredStore(options: { dataDir: string; databaseUrl: string }): Promise<Store> {
  if (options.databaseUrl) return await openPostgresStore(options.databaseUrl);
  return openStore(options.dataDir);
}
