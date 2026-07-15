import os from "node:os";
import {
  addServer,
  listServers,
  pingManager,
  removeServer,
  type ManagerClientOptions,
  type NormalizedServer,
  type NormalizedStat
} from "./managerClient.ts";

type AgentAssignment = {
  assignmentId: string;
  method: string;
  mode: string;
  password: string;
  serverPort: number;
  timeout: number;
  userId: string;
  userName: string;
};

type AgentConfig = {
  adminBaseUrl: string;
  intervalMs: number;
  manager: ManagerClientOptions;
  nodeId: string;
  nodeToken: string;
  serverBindAddress: string;
};

type AgentSyncResult = {
  assignments: AgentAssignment[];
};

function readNumber(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

export function readAgentConfig(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  const adminBaseUrl = String(env.ADMIN_BASE_URL || "").replace(/\/+$/, "");
  const nodeId = String(env.NODE_ID || "").trim();
  const nodeToken = String(env.NODE_TOKEN || "").trim();

  if (!adminBaseUrl) throw new Error("ADMIN_BASE_URL is required");
  if (!nodeId) throw new Error("NODE_ID is required");
  if (!nodeToken) throw new Error("NODE_TOKEN is required");

  return {
    adminBaseUrl,
    intervalMs: readNumber(env, "AGENT_INTERVAL_MS", 15000),
    manager: {
      host: env.SS_MANAGER_HOST || "127.0.0.1",
      port: readNumber(env, "SS_MANAGER_PORT", 6100),
      timeoutMs: readNumber(env, "SS_MANAGER_TIMEOUT_MS", 2500)
    },
    nodeId,
    nodeToken,
    serverBindAddress: env.SS_BIND_ADDRESS || "::"
  };
}

function loadSnapshot(config: AgentConfig): {
  activeServers: number;
  lastError: string | null;
  servers: NormalizedServer[];
  traffic: NormalizedStat;
} {
  return {
    activeServers: 0,
    lastError: null,
    servers: [],
    traffic: { ports: {}, totalBytes: 0 }
  };
}

async function readManagerSnapshot(config: AgentConfig): Promise<{
  activeServers: number;
  lastError: string | null;
  servers: NormalizedServer[];
  traffic: NormalizedStat;
}> {
  const snapshot = loadSnapshot(config);

  try {
    const ping = await pingManager(config.manager);
    snapshot.traffic = ping.stat;
  } catch (error) {
    snapshot.lastError = error instanceof Error ? error.message : String(error);
  }

  try {
    const list = await listServers(config.manager);
    snapshot.servers = list.servers;
    snapshot.activeServers = list.servers.length;
  } catch (error) {
    snapshot.lastError = snapshot.lastError || (error instanceof Error ? error.message : String(error));
  }

  return snapshot;
}

async function syncWithAdmin(
  config: AgentConfig,
  snapshot: Awaited<ReturnType<typeof readManagerSnapshot>>
): Promise<AgentSyncResult> {
  const response = await fetch(`${config.adminBaseUrl}/api/node-agent/sync`, {
    body: JSON.stringify({
      lastError: snapshot.lastError,
      load: {
        activeServers: snapshot.activeServers,
        loadAvg: os.loadavg(),
        managerOnline: !snapshot.lastError,
        memoryFree: os.freemem(),
        memoryTotal: os.totalmem(),
        uptimeSeconds: Math.round(os.uptime())
      },
      nodeId: config.nodeId,
      traffic: snapshot.traffic
    }),
    headers: {
      Authorization: `Bearer ${config.nodeToken}`,
      "Content-Type": "application/json"
    },
    method: "POST"
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Admin sync failed: HTTP ${response.status}${body ? ` ${body}` : ""}`);
  }

  return await response.json() as AgentSyncResult;
}

async function reconcileServers(
  config: AgentConfig,
  currentServers: NormalizedServer[],
  assignments: AgentAssignment[]
): Promise<void> {
  const desired = new Map(assignments.map((assignment) => [String(assignment.serverPort), assignment]));
  const current = new Map(currentServers.map((server) => [String(server.port), server]));

  for (const server of currentServers) {
    const assignment = desired.get(String(server.port));
    const methodChanged = assignment && server.method && server.method !== assignment.method;
    if (assignment && !methodChanged) continue;
    await removeServer(config.manager, server.port);
  }

  for (const assignment of assignments) {
    const currentServer = current.get(String(assignment.serverPort));
    if (currentServer && (!currentServer.method || currentServer.method === assignment.method)) continue;
    await addServer(config.manager, {
      method: assignment.method,
      mode: assignment.mode,
      password: assignment.password,
      server: config.serverBindAddress,
      serverPort: assignment.serverPort,
      timeout: assignment.timeout
    });
  }
}

export async function runAgentOnce(config = readAgentConfig()): Promise<void> {
  const snapshot = await readManagerSnapshot(config);
  const sync = await syncWithAdmin(config, snapshot);
  await reconcileServers(config, snapshot.servers, sync.assignments || []);
  console.log(`node-agent synced ${sync.assignments?.length || 0} assignment(s)`);
}

async function runForever(): Promise<void> {
  const config = readAgentConfig();

  for (;;) {
    try {
      await runAgentOnce(config);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
    }
    await new Promise((resolve) => setTimeout(resolve, config.intervalMs));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runForever();
}
