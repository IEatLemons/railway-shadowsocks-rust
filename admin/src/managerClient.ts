import dgram from "node:dgram";
import { lookup } from "node:dns/promises";
import net from "node:net";

export type ManagerClientOptions = {
  host: string;
  port: number;
  timeoutMs: number;
};

export type ParsedManagerResponse = {
  payload: unknown;
  raw: string;
  type: string;
};

export type NormalizedStat = {
  ports: Record<string, number>;
  totalBytes: number;
};

export type NormalizedServer = {
  method?: string;
  port: string;
  raw: unknown;
};

function parseJsonLike(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

export function parseManagerResponse(raw: string): ParsedManagerResponse {
  const trimmed = raw.trim();
  const separator = trimmed.indexOf(":");

  if (separator === -1) {
    return {
      payload: parseJsonLike(trimmed),
      raw,
      type: trimmed
    };
  }

  const type = trimmed.slice(0, separator).trim();
  const body = trimmed.slice(separator + 1);

  return {
    payload: parseJsonLike(body),
    raw,
    type
  };
}

function sumNumericLeaves(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, value);
  if (!value || typeof value !== "object") return 0;

  let total = 0;
  for (const item of Object.values(value as Record<string, unknown>)) {
    total += sumNumericLeaves(item);
  }
  return total;
}

export function normalizeStat(payload: unknown): NormalizedStat {
  const ports: Record<string, number> = {};

  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    for (const [port, value] of Object.entries(payload as Record<string, unknown>)) {
      ports[String(port)] = sumNumericLeaves(value);
    }
  }

  const totalBytes = Object.values(ports).reduce((sum, value) => sum + value, 0);
  return { ports, totalBytes };
}

export function normalizeServers(payload: unknown): NormalizedServer[] {
  if (Array.isArray(payload)) {
    return payload.map((item) => {
      if (typeof item === "number" || typeof item === "string") {
        return { port: String(item), raw: item };
      }

      if (item && typeof item === "object") {
        const record = item as Record<string, unknown>;
        return {
          method: typeof record.method === "string" ? record.method : undefined,
          port: String(record.server_port || record.port || "unknown"),
          raw: item
        };
      }

      return { port: "unknown", raw: item };
    });
  }

  if (payload && typeof payload === "object") {
    return Object.entries(payload as Record<string, unknown>).map(([port, value]) => {
      const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
      return {
        method: typeof record.method === "string" ? record.method : undefined,
        port,
        raw: value
      };
    });
  }

  return [];
}

async function resolveAddress(host: string): Promise<{ address: string; family: 4 | 6 }> {
  const literalFamily = net.isIP(host);
  if (literalFamily === 4 || literalFamily === 6) {
    return { address: host, family: literalFamily };
  }

  const result = await lookup(host);
  return {
    address: result.address,
    family: result.family === 6 ? 6 : 4
  };
}

export async function sendManagerCommand(options: ManagerClientOptions, command: string): Promise<string> {
  if (!options.host) throw new Error("管理接口地址为空");

  const target = await resolveAddress(options.host);
  const socket = dgram.createSocket(target.family === 6 ? "udp6" : "udp4");
  const payload = Buffer.from(command);

  return await new Promise<string>((resolve, reject) => {
    let settled = false;

    const finish = (error: Error | null, message?: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.close();
      if (error) reject(error);
      else resolve(message || "");
    };

    const timer = setTimeout(() => {
      finish(new Error(`管理接口命令 "${command}" 在 ${options.timeoutMs}ms 后超时`));
    }, options.timeoutMs);

    socket.once("message", (message) => finish(null, message.toString("utf8")));
    socket.once("error", (error) => finish(error));
    socket.send(payload, options.port, target.address, (error) => {
      if (error) finish(error);
    });
  });
}

export async function pingManager(options: ManagerClientOptions): Promise<{
  raw: string;
  stat: NormalizedStat;
}> {
  const raw = await sendManagerCommand(options, "ping");
  const parsed = parseManagerResponse(raw);
  const payload = parsed.type === "stat" ? parsed.payload : {};
  return {
    raw,
    stat: normalizeStat(payload)
  };
}

export async function listServers(options: ManagerClientOptions): Promise<{
  raw: string;
  servers: NormalizedServer[];
}> {
  const raw = await sendManagerCommand(options, "list");
  const parsed = parseManagerResponse(raw);
  return {
    raw,
    servers: normalizeServers(parsed.payload)
  };
}
