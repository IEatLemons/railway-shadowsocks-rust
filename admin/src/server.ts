import fs from "node:fs";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { clearSessionCookie, createSessionManager, getSessionToken, safeEqualString, setSessionCookie } from "./auth.ts";
import { getConfigWarnings, readConfig, type AppConfig } from "./config.ts";
import { listServers, pingManager, type NormalizedServer } from "./managerClient.ts";
import { openStore, type Store } from "./store.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, "../public");
const startedAt = new Date();

type JsonRecord = Record<string, unknown>;

type ManagerSnapshot = {
  lastError: string | null;
  listRaw: string | null;
  online: boolean;
  pingRaw: string | null;
  servers: NormalizedServer[];
  totalBytes: number;
};

function json(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
    "Content-Type": "application/json; charset=utf-8"
  });
  res.end(body);
}

function text(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
    "Content-Type": "text/plain; charset=utf-8"
  });
  res.end(body);
}

function methodNotAllowed(res: ServerResponse): void {
  json(res, 405, { error: "method_not_allowed" });
}

async function readJsonBody(req: IncomingMessage): Promise<JsonRecord> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1024 * 1024) throw new Error("Request body is too large");
    chunks.push(buffer);
  }

  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as JsonRecord;
}

function mimeType(filePath: string): string {
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  return "application/octet-stream";
}

function serveStatic(res: ServerResponse, pathname: string): void {
  const normalized = pathname === "/" ? "/index.html" : pathname;
  const requested = path.normalize(normalized).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(publicDir, requested);

  if (!filePath.startsWith(publicDir)) {
    text(res, 403, "Forbidden");
    return;
  }

  const target = fs.existsSync(filePath) && fs.statSync(filePath).isFile()
    ? filePath
    : path.join(publicDir, "index.html");
  const body = fs.readFileSync(target);

  res.writeHead(200, {
    "Cache-Control": target.endsWith("index.html") ? "no-store" : "public, max-age=300",
    "Content-Length": body.length,
    "Content-Type": mimeType(target)
  });
  res.end(body);
}

function buildClientConfig(config: AppConfig): JsonRecord {
  const server = config.publicSsHost || "YOUR_RAILWAY_TCP_PROXY_HOST";
  const port = config.publicSsPort || "YOUR_RAILWAY_TCP_PROXY_PORT";
  const clashYaml = [
    "proxies:",
    "  - name: railway-fixed-ip",
    "    type: ss",
    `    server: ${server}`,
    `    port: ${port}`,
    `    cipher: ${config.ssMethod}`,
    "    password: YOUR_SS_PASSWORD",
    "    udp: false",
    "",
    "proxy-groups:",
    "  - name: FixedIP",
    "    type: select",
    "    proxies:",
    "      - railway-fixed-ip",
    "      - DIRECT",
    "",
    "rules:",
    "  - DOMAIN-SUFFIX,example.com,FixedIP",
    "  - MATCH,DIRECT"
  ].join("\n");

  return {
    clashYaml,
    method: config.ssMethod,
    publicHost: config.publicSsHost,
    publicPort: config.publicSsPort,
    ssPort: config.ssPort
  };
}

function shouldLogError(last: { message: string; ts: number } | null, message: string): boolean {
  if (!last) return true;
  if (last.message !== message) return true;
  return Date.now() - last.ts > 60_000;
}

export function createAdminServer(config: AppConfig, store: Store): http.Server {
  const sessions = createSessionManager();
  let lastManagerError: { message: string; ts: number } | null = null;

  async function readManagerSnapshot(): Promise<ManagerSnapshot> {
    const options = {
      host: config.managerHost,
      port: config.managerPort,
      timeoutMs: config.managerTimeoutMs
    };
    let lastError: string | null = null;
    let pingRaw: string | null = null;
    let listRaw: string | null = null;
    let totalBytes = 0;
    let servers: NormalizedServer[] = [];

    try {
      const ping = await pingManager(options);
      pingRaw = ping.raw;
      totalBytes = ping.stat.totalBytes;
      if (Object.keys(ping.stat.ports).length > 0) store.recordSample(ping.stat);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    try {
      const list = await listServers(options);
      listRaw = list.raw;
      servers = list.servers;
    } catch (error) {
      lastError = lastError || (error instanceof Error ? error.message : String(error));
    }

    if (lastError && shouldLogError(lastManagerError, lastError)) {
      lastManagerError = { message: lastError, ts: Date.now() };
      store.recordEvent("error", "管理接口连接失败", lastError);
    }

    return {
      lastError,
      listRaw,
      online: !lastError,
      pingRaw,
      servers,
      totalBytes
    };
  }

  function requireSession(req: IncomingMessage, res: ServerResponse): boolean {
    const session = sessions.get(getSessionToken(req));
    if (!session) {
      json(res, 401, { error: "unauthorized" });
      return false;
    }
    return true;
  }

  async function routeApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    if (url.pathname === "/api/login") {
      if (req.method !== "POST") return methodNotAllowed(res);

      try {
        const body = await readJsonBody(req);
        const username = String(body.username || "");
        const password = String(body.password || "");
        const valid =
          safeEqualString(username, config.adminUsername) &&
          safeEqualString(password, config.adminPassword);

        if (!valid) {
          store.recordEvent("warn", "管理员登录失败", { username });
          return json(res, 401, { error: "invalid_credentials" });
        }

        const token = sessions.create(config.adminUsername);
        setSessionCookie(res, token, config.cookieSecure);
        store.recordEvent("info", "管理员登录成功", { username: config.adminUsername });
        return json(res, 200, { username: config.adminUsername });
      } catch (error) {
        return json(res, 400, { error: "bad_request", message: error instanceof Error ? error.message : String(error) });
      }
    }

    if (url.pathname === "/api/logout") {
      if (req.method !== "POST") return methodNotAllowed(res);
      sessions.destroy(getSessionToken(req));
      clearSessionCookie(res, config.cookieSecure);
      return json(res, 200, { ok: true });
    }

    if (url.pathname === "/api/me") {
      const session = sessions.get(getSessionToken(req));
      if (!session) return json(res, 401, { error: "unauthorized" });
      return json(res, 200, { username: session.username });
    }

    if (!requireSession(req, res)) return;

    if (url.pathname === "/api/status") {
      if (req.method !== "GET") return methodNotAllowed(res);
      const snapshot = await readManagerSnapshot();
      const latestSamples = store.getLatestSamples();
      return json(res, 200, {
        admin: {
          dataDir: store.dataDir,
          generatedAt: new Date().toISOString(),
          startedAt: startedAt.toISOString(),
          uptimeSeconds: Math.round(process.uptime())
        },
        configWarnings: getConfigWarnings(config),
        manager: {
          host: config.managerHost,
          lastError: snapshot.lastError,
          lastHeartbeat: snapshot.online ? new Date().toISOString() : null,
          listRaw: snapshot.listRaw,
          online: snapshot.online,
          pingRaw: snapshot.pingRaw,
          port: config.managerPort
        },
        shadowsocks: {
          method: config.ssMethod,
          passwordConfigured: config.ssPasswordConfigured,
          publicHost: config.publicSsHost,
          publicPort: config.publicSsPort,
          ssPort: config.ssPort,
          timeout: config.ssTimeout
        },
        servers: snapshot.servers,
        traffic: {
          currentTotalBytes: snapshot.totalBytes,
          latestSamples,
          recordedTotalBytes: store.getRecordedTotalBytes()
        }
      });
    }

    if (url.pathname === "/api/traffic") {
      if (req.method !== "GET") return methodNotAllowed(res);
      return json(res, 200, store.getTraffic(url.searchParams.get("range") || "24h"));
    }

    if (url.pathname === "/api/client-config") {
      if (req.method !== "GET") return methodNotAllowed(res);
      return json(res, 200, buildClientConfig(config));
    }

    if (url.pathname === "/api/events") {
      if (req.method !== "GET") return methodNotAllowed(res);
      return json(res, 200, { events: store.getEvents(100) });
    }

    return json(res, 404, { error: "not_found" });
  }

  return http.createServer((req, res) => {
    const host = req.headers.host || "localhost";
    const url = new URL(req.url || "/", `http://${host}`);

    if (url.pathname === "/healthz") {
      return json(res, 200, { ok: true });
    }

    if (url.pathname.startsWith("/api/")) {
      routeApi(req, res, url).catch((error) => {
        store.recordEvent("error", "后台接口异常", error instanceof Error ? error.stack : String(error));
        json(res, 500, { error: "internal_error" });
      });
      return;
    }

    serveStatic(res, url.pathname);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = readConfig();
  const store = openStore(config.dataDir);
  const server = createAdminServer(config, store);

  server.listen(config.port, () => {
    store.recordEvent("info", "管理服务已启动", { port: config.port, dataDir: store.dataDir });
    console.log(`管理服务正在监听 ${config.port}`);
  });

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      server.close(() => {
        store.recordEvent("info", "管理服务已停止", { signal });
        store.close();
        process.exit(0);
      });
    });
  }
}
