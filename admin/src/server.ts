import fs from "node:fs";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { clearSessionCookie, createSessionManager, getSessionToken, safeEqualString, setSessionCookie } from "./auth.ts";
import { buildClientConfig, buildUserClashYaml, buildUserSsSubscription, mergeClashConfig } from "./clientConfig.ts";
import { getConfigWarnings, readConfig, type AppConfig } from "./config.ts";
import { listServers, pingManager, type NormalizedServer } from "./managerClient.ts";
import { hashSubscriptionToken, openConfiguredStore, type CreatedSubscription, type Store, type UserStatus } from "./store.ts";

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

function content(res: ServerResponse, status: number, body: string, contentType: string): void {
  res.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
    "Content-Type": contentType
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
  const normalized = pathname === "/"
    ? "/index.html"
    : pathname === "/guide" || pathname === "/guide/"
      ? "/guide.html"
      : pathname;
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
  const noStore = target.endsWith("index.html") || target.endsWith("guide.html");

  res.writeHead(200, {
    "Cache-Control": noStore ? "no-store" : "public, max-age=300",
    "Content-Length": body.length,
    "Content-Type": mimeType(target)
  });
  res.end(body);
}

function shouldLogError(last: { message: string; ts: number } | null, message: string): boolean {
  if (!last) return true;
  if (last.message !== message) return true;
  return Date.now() - last.ts > 60_000;
}

function firstHeaderValue(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return String(raw || "").split(",")[0].trim();
}

function requestIp(req: IncomingMessage): string | null {
  return firstHeaderValue(req.headers["x-forwarded-for"]) || req.socket.remoteAddress || null;
}

function subscriptionBaseUrl(req: IncomingMessage, config: AppConfig): string {
  const host = req.headers.host || "localhost";
  const forwardedProto = firstHeaderValue(req.headers["x-forwarded-proto"]);
  const proto = forwardedProto || (config.cookieSecure ? "https" : "http");
  return `${proto}://${host}`;
}

function subscriptionUrls(req: IncomingMessage, config: AppConfig, token: string): {
  clashUrl: string;
  ssUrl: string;
} {
  const baseUrl = subscriptionBaseUrl(req, config);
  const encoded = encodeURIComponent(token);
  return {
    clashUrl: `${baseUrl}/sub/${encoded}/clash.yaml`,
    ssUrl: `${baseUrl}/sub/${encoded}/ss.txt`
  };
}

function subscriptionPayload(req: IncomingMessage, config: AppConfig, created: CreatedSubscription): {
  clashUrl: string;
  ssUrl: string;
} {
  return subscriptionUrls(req, config, created.token);
}

function subscriptionReady(config: AppConfig): string | null {
  if (!config.publicSsHost) return "PUBLIC_SS_HOST is not configured";
  if (!config.publicSsPort) return "PUBLIC_SS_PORT is not configured";
  if (!config.ssPassword) return "SS_PASSWORD is not available to the admin service";
  return null;
}

function bearerToken(req: IncomingMessage): string {
  const header = String(req.headers.authorization || "");
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : "";
}

function userTrafficMode(hasNodes = false) {
  if (hasNodes) {
    return {
      mode: "multi_node_per_user_port",
      perUserReliable: true,
      message: "多节点模式已启用：每个用户在每个节点使用独立端口和密码，后台可以按用户统计并按配额停用。"
    };
  }

  return {
    mode: "shared_port",
    perUserReliable: false,
    message: "当前还没有配置多节点，未授权节点的用户会回退到共享端口模式，不能可靠区分每个用户的代理流量。"
  };
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
      if (Object.keys(ping.stat.ports).length > 0) await store.recordSample(ping.stat);
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
      await store.recordEvent("error", "管理接口连接失败", lastError);
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

  async function routeSubscription(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const match = /^\/sub\/([^/]+)\/(clash\.yaml|ss\.txt)$/.exec(url.pathname);
    if (!match) return false;

    if (req.method !== "GET") {
      methodNotAllowed(res);
      return true;
    }

    const token = decodeURIComponent(match[1]);
    const format = match[2] === "clash.yaml" ? "clash" : "ss";
    const found = await store.findSubscriptionByTokenHash(hashSubscriptionToken(token));

    if (!found) {
      text(res, 404, "Subscription not found");
      return true;
    }

    await store.recordSubscriptionAccess(found.user.id, found.tokenRecord.id, {
      format,
      ip: requestIp(req),
      userAgent: String(req.headers["user-agent"] || "")
    });

    if (found.tokenRecord.revoked || found.user.status !== "active") {
      text(res, 403, "Subscription is disabled");
      return true;
    }

    const assignedNodes = await store.getUserNodeAssignments(found.user.id);
    const activeNodes = await store.getSubscriptionNodesForUser(found.user.id);
    const hasNodeAssignments = assignedNodes.some((assignment) => assignment.enabled);

    if (hasNodeAssignments && activeNodes.length === 0) {
      text(res, 503, "No active nodes are available for this subscription");
      return true;
    }

    if (activeNodes.length === 0) {
      const notReady = subscriptionReady(config);
      if (notReady) {
        text(res, 503, notReady);
        return true;
      }
    }

    if (format === "clash") {
      content(res, 200, buildUserClashYaml(config, found.user, activeNodes), "text/yaml; charset=utf-8");
      return true;
    }

    content(res, 200, buildUserSsSubscription(config, found.user, activeNodes), "text/plain; charset=utf-8");
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
          await store.recordEvent("warn", "管理员登录失败", { username });
          return json(res, 401, { error: "invalid_credentials" });
        }

        const token = sessions.create(config.adminUsername);
        setSessionCookie(res, token, config.cookieSecure);
        await store.recordEvent("info", "管理员登录成功", { username: config.adminUsername });
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

    if (url.pathname === "/api/public-client-config") {
      if (req.method !== "GET") return methodNotAllowed(res);
      return json(res, 200, buildClientConfig(config));
    }

    if (url.pathname === "/api/node-agent/sync") {
      if (req.method !== "POST") return methodNotAllowed(res);

      try {
        const body = await readJsonBody(req);
        const nodeId = String(body.nodeId || "").trim();
        const token = bearerToken(req) || String(body.token || "").trim();
        if (!nodeId || !token) return json(res, 401, { error: "unauthorized" });

        const result = await store.syncNodeAgent(nodeId, token, {
          lastError: body.lastError,
          load: body.load,
          traffic: body.traffic
        });
        if (!result) return json(res, 401, { error: "unauthorized" });
        return json(res, 200, result);
      } catch (error) {
        return json(res, 400, { error: "bad_request", message: error instanceof Error ? error.message : String(error) });
      }
    }

    if (!requireSession(req, res)) return;

    if (url.pathname === "/api/nodes") {
      if (req.method === "GET") {
        return json(res, 200, { nodes: await store.listNodes() });
      }

      if (req.method === "POST") {
        try {
          const body = await readJsonBody(req);
          const created = await store.createNode(body);
          await store.recordEvent("info", "节点已创建", { nodeId: created.node.id, name: created.node.name });
          return json(res, 201, created);
        } catch (error) {
          return json(res, 400, { error: "bad_request", message: error instanceof Error ? error.message : String(error) });
        }
      }

      return methodNotAllowed(res);
    }

    const resetNodeTokenMatch = /^\/api\/nodes\/([^/]+)\/token\/reset$/.exec(url.pathname);
    if (resetNodeTokenMatch) {
      if (req.method !== "POST") return methodNotAllowed(res);
      const nodeId = decodeURIComponent(resetNodeTokenMatch[1]);
      const created = await store.resetNodeToken(nodeId);
      if (!created) return json(res, 404, { error: "not_found" });
      await store.recordEvent("info", "节点令牌已重置", { nodeId: created.node.id, name: created.node.name });
      return json(res, 200, created);
    }

    const nodeMatch = /^\/api\/nodes\/([^/]+)$/.exec(url.pathname);
    if (nodeMatch) {
      const nodeId = decodeURIComponent(nodeMatch[1]);

      if (req.method === "GET") {
        const detail = await store.getNodeDetail(nodeId);
        if (!detail) return json(res, 404, { error: "not_found" });
        return json(res, 200, detail);
      }

      if (req.method === "PATCH") {
        try {
          const body = await readJsonBody(req);
          const node = await store.updateNode(nodeId, body);
          if (!node) return json(res, 404, { error: "not_found" });
          await store.recordEvent("info", "节点已更新", { nodeId: node.id, name: node.name, status: node.status });
          return json(res, 200, { node });
        } catch (error) {
          return json(res, 400, { error: "bad_request", message: error instanceof Error ? error.message : String(error) });
        }
      }

      return methodNotAllowed(res);
    }

    if (url.pathname === "/api/users") {
      if (req.method === "GET") {
        const users = await store.listUsers();
        const nodes = await store.listNodes();
        return json(res, 200, {
          nodes,
          storage: {
            backend: store.backend,
            dataDir: store.dataDir
          },
          trafficMode: userTrafficMode(nodes.length > 0),
          users
        });
      }

      if (req.method === "POST") {
        try {
          const body = await readJsonBody(req);
          const created = await store.createUser(body);
          await store.recordEvent("info", "用户已创建", { userId: created.user.id, name: created.user.name });
          const nodes = await store.listNodes();
          return json(res, 201, {
            subscription: subscriptionPayload(req, config, created),
            trafficMode: userTrafficMode(nodes.length > 0),
            user: created.user
          });
        } catch (error) {
          return json(res, 400, { error: "bad_request", message: error instanceof Error ? error.message : String(error) });
        }
      }

      return methodNotAllowed(res);
    }

    const resetTokenMatch = /^\/api\/users\/([^/]+)\/token\/reset$/.exec(url.pathname);
    if (resetTokenMatch) {
      if (req.method !== "POST") return methodNotAllowed(res);
      const userId = decodeURIComponent(resetTokenMatch[1]);
      const created = await store.resetSubscriptionToken(userId);
      if (!created) return json(res, 404, { error: "not_found" });

      await store.recordEvent("info", "用户订阅地址已重置", { userId: created.user.id, name: created.user.name });
      return json(res, 200, {
        subscription: subscriptionPayload(req, config, created),
        trafficMode: userTrafficMode(),
        user: created.user
      });
    }

    const userNodesMatch = /^\/api\/users\/([^/]+)\/nodes$/.exec(url.pathname);
    if (userNodesMatch) {
      if (req.method !== "PUT") return methodNotAllowed(res);

      try {
        const userId = decodeURIComponent(userNodesMatch[1]);
        const body = await readJsonBody(req);
        const assignments = await store.updateUserNodeAssignments(userId, body.nodeIds);
        if (!assignments) return json(res, 404, { error: "not_found" });
        await store.recordEvent("info", "用户节点授权已更新", { userId, nodeIds: body.nodeIds });
        const nodes = await store.listNodes();
        return json(res, 200, {
          assignments,
          nodes,
          trafficMode: userTrafficMode(nodes.length > 0)
        });
      } catch (error) {
        return json(res, 400, { error: "bad_request", message: error instanceof Error ? error.message : String(error) });
      }
    }

    const userMatch = /^\/api\/users\/([^/]+)$/.exec(url.pathname);
    if (userMatch) {
      const userId = decodeURIComponent(userMatch[1]);

      if (req.method === "GET") {
        const range = url.searchParams.get("range") || "24h";
        const detail = await store.getUserDetail(userId);
        if (!detail) return json(res, 404, { error: "not_found" });
        const nodes = await store.listNodes();
        return json(res, 200, {
          ...detail,
          nodeAssignments: await store.getUserNodeAssignments(userId),
          nodes,
          sharedTraffic: await store.getTraffic(range),
          trafficMode: userTrafficMode(nodes.length > 0),
          userTraffic: await store.getTrafficByUser(userId, range)
        });
      }

      if (req.method === "PATCH") {
        try {
          const body = await readJsonBody(req);
          let user = await store.updateUser(userId, body);
          if (body.status !== undefined) {
            user = await store.setUserStatus(userId, String(body.status) as UserStatus);
          }
          if (!user) return json(res, 404, { error: "not_found" });
          await store.recordEvent("info", "用户已更新", { userId: user.id, name: user.name, status: user.status });
          const nodes = await store.listNodes();
          return json(res, 200, { trafficMode: userTrafficMode(nodes.length > 0), user });
        } catch (error) {
          return json(res, 400, { error: "bad_request", message: error instanceof Error ? error.message : String(error) });
        }
      }

      return methodNotAllowed(res);
    }

    if (url.pathname === "/api/merge-client-config") {
      if (req.method !== "POST") return methodNotAllowed(res);

      try {
        const body = await readJsonBody(req);
        const merged = mergeClashConfig(String(body.baseConfig || ""), config, {
          fixedIpDomains: body.fixedIpDomains
        });
        return json(res, 200, merged);
      } catch (error) {
        return json(res, 400, { error: "bad_request", message: error instanceof Error ? error.message : String(error) });
      }
    }

    if (url.pathname === "/api/status") {
      if (req.method !== "GET") return methodNotAllowed(res);
      const snapshot = await readManagerSnapshot();
      const latestSamples = await store.getLatestSamples();
      const nodes = await store.listNodes();
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
        nodes,
        shadowsocks: {
          method: config.ssMethod,
          passwordConfigured: config.ssPasswordConfigured,
          publicHost: config.publicSsHost,
          publicPort: config.publicSsPort,
          ssPort: config.ssPort,
          timeout: config.ssTimeout
        },
        storage: {
          backend: store.backend,
          dataDir: store.dataDir
        },
        servers: snapshot.servers,
        traffic: {
          currentTotalBytes: snapshot.totalBytes,
          latestSamples,
          recordedTotalBytes: await store.getRecordedTotalBytes()
        }
      });
    }

    if (url.pathname === "/api/traffic") {
      if (req.method !== "GET") return methodNotAllowed(res);
      return json(res, 200, await store.getTraffic(url.searchParams.get("range") || "24h"));
    }

    if (url.pathname === "/api/client-config") {
      if (req.method !== "GET") return methodNotAllowed(res);
      return json(res, 200, buildClientConfig(config));
    }

    if (url.pathname === "/api/events") {
      if (req.method !== "GET") return methodNotAllowed(res);
      return json(res, 200, { events: await store.getEvents(100) });
    }

    return json(res, 404, { error: "not_found" });
  }

  return http.createServer((req, res) => {
    const host = req.headers.host || "localhost";
    const url = new URL(req.url || "/", `http://${host}`);

    if (url.pathname === "/healthz") {
      return json(res, 200, { ok: true });
    }

    if (url.pathname.startsWith("/sub/")) {
      routeSubscription(req, res, url)
        .then((handled) => {
          if (!handled) text(res, 404, "Subscription not found");
        })
        .catch((error) => {
          void store.recordEvent("error", "订阅接口异常", error instanceof Error ? error.stack : String(error));
          text(res, 500, "Internal error");
        });
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      routeApi(req, res, url).catch((error) => {
        void store.recordEvent("error", "后台接口异常", error instanceof Error ? error.stack : String(error));
        json(res, 500, { error: "internal_error" });
      });
      return;
    }

    serveStatic(res, url.pathname);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = readConfig();
  const store = await openConfiguredStore(config);
  const server = createAdminServer(config, store);

  server.listen(config.port, () => {
    void store.recordEvent("info", "管理服务已启动", { port: config.port, dataDir: store.dataDir, backend: store.backend });
    console.log(`管理服务正在监听 ${config.port}`);
  });

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      server.close(async () => {
        await store.recordEvent("info", "管理服务已停止", { signal });
        await store.close();
        process.exit(0);
      });
    });
  }
}
