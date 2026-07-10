import { createHash, randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { NormalizedStat } from "./managerClient.ts";

export type MaybePromise<T> = T | Promise<T>;

export type EventLevel = "error" | "info" | "warn";
export type NodeStatus = "active" | "disabled";
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

export type NodeLoad = {
  activeServers?: number;
  loadAvg?: number[];
  managerOnline?: boolean;
  memoryFree?: number;
  memoryTotal?: number;
  uptimeSeconds?: number;
};

export type NodeRecord = {
  createdAt: number;
  id: string;
  lastError: string | null;
  lastHeartbeatAt: number | null;
  load: NodeLoad | null;
  name: string;
  publicHost: string;
  publicPortEnd: number;
  publicPortStart: number;
  ssMethod: string;
  ssMode: string;
  ssTimeout: number;
  status: NodeStatus;
  updatedAt: number;
};

export type NodeListItem = NodeRecord & {
  assignedUserCount: number;
  online: boolean;
};

export type NodeAssignment = {
  createdAt: number;
  enabled: boolean;
  id: string;
  nodeId: string;
  nodeName: string;
  password: string;
  publicHost: string;
  publicPort: number;
  serverPort: number;
  ssMethod: string;
  ssMode: string;
  ssTimeout: number;
  updatedAt: number;
  userId: string;
  userName: string;
  userStatus: UserStatus;
};

export type SubscriptionNode = {
  assignmentId: string;
  method: string;
  nodeId: string;
  nodeName: string;
  password: string;
  publicHost: string;
  publicPort: number;
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

export type CreatedNode = {
  node: NodeRecord;
  token: string;
};

export type CreateUserInput = {
  name: unknown;
  nodeIds?: unknown;
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

export type CreateNodeInput = {
  name: unknown;
  publicHost: unknown;
  publicPortEnd?: unknown;
  publicPortStart: unknown;
  ssMethod?: unknown;
  ssMode?: unknown;
  ssTimeout?: unknown;
};

export type UpdateNodeInput = Partial<CreateNodeInput> & {
  status?: unknown;
};

export type NodeAgentSyncInput = {
  lastError?: unknown;
  load?: unknown;
  traffic?: unknown;
};

export type NodeAgentTarget = {
  assignmentId: string;
  method: string;
  mode: string;
  password: string;
  serverPort: number;
  timeout: number;
  userId: string;
  userName: string;
};

export type NodeAgentSyncResult = {
  assignments: NodeAgentTarget[];
  disabledUserIds: string[];
  node: NodeRecord;
};

export type Store = {
  backend: "postgres" | "sqlite";
  close(): MaybePromise<void>;
  createNode(input: CreateNodeInput): MaybePromise<CreatedNode>;
  createUser(input: CreateUserInput): MaybePromise<CreatedSubscription>;
  dataDir: string;
  findSubscriptionByTokenHash(tokenHash: string): MaybePromise<{
    tokenRecord: SubscriptionTokenRecord;
    user: UserRecord;
  } | null>;
  getEvents(limit?: number): MaybePromise<StoredEvent[]>;
  getLatestSamples(): MaybePromise<Array<{ bytes: number; nodeId: string | null; port: string; ts: number; userId: string | null }>>;
  getNodeDetail(nodeId: string): MaybePromise<{ assignments: NodeAssignment[]; node: NodeRecord } | null>;
  getRecordedTotalBytes(): MaybePromise<number>;
  getSubscriptionNodesForUser(userId: string): MaybePromise<SubscriptionNode[]>;
  getTraffic(range: string): MaybePromise<TrafficSummary>;
  getTrafficByUser(userId: string, range: string): MaybePromise<TrafficSummary>;
  getUserNodeAssignments(userId: string): MaybePromise<NodeAssignment[]>;
  getUserDetail(userId: string, limit?: number): MaybePromise<UserDetail | null>;
  listNodes(): MaybePromise<NodeListItem[]>;
  listUsers(): MaybePromise<UserListItem[]>;
  recordEvent(level: EventLevel, message: string, detail?: unknown): MaybePromise<void>;
  recordSample(stat: NormalizedStat, ts?: number, userId?: string | null, nodeId?: string | null): MaybePromise<void>;
  recordSubscriptionAccess(userId: string, tokenId: string | null, input: SubscriptionAccessInput): MaybePromise<void>;
  resetNodeToken(nodeId: string): MaybePromise<CreatedNode | null>;
  resetSubscriptionToken(userId: string): MaybePromise<CreatedSubscription | null>;
  setUserStatus(userId: string, status: UserStatus): MaybePromise<UserRecord | null>;
  syncNodeAgent(nodeId: string, token: string, input: NodeAgentSyncInput): MaybePromise<NodeAgentSyncResult | null>;
  updateNode(nodeId: string, input: UpdateNodeInput): MaybePromise<NodeRecord | null>;
  updateUser(userId: string, input: UpdateUserInput): MaybePromise<UserRecord | null>;
  updateUserNodeAssignments(userId: string, nodeIds: unknown): MaybePromise<NodeAssignment[] | null>;
};

const NODE_STATUSES = new Set<NodeStatus>(["active", "disabled"]);
const QUOTA_PERIODS = new Set<QuotaPeriod>(["none", "daily", "weekly", "monthly"]);
const USER_STATUSES = new Set<UserStatus>(["active", "disabled", "over_quota"]);
const NODE_ONLINE_WINDOW_MS = 60_000;

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

function normalizeNodeStatus(value: unknown): NodeStatus {
  const status = String(value || "").trim() as NodeStatus;
  if (!NODE_STATUSES.has(status)) throw new Error("节点状态无效");
  return status;
}

function normalizePublicHost(value: unknown): string {
  const host = String(value || "").trim();
  if (!host) throw new Error("节点公网地址不能为空");
  if (host.length > 255) throw new Error("节点公网地址不能超过 255 个字符");
  return host;
}

function normalizePort(value: unknown, label: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`${label} 必须是 1-65535 的端口号`);
  return port;
}

function normalizeSsMethod(value: unknown): string {
  const method = String(value || "aes-256-gcm").trim();
  if (!method) throw new Error("加密方式不能为空");
  if (method.length > 80) throw new Error("加密方式不能超过 80 个字符");
  return method;
}

function normalizeSsMode(value: unknown): string {
  const mode = String(value || "tcp_only").trim();
  if (!mode) return "tcp_only";
  if (!["tcp_only", "tcp_and_udp", "udp_only"].includes(mode)) throw new Error("节点模式无效");
  return mode;
}

function normalizeSsTimeout(value: unknown): number {
  if (value === undefined || value === null || value === "") return 300;
  return normalizePort(value, "超时时间");
}

function normalizeNodeIds(value: unknown): string[] {
  const rawItems = Array.isArray(value)
    ? value
    : String(value || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  const seen = new Set<string>();
  const nodeIds: string[] = [];

  for (const raw of rawItems) {
    const nodeId = String(raw || "").trim();
    if (!nodeId || seen.has(nodeId)) continue;
    seen.add(nodeId);
    nodeIds.push(nodeId);
  }

  return nodeIds;
}

function createSubscriptionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSubscriptionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function createNodeToken(): string {
  return randomBytes(32).toString("base64url");
}

function hashNodeToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function numberOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function stringOrNull(value: unknown): string | null {
  return value === null || value === undefined || value === "" ? null : String(value);
}

function parseNodeLoad(value: unknown): NodeLoad | null {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      return parseNodeLoad(JSON.parse(value));
    } catch {
      return null;
    }
  }
  if (typeof value !== "object" || Array.isArray(value)) return null;

  const record = value as Record<string, unknown>;
  const load: NodeLoad = {};
  if (Array.isArray(record.loadAvg)) {
    load.loadAvg = record.loadAvg.map((item) => Number(item)).filter(Number.isFinite);
  }
  if (record.activeServers !== undefined) load.activeServers = Math.max(0, Math.round(Number(record.activeServers) || 0));
  if (record.managerOnline !== undefined) load.managerOnline = Boolean(record.managerOnline);
  if (record.memoryFree !== undefined) load.memoryFree = Math.max(0, Math.round(Number(record.memoryFree) || 0));
  if (record.memoryTotal !== undefined) load.memoryTotal = Math.max(0, Math.round(Number(record.memoryTotal) || 0));
  if (record.uptimeSeconds !== undefined) load.uptimeSeconds = Math.max(0, Math.round(Number(record.uptimeSeconds) || 0));

  return Object.keys(load).length > 0 ? load : null;
}

function stringifyNodeLoad(value: unknown): string | null {
  const load = parseNodeLoad(value);
  return load ? JSON.stringify(load) : null;
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

function rowToNode(row: Record<string, unknown>): NodeRecord {
  return {
    createdAt: Number(row.created_at),
    id: String(row.id),
    lastError: stringOrNull(row.last_error),
    lastHeartbeatAt: numberOrNull(row.last_heartbeat_at),
    load: parseNodeLoad(row.load_json),
    name: String(row.name),
    publicHost: String(row.public_host || ""),
    publicPortEnd: Number(row.public_port_end),
    publicPortStart: Number(row.public_port_start),
    ssMethod: String(row.ss_method || "aes-256-gcm"),
    ssMode: String(row.ss_mode || "tcp_only"),
    ssTimeout: Number(row.ss_timeout || 300),
    status: String(row.status || "active") as NodeStatus,
    updatedAt: Number(row.updated_at)
  };
}

function rowToNodeListItem(row: Record<string, unknown>, now = Date.now()): NodeListItem {
  const node = rowToNode(row);
  return {
    ...node,
    assignedUserCount: Number(row.assigned_user_count || 0),
    online: node.status === "active" && Boolean(node.lastHeartbeatAt && now - node.lastHeartbeatAt <= NODE_ONLINE_WINDOW_MS)
  };
}

function rowToNodeAssignment(row: Record<string, unknown>): NodeAssignment {
  return {
    createdAt: Number(row.created_at),
    enabled: Boolean(Number(row.enabled)),
    id: String(row.id),
    nodeId: String(row.node_id),
    nodeName: String(row.node_name || ""),
    password: String(row.password),
    publicHost: String(row.public_host || ""),
    publicPort: Number(row.public_port),
    serverPort: Number(row.server_port),
    ssMethod: String(row.ss_method || "aes-256-gcm"),
    ssMode: String(row.ss_mode || "tcp_only"),
    ssTimeout: Number(row.ss_timeout || 300),
    updatedAt: Number(row.updated_at),
    userId: String(row.user_id),
    userName: String(row.user_name || ""),
    userStatus: String(row.user_status || "active") as UserStatus
  };
}

function trafficSummaryFromRows(
  rows: Array<{ bytes: number; nodeId?: string | null; port: string; ts: number }>,
  range: string,
  until = Date.now()
): TrafficSummary {
  const normalizedRange = normalizeRange(range);
  const since = until - rangeToMs(normalizedRange);
  const previous = new Map<string, number>();
  const pointsByTimestamp = new Map<number, number>();
  let totalBytes = 0;

  for (const row of rows) {
    const key = `${row.nodeId || ""}:${row.port}`;
    const last = previous.get(key);
    const delta = last === undefined ? 0 : row.bytes >= last ? row.bytes - last : row.bytes;
    previous.set(key, row.bytes);

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

function normalizeSampleRows(rows: Array<{ bytes: number; node_id?: string | null; nodeId?: string | null; port: string; ts: number }>): Array<{ bytes: number; nodeId: string | null; port: string; ts: number }> {
  return rows.map((row) => ({
    bytes: Number(row.bytes),
    nodeId: row.nodeId === undefined ? (row.node_id ? String(row.node_id) : null) : row.nodeId,
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

function createNodeValues(input: CreateNodeInput, now = Date.now()): CreatedNode & { tokenHash: string } {
  const publicPortStart = normalizePort(input.publicPortStart, "节点起始端口");
  const publicPortEnd = input.publicPortEnd === undefined || input.publicPortEnd === null || input.publicPortEnd === ""
    ? publicPortStart
    : normalizePort(input.publicPortEnd, "节点结束端口");

  if (publicPortEnd < publicPortStart) throw new Error("节点结束端口不能小于起始端口");

  const token = createNodeToken();
  return {
    node: {
      createdAt: now,
      id: randomUUID(),
      lastError: null,
      lastHeartbeatAt: null,
      load: null,
      name: normalizeName(input.name),
      publicHost: normalizePublicHost(input.publicHost),
      publicPortEnd,
      publicPortStart,
      ssMethod: normalizeSsMethod(input.ssMethod),
      ssMode: normalizeSsMode(input.ssMode),
      ssTimeout: normalizeSsTimeout(input.ssTimeout),
      status: "active",
      updatedAt: now
    },
    token,
    tokenHash: hashNodeToken(token)
  };
}

function updateNodeValues(existing: NodeRecord, input: UpdateNodeInput): NodeRecord {
  const publicPortStart = input.publicPortStart === undefined
    ? existing.publicPortStart
    : normalizePort(input.publicPortStart, "节点起始端口");
  const publicPortEnd = input.publicPortEnd === undefined || input.publicPortEnd === null || input.publicPortEnd === ""
    ? (input.publicPortStart === undefined ? existing.publicPortEnd : publicPortStart)
    : normalizePort(input.publicPortEnd, "节点结束端口");

  if (publicPortEnd < publicPortStart) throw new Error("节点结束端口不能小于起始端口");

  return {
    ...existing,
    name: input.name === undefined ? existing.name : normalizeName(input.name),
    publicHost: input.publicHost === undefined ? existing.publicHost : normalizePublicHost(input.publicHost),
    publicPortEnd,
    publicPortStart,
    ssMethod: input.ssMethod === undefined ? existing.ssMethod : normalizeSsMethod(input.ssMethod),
    ssMode: input.ssMode === undefined ? existing.ssMode : normalizeSsMode(input.ssMode),
    ssTimeout: input.ssTimeout === undefined ? existing.ssTimeout : normalizeSsTimeout(input.ssTimeout),
    status: input.status === undefined ? existing.status : normalizeNodeStatus(input.status),
    updatedAt: Date.now()
  };
}

function createAssignmentPassword(): string {
  return randomBytes(24).toString("base64url");
}

function quotaRangeToMs(period: QuotaPeriod): number {
  if (period === "daily") return 24 * 60 * 60 * 1000;
  if (period === "weekly") return 7 * 24 * 60 * 60 * 1000;
  if (period === "monthly") return 30 * 24 * 60 * 60 * 1000;
  return 0;
}

function quotaSince(user: UserRecord, now = Date.now()): number | null {
  if (!user.quotaBytes || user.quotaPeriod === "none") return null;
  const windowMs = quotaRangeToMs(user.quotaPeriod);
  return windowMs > 0 ? now - windowMs : null;
}

function normalizeAgentTraffic(value: unknown): NormalizedStat {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const rawPorts = record.ports && typeof record.ports === "object" && !Array.isArray(record.ports)
    ? record.ports as Record<string, unknown>
    : record;
  const ports: Record<string, number> = {};

  for (const [port, bytes] of Object.entries(rawPorts)) {
    const value = Number(bytes);
    if (!Number.isFinite(value) || value < 0) continue;
    ports[String(port)] = Math.round(value);
  }

  return {
    ports,
    totalBytes: Object.values(ports).reduce((sum, bytes) => sum + bytes, 0)
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
      node_id TEXT,
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
    CREATE TABLE IF NOT EXISTS nodes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      public_host TEXT NOT NULL,
      public_port_start INTEGER NOT NULL,
      public_port_end INTEGER NOT NULL,
      ss_method TEXT NOT NULL DEFAULT 'aes-256-gcm',
      ss_mode TEXT NOT NULL DEFAULT 'tcp_only',
      ss_timeout INTEGER NOT NULL DEFAULT 300,
      status TEXT NOT NULL DEFAULT 'active',
      token_hash TEXT NOT NULL UNIQUE,
      token_created_at INTEGER NOT NULL,
      last_heartbeat_at INTEGER,
      last_error TEXT,
      load_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS nodes_status_idx ON nodes (status);
    CREATE TABLE IF NOT EXISTS node_user_assignments (
      id TEXT PRIMARY KEY,
      node_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      server_port INTEGER NOT NULL,
      public_port INTEGER NOT NULL,
      password TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE (node_id, user_id),
      UNIQUE (node_id, server_port),
      UNIQUE (node_id, public_port)
    );
    CREATE INDEX IF NOT EXISTS node_user_assignments_user_idx ON node_user_assignments (user_id, enabled);
    CREATE INDEX IF NOT EXISTS node_user_assignments_node_idx ON node_user_assignments (node_id, enabled);
  `);

  const trafficColumns = db.prepare("PRAGMA table_info(traffic_samples)").all() as Array<{ name: string }>;
  if (!trafficColumns.some((column) => column.name === "node_id")) {
    db.exec("ALTER TABLE traffic_samples ADD COLUMN node_id TEXT");
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS traffic_samples_node_ts_idx ON traffic_samples (node_id, ts);
    CREATE INDEX IF NOT EXISTS traffic_samples_node_port_ts_idx ON traffic_samples (node_id, port, ts);
  `);

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

  const insertSample = db.prepare("INSERT INTO traffic_samples (ts, node_id, port, user_id, bytes) VALUES (?, ?, ?, ?, ?)");
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

  function getNode(nodeId: string): (NodeRecord & { tokenHash: string }) | null {
    const row = db.prepare("SELECT * FROM nodes WHERE id = ?").get(nodeId) as Record<string, unknown> | undefined;
    return row ? { ...rowToNode(row), tokenHash: String(row.token_hash) } : null;
  }

  function assignmentRows(whereSql: string, values: unknown[] = []): NodeAssignment[] {
    const rows = db.prepare(`
      SELECT
        a.*,
        n.name AS node_name,
        n.public_host,
        n.ss_method,
        n.ss_mode,
        n.ss_timeout,
        u.name AS user_name,
        u.status AS user_status
      FROM node_user_assignments a
      JOIN nodes n ON n.id = a.node_id
      JOIN users u ON u.id = a.user_id
      ${whereSql}
      ORDER BY n.name, a.public_port, u.name
    `).all(...values) as Array<Record<string, unknown>>;
    return rows.map(rowToNodeAssignment);
  }

  function usedPortsForNode(nodeId: string): Set<number> {
    const rows = db
      .prepare("SELECT server_port FROM node_user_assignments WHERE node_id = ?")
      .all(nodeId) as Array<{ server_port: number }>;
    return new Set(rows.map((row) => Number(row.server_port)));
  }

  function allocatePortForNode(node: NodeRecord): number {
    const used = usedPortsForNode(node.id);
    for (let port = node.publicPortStart; port <= node.publicPortEnd; port += 1) {
      if (!used.has(port)) return port;
    }
    throw new Error(`节点 ${node.name} 没有可用端口`);
  }

  function ensureAssignment(node: NodeRecord, userId: string, now = Date.now()): void {
    const existing = db
      .prepare("SELECT id FROM node_user_assignments WHERE node_id = ? AND user_id = ?")
      .get(node.id, userId) as { id: string } | undefined;

    if (existing) {
      db.prepare("UPDATE node_user_assignments SET enabled = 1, updated_at = ? WHERE id = ?").run(now, existing.id);
      return;
    }

    const port = allocatePortForNode(node);
    db.prepare(`
      INSERT INTO node_user_assignments (id, node_id, user_id, server_port, public_port, password, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(randomUUID(), node.id, userId, port, port, createAssignmentPassword(), now, now);
  }

  function getUsageSince(userId: string, since: number): number {
    const rows = db
      .prepare(`
        SELECT node_id, port, ts, bytes
        FROM traffic_samples
        WHERE ts >= ? AND user_id = ?
        ORDER BY COALESCE(node_id, ''), port, ts
      `)
      .all(since, userId) as Array<{ bytes: number; node_id: string | null; port: string; ts: number }>;
    return trafficSummaryFromRows(normalizeSampleRows(rows), "24h", Date.now()).totalBytes;
  }

  function enforceQuotasForUsers(userIds: Iterable<string>, now = Date.now()): string[] {
    const disabled: string[] = [];
    for (const userId of new Set(userIds)) {
      const user = getUser(userId);
      if (!user || user.status !== "active" || !user.quotaBytes) continue;
      const since = quotaSince(user, now);
      if (since === null) continue;
      const usage = getUsageSince(user.id, since);
      if (usage < user.quotaBytes) continue;
      db.prepare("UPDATE users SET status = 'over_quota', updated_at = ?, disabled_at = ? WHERE id = ?")
        .run(now, now, user.id);
      insertEvent.run(now, "warn", "用户流量已达上限", stringifyDetail({
        quotaBytes: user.quotaBytes,
        usageBytes: usage,
        userId: user.id,
        userName: user.name
      }));
      disabled.push(user.id);
    }
    return disabled;
  }

  return {
    backend: "sqlite",
    close(): void {
      db.close();
    },
    createNode(input: CreateNodeInput): CreatedNode {
      const created = createNodeValues(input);
      const node = created.node;

      db.prepare(`
        INSERT INTO nodes (
          id, name, public_host, public_port_start, public_port_end, ss_method, ss_mode, ss_timeout,
          status, token_hash, token_created_at, last_heartbeat_at, last_error, load_json, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        node.id,
        node.name,
        node.publicHost,
        node.publicPortStart,
        node.publicPortEnd,
        node.ssMethod,
        node.ssMode,
        node.ssTimeout,
        node.status,
        created.tokenHash,
        node.createdAt,
        node.lastHeartbeatAt,
        node.lastError,
        stringifyNodeLoad(node.load),
        node.createdAt,
        node.updatedAt
      );

      return { node, token: created.token };
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
          INSERT INTO subscription_tokens (id, user_id, token_hash, revoked, created_at, last_accessed_at, revoked_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          tokenRecord.id,
          tokenRecord.userId,
          tokenRecord.tokenHash,
          0,
          tokenRecord.createdAt,
          tokenRecord.lastAccessedAt,
          tokenRecord.revokedAt
        );
        const nodeIds = normalizeNodeIds(input.nodeIds);
        for (const nodeId of nodeIds) {
          const node = getNode(nodeId);
          if (!node) throw new Error(`节点不存在：${nodeId}`);
          ensureAssignment(node, user.id, user.createdAt);
        }
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
    getLatestSamples(): Array<{ bytes: number; nodeId: string | null; port: string; ts: number; userId: string | null }> {
      const rows = db
        .prepare(`
          SELECT s.node_id, s.port, s.bytes, s.ts, s.user_id
          FROM traffic_samples s
          JOIN (
            SELECT COALESCE(node_id, '') AS node_key, port, COALESCE(user_id, '') AS user_key, MAX(id) AS id
            FROM traffic_samples
            GROUP BY COALESCE(node_id, ''), port, COALESCE(user_id, '')
          ) latest ON latest.id = s.id
          ORDER BY s.node_id, s.port
        `)
        .all() as Array<{ bytes: number; node_id: string | null; port: string; ts: number; user_id: string | null }>;
      return rows.map((row) => ({
        bytes: row.bytes,
        nodeId: row.node_id,
        port: row.port,
        ts: row.ts,
        userId: row.user_id
      }));
    },
    getNodeDetail(nodeId: string): { assignments: NodeAssignment[]; node: NodeRecord } | null {
      const node = getNode(nodeId);
      if (!node) return null;
      return {
        assignments: assignmentRows("WHERE a.node_id = ?", [nodeId]),
        node
      };
    },
    getRecordedTotalBytes(): number {
      const rows = db
        .prepare("SELECT node_id, port, ts, bytes FROM traffic_samples WHERE user_id IS NULL ORDER BY COALESCE(node_id, ''), port, ts")
        .all() as Array<{ bytes: number; node_id: string | null; port: string; ts: number }>;
      const previous = new Map<string, number>();
      let total = 0;

      for (const row of rows) {
        const key = `${row.node_id || ""}:${row.port}`;
        const last = previous.get(key);
        if (last !== undefined) {
          total += row.bytes >= last ? row.bytes - last : row.bytes;
        }
        previous.set(key, row.bytes);
      }

      return total;
    },
    getSubscriptionNodesForUser(userId: string): SubscriptionNode[] {
      return assignmentRows(`
        WHERE a.user_id = ?
          AND a.enabled = 1
          AND n.status = 'active'
          AND u.status = 'active'
          AND n.public_host <> ''
      `, [userId]).map((assignment) => ({
        assignmentId: assignment.id,
        method: assignment.ssMethod,
        nodeId: assignment.nodeId,
        nodeName: assignment.nodeName,
        password: assignment.password,
        publicHost: assignment.publicHost,
        publicPort: assignment.publicPort
      }));
    },
    getTraffic(range: string): TrafficSummary {
      const normalizedRange = normalizeRange(range);
      const until = Date.now();
      const since = until - rangeToMs(normalizedRange);
      const rows = db
        .prepare("SELECT node_id, port, ts, bytes FROM traffic_samples WHERE ts >= ? AND user_id IS NULL ORDER BY COALESCE(node_id, ''), port, ts")
        .all(since) as Array<{ bytes: number; node_id: string | null; port: string; ts: number }>;

      return trafficSummaryFromRows(normalizeSampleRows(rows), normalizedRange, until);
    },
    getTrafficByUser(userId: string, range: string): TrafficSummary {
      const normalizedRange = normalizeRange(range);
      const until = Date.now();
      const since = until - rangeToMs(normalizedRange);
      const rows = db
        .prepare("SELECT node_id, port, ts, bytes FROM traffic_samples WHERE ts >= ? AND user_id = ? ORDER BY COALESCE(node_id, ''), port, ts")
        .all(since, userId) as Array<{ bytes: number; node_id: string | null; port: string; ts: number }>;

      return trafficSummaryFromRows(normalizeSampleRows(rows), normalizedRange, until);
    },
    getUserNodeAssignments(userId: string): NodeAssignment[] {
      return assignmentRows("WHERE a.user_id = ?", [userId]);
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
    listNodes(): NodeListItem[] {
      const now = Date.now();
      const rows = db.prepare(`
        SELECT
          n.*,
          COALESCE(a.assigned_user_count, 0) AS assigned_user_count
        FROM nodes n
        LEFT JOIN (
          SELECT node_id, COUNT(*) AS assigned_user_count
          FROM node_user_assignments
          WHERE enabled = 1
          GROUP BY node_id
        ) a ON a.node_id = n.id
        ORDER BY n.created_at DESC
      `).all() as Array<Record<string, unknown>>;
      return rows.map((row) => rowToNodeListItem(row, now));
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
    recordSample(stat: NormalizedStat, ts = Date.now(), userId: string | null = null, nodeId: string | null = null): void {
      db.exec("BEGIN");
      try {
        for (const [port, bytes] of Object.entries(stat.ports)) {
          insertSample.run(ts, nodeId, port, userId, Math.max(0, Math.round(bytes)));
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
    resetNodeToken(nodeId: string): CreatedNode | null {
      const node = getNode(nodeId);
      if (!node) return null;

      const token = createNodeToken();
      const now = Date.now();
      db.prepare("UPDATE nodes SET token_hash = ?, token_created_at = ?, updated_at = ? WHERE id = ?")
        .run(hashNodeToken(token), now, now, nodeId);

      return {
        node: { ...node, updatedAt: now },
        token
      };
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
          INSERT INTO subscription_tokens (id, user_id, token_hash, revoked, created_at, last_accessed_at, revoked_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          tokenRecord.id,
          tokenRecord.userId,
          tokenRecord.tokenHash,
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
    syncNodeAgent(nodeId: string, token: string, input: NodeAgentSyncInput): NodeAgentSyncResult | null {
      const node = getNode(nodeId);
      if (!node || hashNodeToken(token) !== node.tokenHash) return null;

      const now = Date.now();
      const loadJson = stringifyNodeLoad(input.load);
      const lastError = input.lastError === undefined || input.lastError === null ? null : String(input.lastError).slice(0, 1000);
      db.prepare(`
        UPDATE nodes
        SET last_heartbeat_at = ?, last_error = ?, load_json = ?, updated_at = ?
        WHERE id = ?
      `).run(now, lastError, loadJson, now, nodeId);

      const traffic = normalizeAgentTraffic(input.traffic);
      const assignments = assignmentRows("WHERE a.node_id = ?", [nodeId]);
      const assignmentByPort = new Map(assignments.map((assignment) => [String(assignment.serverPort), assignment]));
      const reportedUserIds = new Set<string>();

      db.exec("BEGIN");
      try {
        for (const [port, bytes] of Object.entries(traffic.ports)) {
          const assignment = assignmentByPort.get(String(port));
          const userId = assignment?.enabled ? assignment.userId : null;
          if (userId) reportedUserIds.add(userId);
          insertSample.run(now, nodeId, String(port), userId, Math.max(0, Math.round(bytes)));
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }

      const disabledUserIds = enforceQuotasForUsers(reportedUserIds, now);
      pruneSqlite(db, now);

      const nextNode = getNode(nodeId);
      if (!nextNode) return null;
      const nextAssignments = nextNode.status === "active"
        ? assignmentRows(`
          WHERE a.node_id = ?
            AND a.enabled = 1
            AND u.status = 'active'
        `, [nodeId])
        : [];

      return {
        assignments: nextAssignments.map((assignment) => ({
          assignmentId: assignment.id,
          method: assignment.ssMethod,
          mode: assignment.ssMode,
          password: assignment.password,
          serverPort: assignment.serverPort,
          timeout: assignment.ssTimeout,
          userId: assignment.userId,
          userName: assignment.userName
        })),
        disabledUserIds,
        node: nextNode
      };
    },
    updateNode(nodeId: string, input: UpdateNodeInput): NodeRecord | null {
      const existing = getNode(nodeId);
      if (!existing) return null;
      const next = updateNodeValues(existing, input);

      db.prepare(`
        UPDATE nodes
        SET name = ?, public_host = ?, public_port_start = ?, public_port_end = ?,
            ss_method = ?, ss_mode = ?, ss_timeout = ?, status = ?, updated_at = ?
        WHERE id = ?
      `).run(
        next.name,
        next.publicHost,
        next.publicPortStart,
        next.publicPortEnd,
        next.ssMethod,
        next.ssMode,
        next.ssTimeout,
        next.status,
        next.updatedAt,
        nodeId
      );

      return getNode(nodeId);
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
    },
    updateUserNodeAssignments(userId: string, nodeIdsInput: unknown): NodeAssignment[] | null {
      const user = getUser(userId);
      if (!user) return null;

      const nodeIds = normalizeNodeIds(nodeIdsInput);
      const now = Date.now();
      db.exec("BEGIN");
      try {
        db.prepare("UPDATE node_user_assignments SET enabled = 0, updated_at = ? WHERE user_id = ?").run(now, userId);
        for (const nodeId of nodeIds) {
          const node = getNode(nodeId);
          if (!node) throw new Error(`节点不存在：${nodeId}`);
          ensureAssignment(node, userId, now);
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }

      return assignmentRows("WHERE a.user_id = ?", [userId]);
    }
  };
}

async function initPostgres(pool: { query: (sql: string, values?: unknown[]) => Promise<unknown> }): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS traffic_samples (
      id BIGSERIAL PRIMARY KEY,
      ts BIGINT NOT NULL,
      node_id TEXT,
      port TEXT NOT NULL,
      user_id TEXT,
      bytes BIGINT NOT NULL
    );
    ALTER TABLE traffic_samples ADD COLUMN IF NOT EXISTS node_id TEXT;
    CREATE INDEX IF NOT EXISTS traffic_samples_ts_port_idx ON traffic_samples (ts, port);
    CREATE INDEX IF NOT EXISTS traffic_samples_user_ts_idx ON traffic_samples (user_id, ts);
    CREATE INDEX IF NOT EXISTS traffic_samples_node_ts_idx ON traffic_samples (node_id, ts);
    CREATE INDEX IF NOT EXISTS traffic_samples_node_port_ts_idx ON traffic_samples (node_id, port, ts);
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
    CREATE TABLE IF NOT EXISTS nodes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      public_host TEXT NOT NULL,
      public_port_start INTEGER NOT NULL,
      public_port_end INTEGER NOT NULL,
      ss_method TEXT NOT NULL DEFAULT 'aes-256-gcm',
      ss_mode TEXT NOT NULL DEFAULT 'tcp_only',
      ss_timeout INTEGER NOT NULL DEFAULT 300,
      status TEXT NOT NULL DEFAULT 'active',
      token_hash TEXT NOT NULL UNIQUE,
      token_created_at BIGINT NOT NULL,
      last_heartbeat_at BIGINT,
      last_error TEXT,
      load_json TEXT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS nodes_status_idx ON nodes (status);
    CREATE TABLE IF NOT EXISTS node_user_assignments (
      id TEXT PRIMARY KEY,
      node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      server_port INTEGER NOT NULL,
      public_port INTEGER NOT NULL,
      password TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      UNIQUE (node_id, user_id),
      UNIQUE (node_id, server_port),
      UNIQUE (node_id, public_port)
    );
    CREATE INDEX IF NOT EXISTS node_user_assignments_user_idx ON node_user_assignments (user_id, enabled);
    CREATE INDEX IF NOT EXISTS node_user_assignments_node_idx ON node_user_assignments (node_id, enabled);
  `);
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

  async function getNode(nodeId: string): Promise<(NodeRecord & { tokenHash: string }) | null> {
    const result = await pool.query("SELECT * FROM nodes WHERE id = $1", [nodeId]);
    const row = result.rows[0];
    return row ? { ...rowToNode(row), tokenHash: String(row.token_hash) } : null;
  }

  async function assignmentRows(whereSql: string, values: unknown[] = []): Promise<NodeAssignment[]> {
    const result = await pool.query(`
      SELECT
        a.*,
        n.name AS node_name,
        n.public_host,
        n.ss_method,
        n.ss_mode,
        n.ss_timeout,
        u.name AS user_name,
        u.status AS user_status
      FROM node_user_assignments a
      JOIN nodes n ON n.id = a.node_id
      JOIN users u ON u.id = a.user_id
      ${whereSql}
      ORDER BY n.name, a.public_port, u.name
    `, values);
    return result.rows.map(rowToNodeAssignment);
  }

  async function allocatePortForNode(node: NodeRecord): Promise<number> {
    const result = await pool.query("SELECT server_port FROM node_user_assignments WHERE node_id = $1", [node.id]);
    const used = new Set(result.rows.map((row: Record<string, unknown>) => Number(row.server_port)));
    for (let port = node.publicPortStart; port <= node.publicPortEnd; port += 1) {
      if (!used.has(port)) return port;
    }
    throw new Error(`节点 ${node.name} 没有可用端口`);
  }

  async function ensureAssignment(
    client: { query: (sql: string, values?: unknown[]) => Promise<unknown> },
    node: NodeRecord,
    userId: string,
    now = Date.now()
  ): Promise<void> {
    const existing = await client.query(
      "SELECT id FROM node_user_assignments WHERE node_id = $1 AND user_id = $2",
      [node.id, userId]
    ) as { rows: Array<{ id: string }> };

    if (existing.rows[0]) {
      await client.query("UPDATE node_user_assignments SET enabled = 1, updated_at = $1 WHERE id = $2", [now, existing.rows[0].id]);
      return;
    }

    const port = await allocatePortForNode(node);
    await client.query(`
      INSERT INTO node_user_assignments (id, node_id, user_id, server_port, public_port, password, enabled, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $8)
    `, [randomUUID(), node.id, userId, port, port, createAssignmentPassword(), now, now]);
  }

  async function getUsageSince(userId: string, since: number): Promise<number> {
    const result = await pool.query(`
      SELECT node_id, port, ts, bytes
      FROM traffic_samples
      WHERE ts >= $1 AND user_id = $2
      ORDER BY COALESCE(node_id, ''), port, ts
    `, [since, userId]);
    return trafficSummaryFromRows(normalizeSampleRows(result.rows), "24h", Date.now()).totalBytes;
  }

  async function enforceQuotasForUsers(userIds: Iterable<string>, now = Date.now()): Promise<string[]> {
    const disabled: string[] = [];
    for (const userId of new Set(userIds)) {
      const user = await getUser(userId);
      if (!user || user.status !== "active" || !user.quotaBytes) continue;
      const since = quotaSince(user, now);
      if (since === null) continue;
      const usage = await getUsageSince(user.id, since);
      if (usage < user.quotaBytes) continue;
      await pool.query(
        "UPDATE users SET status = 'over_quota', updated_at = $1, disabled_at = $2 WHERE id = $3",
        [now, now, user.id]
      );
      await pool.query(
        "INSERT INTO events (ts, level, message, detail) VALUES ($1, $2, $3, $4)",
        [now, "warn", "用户流量已达上限", stringifyDetail({
          quotaBytes: user.quotaBytes,
          usageBytes: usage,
          userId: user.id,
          userName: user.name
        })]
      );
      disabled.push(user.id);
    }
    return disabled;
  }

  return {
    backend: "postgres",
    async close(): Promise<void> {
      await pool.end();
    },
    async createNode(input: CreateNodeInput): Promise<CreatedNode> {
      const created = createNodeValues(input);
      const node = created.node;
      await pool.query(`
        INSERT INTO nodes (
          id, name, public_host, public_port_start, public_port_end, ss_method, ss_mode, ss_timeout,
          status, token_hash, token_created_at, last_heartbeat_at, last_error, load_json, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      `, [
        node.id,
        node.name,
        node.publicHost,
        node.publicPortStart,
        node.publicPortEnd,
        node.ssMethod,
        node.ssMode,
        node.ssTimeout,
        node.status,
        created.tokenHash,
        node.createdAt,
        node.lastHeartbeatAt,
        node.lastError,
        stringifyNodeLoad(node.load),
        node.createdAt,
        node.updatedAt
      ]);
      return { node, token: created.token };
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
          INSERT INTO subscription_tokens (id, user_id, token_hash, revoked, created_at, last_accessed_at, revoked_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [
          tokenRecord.id,
          tokenRecord.userId,
          tokenRecord.tokenHash,
          0,
          tokenRecord.createdAt,
          tokenRecord.lastAccessedAt,
          tokenRecord.revokedAt
        ]);
        const nodeIds = normalizeNodeIds(input.nodeIds);
        for (const nodeId of nodeIds) {
          const node = await getNode(nodeId);
          if (!node) throw new Error(`节点不存在：${nodeId}`);
          await ensureAssignment(client, node, user.id, user.createdAt);
        }
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
    async getLatestSamples(): Promise<Array<{ bytes: number; nodeId: string | null; port: string; ts: number; userId: string | null }>> {
      const result = await pool.query(`
        SELECT s.node_id, s.port, s.bytes, s.ts, s.user_id
        FROM traffic_samples s
        JOIN (
          SELECT COALESCE(node_id, '') AS node_key, port, COALESCE(user_id, '') AS user_key, MAX(id) AS id
          FROM traffic_samples
          GROUP BY COALESCE(node_id, ''), port, COALESCE(user_id, '')
        ) latest ON latest.id = s.id
        ORDER BY s.node_id, s.port
      `);
      return result.rows.map((row: Record<string, unknown>) => ({
        bytes: Number(row.bytes),
        nodeId: row.node_id ? String(row.node_id) : null,
        port: String(row.port),
        ts: Number(row.ts),
        userId: row.user_id ? String(row.user_id) : null
      }));
    },
    async getNodeDetail(nodeId: string): Promise<{ assignments: NodeAssignment[]; node: NodeRecord } | null> {
      const node = await getNode(nodeId);
      if (!node) return null;
      return {
        assignments: await assignmentRows("WHERE a.node_id = $1", [nodeId]),
        node
      };
    },
    async getRecordedTotalBytes(): Promise<number> {
      const result = await pool.query("SELECT node_id, port, ts, bytes FROM traffic_samples WHERE user_id IS NULL ORDER BY COALESCE(node_id, ''), port, ts");
      const previous = new Map<string, number>();
      let total = 0;

      for (const row of normalizeSampleRows(result.rows)) {
        const key = `${row.nodeId || ""}:${row.port}`;
        const last = previous.get(key);
        if (last !== undefined) {
          total += row.bytes >= last ? row.bytes - last : row.bytes;
        }
        previous.set(key, row.bytes);
      }

      return total;
    },
    async getSubscriptionNodesForUser(userId: string): Promise<SubscriptionNode[]> {
      const rows = await assignmentRows(`
        WHERE a.user_id = $1
          AND a.enabled = 1
          AND n.status = 'active'
          AND u.status = 'active'
          AND n.public_host <> ''
      `, [userId]);
      return rows.map((assignment) => ({
        assignmentId: assignment.id,
        method: assignment.ssMethod,
        nodeId: assignment.nodeId,
        nodeName: assignment.nodeName,
        password: assignment.password,
        publicHost: assignment.publicHost,
        publicPort: assignment.publicPort
      }));
    },
    async getTraffic(range: string): Promise<TrafficSummary> {
      const normalizedRange = normalizeRange(range);
      const until = Date.now();
      const since = until - rangeToMs(normalizedRange);
      const result = await pool.query(
        "SELECT node_id, port, ts, bytes FROM traffic_samples WHERE ts >= $1 AND user_id IS NULL ORDER BY COALESCE(node_id, ''), port, ts",
        [since]
      );
      return trafficSummaryFromRows(normalizeSampleRows(result.rows), normalizedRange, until);
    },
    async getTrafficByUser(userId: string, range: string): Promise<TrafficSummary> {
      const normalizedRange = normalizeRange(range);
      const until = Date.now();
      const since = until - rangeToMs(normalizedRange);
      const result = await pool.query(
        "SELECT node_id, port, ts, bytes FROM traffic_samples WHERE ts >= $1 AND user_id = $2 ORDER BY COALESCE(node_id, ''), port, ts",
        [since, userId]
      );
      return trafficSummaryFromRows(normalizeSampleRows(result.rows), normalizedRange, until);
    },
    async getUserNodeAssignments(userId: string): Promise<NodeAssignment[]> {
      return await assignmentRows("WHERE a.user_id = $1", [userId]);
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
    async listNodes(): Promise<NodeListItem[]> {
      const now = Date.now();
      const result = await pool.query(`
        SELECT
          n.*,
          COALESCE(a.assigned_user_count, 0) AS assigned_user_count
        FROM nodes n
        LEFT JOIN (
          SELECT node_id, COUNT(*) AS assigned_user_count
          FROM node_user_assignments
          WHERE enabled = 1
          GROUP BY node_id
        ) a ON a.node_id = n.id
        ORDER BY n.created_at DESC
      `);
      return result.rows.map((row: Record<string, unknown>) => rowToNodeListItem(row, now));
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
    async recordSample(stat: NormalizedStat, ts = Date.now(), userId: string | null = null, nodeId: string | null = null): Promise<void> {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        for (const [port, bytes] of Object.entries(stat.ports)) {
          await client.query(
            "INSERT INTO traffic_samples (ts, node_id, port, user_id, bytes) VALUES ($1, $2, $3, $4, $5)",
            [ts, nodeId, port, userId, Math.max(0, Math.round(bytes))]
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
    async resetNodeToken(nodeId: string): Promise<CreatedNode | null> {
      const node = await getNode(nodeId);
      if (!node) return null;

      const token = createNodeToken();
      const now = Date.now();
      await pool.query(
        "UPDATE nodes SET token_hash = $1, token_created_at = $2, updated_at = $3 WHERE id = $4",
        [hashNodeToken(token), now, now, nodeId]
      );
      return {
        node: { ...node, updatedAt: now },
        token
      };
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
          INSERT INTO subscription_tokens (id, user_id, token_hash, revoked, created_at, last_accessed_at, revoked_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [
          tokenRecord.id,
          tokenRecord.userId,
          tokenRecord.tokenHash,
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
    async syncNodeAgent(nodeId: string, token: string, input: NodeAgentSyncInput): Promise<NodeAgentSyncResult | null> {
      const node = await getNode(nodeId);
      if (!node || hashNodeToken(token) !== node.tokenHash) return null;

      const now = Date.now();
      const loadJson = stringifyNodeLoad(input.load);
      const lastError = input.lastError === undefined || input.lastError === null ? null : String(input.lastError).slice(0, 1000);
      await pool.query(`
        UPDATE nodes
        SET last_heartbeat_at = $1, last_error = $2, load_json = $3, updated_at = $4
        WHERE id = $5
      `, [now, lastError, loadJson, now, nodeId]);

      const traffic = normalizeAgentTraffic(input.traffic);
      const assignments = await assignmentRows("WHERE a.node_id = $1", [nodeId]);
      const assignmentByPort = new Map(assignments.map((assignment) => [String(assignment.serverPort), assignment]));
      const reportedUserIds = new Set<string>();
      const client = await pool.connect();

      try {
        await client.query("BEGIN");
        for (const [port, bytes] of Object.entries(traffic.ports)) {
          const assignment = assignmentByPort.get(String(port));
          const userId = assignment?.enabled ? assignment.userId : null;
          if (userId) reportedUserIds.add(userId);
          await client.query(
            "INSERT INTO traffic_samples (ts, node_id, port, user_id, bytes) VALUES ($1, $2, $3, $4, $5)",
            [now, nodeId, String(port), userId, Math.max(0, Math.round(bytes))]
          );
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }

      const disabledUserIds = await enforceQuotasForUsers(reportedUserIds, now);
      await prunePostgres(pool, now);

      const nextNode = await getNode(nodeId);
      if (!nextNode) return null;
      const nextAssignments = nextNode.status === "active"
        ? await assignmentRows(`
          WHERE a.node_id = $1
            AND a.enabled = 1
            AND u.status = 'active'
        `, [nodeId])
        : [];

      return {
        assignments: nextAssignments.map((assignment) => ({
          assignmentId: assignment.id,
          method: assignment.ssMethod,
          mode: assignment.ssMode,
          password: assignment.password,
          serverPort: assignment.serverPort,
          timeout: assignment.ssTimeout,
          userId: assignment.userId,
          userName: assignment.userName
        })),
        disabledUserIds,
        node: nextNode
      };
    },
    async updateNode(nodeId: string, input: UpdateNodeInput): Promise<NodeRecord | null> {
      const existing = await getNode(nodeId);
      if (!existing) return null;
      const next = updateNodeValues(existing, input);

      await pool.query(`
        UPDATE nodes
        SET name = $1, public_host = $2, public_port_start = $3, public_port_end = $4,
            ss_method = $5, ss_mode = $6, ss_timeout = $7, status = $8, updated_at = $9
        WHERE id = $10
      `, [
        next.name,
        next.publicHost,
        next.publicPortStart,
        next.publicPortEnd,
        next.ssMethod,
        next.ssMode,
        next.ssTimeout,
        next.status,
        next.updatedAt,
        nodeId
      ]);

      return await getNode(nodeId);
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
    },
    async updateUserNodeAssignments(userId: string, nodeIdsInput: unknown): Promise<NodeAssignment[] | null> {
      const user = await getUser(userId);
      if (!user) return null;

      const nodeIds = normalizeNodeIds(nodeIdsInput);
      const now = Date.now();
      const client = await pool.connect();

      try {
        await client.query("BEGIN");
        await client.query("UPDATE node_user_assignments SET enabled = 0, updated_at = $1 WHERE user_id = $2", [now, userId]);
        for (const nodeId of nodeIds) {
          const node = await getNode(nodeId);
          if (!node) throw new Error(`节点不存在：${nodeId}`);
          await ensureAssignment(client, node, userId, now);
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }

      return await assignmentRows("WHERE a.user_id = $1", [userId]);
    }
  };
}

export async function openConfiguredStore(options: { dataDir: string; databaseUrl: string }): Promise<Store> {
  if (options.databaseUrl) return await openPostgresStore(options.databaseUrl);
  return openStore(options.dataDir);
}
