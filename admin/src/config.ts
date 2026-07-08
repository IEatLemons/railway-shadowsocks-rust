export type AppConfig = {
  adminPassword: string;
  adminUsername: string;
  cookieSecure: boolean;
  dataDir: string;
  databaseUrl: string;
  managerHost: string;
  managerPort: number;
  managerTimeoutMs: number;
  nodeEnv: string;
  port: number;
  publicSsHost: string;
  publicSsPort: string;
  sampleIntervalMs: number;
  ssMethod: string;
  ssPassword: string;
  ssPasswordConfigured: boolean | null;
  ssPort: number;
  ssTimeout: number;
};

function readNumber(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (!raw) return fallback;

  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return value;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = env.NODE_ENV || "development";
  const adminPassword = env.ADMIN_PASSWORD || "";

  if (nodeEnv === "production" && !adminPassword) {
    throw new Error("ADMIN_PASSWORD is required in production");
  }

  const ssPasswordFlag = env.SS_PASSWORD_CONFIGURED;
  const ssPasswordConfigured =
    typeof ssPasswordFlag === "string"
      ? ["1", "true", "yes"].includes(ssPasswordFlag.toLowerCase())
      : env.SS_PASSWORD
        ? true
        : null;

  return {
    adminPassword: adminPassword || "admin",
    adminUsername: env.ADMIN_USERNAME || "admin",
    cookieSecure: nodeEnv === "production",
    dataDir: env.DATA_DIR || "/data",
    databaseUrl: env.DATABASE_URL || "",
    managerHost: env.SS_MANAGER_HOST || "127.0.0.1",
    managerPort: readNumber(env, "SS_MANAGER_PORT", 6100),
    managerTimeoutMs: readNumber(env, "SS_MANAGER_TIMEOUT_MS", 2500),
    nodeEnv,
    port: readNumber(env, "PORT", 3000),
    publicSsHost: env.PUBLIC_SS_HOST || "",
    publicSsPort: env.PUBLIC_SS_PORT || "",
    sampleIntervalMs: readNumber(env, "SAMPLE_INTERVAL_MS", 15000),
    ssMethod: env.SS_METHOD || "aes-256-gcm",
    ssPassword: env.SS_PASSWORD || "",
    ssPasswordConfigured,
    ssPort: readNumber(env, "SS_PORT", 8388),
    ssTimeout: readNumber(env, "SS_TIMEOUT", 300)
  };
}

export function getConfigWarnings(config: AppConfig): string[] {
  const warnings: string[] = [];

  if (!config.publicSsHost) {
    warnings.push("尚未配置 PUBLIC_SS_HOST，后台暂时无法展示客户端服务器地址。");
  }

  if (!config.publicSsPort) {
    warnings.push("尚未配置 PUBLIC_SS_PORT，后台暂时无法展示客户端端口。");
  }

  if (!config.managerHost) {
    warnings.push("尚未配置 SS_MANAGER_HOST。");
  }

  if (config.nodeEnv !== "production" && config.adminPassword === "admin") {
    warnings.push("ADMIN_PASSWORD 仍在使用本地开发默认值。");
  }

  if (config.ssPasswordConfigured === null) {
    warnings.push("后台无法确认 SS_PASSWORD 是否存在；请在 Railway 服务变量中检查。");
  }

  if (!config.ssPassword) {
    warnings.push("尚未向管理后台传入 SS_PASSWORD，多用户订阅地址无法生成可用配置。");
  }

  return warnings;
}
