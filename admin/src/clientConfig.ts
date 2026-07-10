import type { AppConfig } from "./config.ts";

export type ClientConfigPayload = {
  clashYaml: string;
  method: string;
  publicHost: string;
  publicPort: string;
  ssPort: number;
};

export type MergeClientConfigResult = {
  clashYaml: string;
  fixedIpDomains: string[];
  warnings: string[];
};

export type SubscriptionUser = {
  id: string;
  name: string;
};

export type UserSubscriptionNode = {
  method: string;
  nodeId: string;
  nodeName: string;
  password: string;
  publicHost: string;
  publicPort: number;
};

type TopLevelSection = {
  key: string | null;
  lines: string[];
};

function yamlScalar(value: string): string {
  if (/^[A-Za-z0-9_.-]+$/.test(value)) return value;
  return JSON.stringify(value);
}

function base64Url(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function subscriptionNodeName(user: SubscriptionUser): string {
  const normalized = user.name.trim().replace(/\s+/g, "-") || user.id.slice(0, 8);
  return `railway-user-${normalized}`;
}

function subscriptionMultiNodeName(user: SubscriptionUser, node: UserSubscriptionNode): string {
  const userPart = user.name.trim().replace(/\s+/g, "-") || user.id.slice(0, 8);
  const nodePart = node.nodeName.trim().replace(/\s+/g, "-") || node.nodeId.slice(0, 8);
  return `railway-${nodePart}-${userPart}-${node.publicPort}`;
}

function formatServerHost(host: string): string {
  if (host.includes(":") && !host.startsWith("[") && !host.endsWith("]")) return `[${host}]`;
  return host;
}

function buildRailwayProxyBlock(
  config: AppConfig,
  options: { name?: string; password?: string } = {}
): string[] {
  const server = config.publicSsHost || "YOUR_RAILWAY_TCP_PROXY_HOST";
  const port = config.publicSsPort || "YOUR_RAILWAY_TCP_PROXY_PORT";
  const name = options.name || "railway-fixed-ip";
  const password = options.password || "YOUR_SS_PASSWORD";

  return [
    `  - name: ${yamlScalar(name)}`,
    "    type: ss",
    `    server: ${yamlScalar(server)}`,
    `    port: ${/^\d+$/.test(port) ? port : yamlScalar(port)}`,
    `    cipher: ${yamlScalar(config.ssMethod)}`,
    `    password: ${yamlScalar(password)}`,
    "    udp: false"
  ];
}

function buildSubscriptionNodeProxyBlock(user: SubscriptionUser, node: UserSubscriptionNode): string[] {
  const nodeName = subscriptionMultiNodeName(user, node);

  return [
    `  - name: ${yamlScalar(nodeName)}`,
    "    type: ss",
    `    server: ${yamlScalar(node.publicHost)}`,
    `    port: ${node.publicPort}`,
    `    cipher: ${yamlScalar(node.method)}`,
    `    password: ${yamlScalar(node.password)}`,
    "    udp: false"
  ];
}

function buildFixedIpGroupBlock(): string[] {
  return [
    "  - name: FixedIP",
    "    type: select",
    "    proxies:",
    "      - railway-fixed-ip",
    "      - DIRECT"
  ];
}

function buildFixedIpRules(domains: string[]): string[] {
  return domains.map((domain) => `  - DOMAIN-SUFFIX,${domain},FixedIP`);
}

export function buildStandaloneClashYaml(config: AppConfig, fixedIpDomains: string[] = ["example.com"]): string {
  const rules = buildFixedIpRules(fixedIpDomains);

  return [
    "proxies:",
    ...buildRailwayProxyBlock(config),
    "",
    "proxy-groups:",
    ...buildFixedIpGroupBlock(),
    "",
    "rules:",
    ...rules,
    "  - MATCH,DIRECT"
  ].join("\n");
}

export function buildClientConfig(config: AppConfig): ClientConfigPayload {
  return {
    clashYaml: buildStandaloneClashYaml(config),
    method: config.ssMethod,
    publicHost: config.publicSsHost,
    publicPort: config.publicSsPort,
    ssPort: config.ssPort
  };
}

export function buildUserClashYaml(config: AppConfig, user: SubscriptionUser, nodes: UserSubscriptionNode[] = []): string {
  if (nodes.length > 0) {
    const nodeNames = nodes.map((node) => subscriptionMultiNodeName(user, node));
    return [
      "proxies:",
      ...nodes.flatMap((node) => buildSubscriptionNodeProxyBlock(user, node)),
      "",
      "proxy-groups:",
      "  - name: Proxy",
      "    type: select",
      "    proxies:",
      ...nodeNames.map((name) => `      - ${yamlScalar(name)}`),
      "      - DIRECT",
      "",
      "rules:",
      "  - MATCH,Proxy",
      ""
    ].join("\n");
  }

  const nodeName = subscriptionNodeName(user);

  return [
    "proxies:",
    ...buildRailwayProxyBlock(config, {
      name: nodeName,
      password: config.ssPassword
    }),
    "",
    "proxy-groups:",
    "  - name: Proxy",
    "    type: select",
    "    proxies:",
    `      - ${yamlScalar(nodeName)}`,
    "      - DIRECT",
    "",
    "rules:",
    "  - MATCH,Proxy",
    ""
  ].join("\n");
}

export function buildUserSsUri(config: AppConfig, user: SubscriptionUser, node?: UserSubscriptionNode): string {
  const method = node?.method || config.ssMethod;
  const password = node?.password || config.ssPassword;
  const host = formatServerHost(node?.publicHost || config.publicSsHost || "YOUR_RAILWAY_TCP_PROXY_HOST");
  const port = node?.publicPort || config.publicSsPort || "YOUR_RAILWAY_TCP_PROXY_PORT";
  const fragment = encodeURIComponent(node ? subscriptionMultiNodeName(user, node) : subscriptionNodeName(user));
  const userInfo = base64Url(`${method}:${password}`);
  return `ss://${userInfo}@${host}:${port}#${fragment}`;
}

export function buildUserSsSubscription(config: AppConfig, user: SubscriptionUser, nodes: UserSubscriptionNode[] = []): string {
  const uris = nodes.length > 0
    ? nodes.map((node) => buildUserSsUri(config, user, node))
    : [buildUserSsUri(config, user)];
  return Buffer.from(`${uris.join("\n")}\n`, "utf8").toString("base64");
}

function topLevelKey(line: string): string | null {
  const match = /^([A-Za-z0-9_.-]+):(?:\s.*)?$/.exec(line);
  return match ? match[1] : null;
}

function splitTopLevelSections(source: string): TopLevelSection[] {
  const lines = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
  const sections: TopLevelSection[] = [{ key: null, lines: [] }];

  for (const line of lines) {
    const key = topLevelKey(line);
    if (key) {
      sections.push({ key, lines: [line] });
      continue;
    }

    sections[sections.length - 1].lines.push(line);
  }

  return sections.filter((section, index) => index === 0 || section.lines.length > 0);
}

function ensureSection(sections: TopLevelSection[], key: string): TopLevelSection {
  const existing = sections.find((section) => section.key === key);
  if (existing) return existing;

  const previous = sections[sections.length - 1];
  if (previous && previous.lines.length > 0 && previous.lines[previous.lines.length - 1].trim() !== "") {
    previous.lines.push("");
  }

  const created = { key, lines: [`${key}:`] };
  sections.push(created);
  return created;
}

function stripTrailingBlankLines(lines: string[]): string[] {
  const next = [...lines];
  while (next.length > 1 && next[next.length - 1].trim() === "") {
    next.pop();
  }
  return next;
}

function lineIndent(line: string): number {
  return /^(\s*)/.exec(line)?.[1].length || 0;
}

function stripInlineComment(value: string): string {
  let quote: string | null = null;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const previous = index > 0 ? value[index - 1] : "";

    if (quote) {
      if (char === quote && (quote === "'" || previous !== "\\")) quote = null;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === "#" && (index === 0 || /\s/.test(previous))) {
      return value.slice(0, index).trimEnd();
    }
  }

  return value.trimEnd();
}

function parseYamlScalar(value: string): string {
  const clean = stripInlineComment(value).trim().replace(/[,}]$/, "").trim();
  if ((clean.startsWith('"') && clean.endsWith('"')) || (clean.startsWith("'") && clean.endsWith("'"))) {
    return clean.slice(1, -1);
  }
  return clean;
}

function splitInlineFields(value: string): string[] {
  const fields: string[] = [];
  let quote: string | null = null;
  let start = 0;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const previous = index > 0 ? value[index - 1] : "";

    if (quote) {
      if (char === quote && (quote === "'" || previous !== "\\")) quote = null;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === ",") {
      fields.push(value.slice(start, index));
      start = index + 1;
    }
  }

  fields.push(value.slice(start));
  return fields;
}

function parseInlineMapField(value: string, fieldName: string): string | null {
  const body = value.trim().replace(/^\{/, "").replace(/\}$/, "");
  for (const field of splitInlineFields(body)) {
    const colonIndex = field.indexOf(":");
    if (colonIndex === -1) continue;

    const key = field.slice(0, colonIndex).trim();
    if (key !== fieldName) continue;
    return parseYamlScalar(field.slice(colonIndex + 1));
  }

  return null;
}

function readListItemName(lines: string[]): string | null {
  const first = lines[0]?.replace(/^\s*-\s*/, "") || "";

  if (first.startsWith("{")) {
    return parseInlineMapField(first, "name");
  }

  if (first.startsWith("name:")) {
    return parseYamlScalar(first.slice("name:".length));
  }

  for (const line of lines.slice(1)) {
    const match = /^\s+name:\s*(.+)$/.exec(line);
    if (match) return parseYamlScalar(match[1]);
  }

  return null;
}

function removeNamedListItem(lines: string[], name: string): string[] {
  const itemIndents = lines
    .filter((line) => /^\s*-\s+/.test(line))
    .map(lineIndent);

  if (itemIndents.length === 0) return lines;

  const itemIndent = Math.min(...itemIndents);
  const isItemStart = (line: string) => lineIndent(line) === itemIndent && /^\s*-\s+/.test(line);
  const next: string[] = [];

  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (!isItemStart(line)) {
      next.push(line);
      index += 1;
      continue;
    }

    const itemLines: string[] = [];
    do {
      itemLines.push(lines[index]);
      index += 1;
    } while (index < lines.length && !isItemStart(lines[index]));

    if (readListItemName(itemLines) !== name) {
      next.push(...itemLines);
    }
  }

  return next;
}

function upsertNamedListItem(sections: TopLevelSection[], key: string, name: string, block: string[]): void {
  const section = ensureSection(sections, key);
  const headerIndex = section.lines.findIndex((line) => topLevelKey(line) === key);
  const header = headerIndex === -1 ? [`${key}:`] : section.lines.slice(0, headerIndex + 1);
  const body = headerIndex === -1 ? section.lines : section.lines.slice(headerIndex + 1);

  header[header.length - 1] = `${key}:`;
  section.lines = stripTrailingBlankLines([...header, ...removeNamedListItem(body, name)]);
  section.lines.push(...block);
}

function normalizeFixedIpDomain(value: string): string {
  let raw = value.trim();
  if (!raw) return "";

  const ruleParts = raw.split(",");
  if (/^(DOMAIN|DOMAIN-SUFFIX|DOMAIN-KEYWORD)$/i.test(ruleParts[0]?.trim() || "")) {
    raw = ruleParts[1]?.trim() || "";
  }

  raw = raw.replace(/^https?:\/\//i, "").split("/")[0].replace(/^\.+/, "").trim().toLowerCase();
  if (raw.length > 253 || !/^[a-z0-9*.-]+$/.test(raw)) return "";
  return raw;
}

export function normalizeFixedIpDomains(value: unknown): string[] {
  const rawItems = Array.isArray(value)
    ? value.map((item) => String(item))
    : String(value || "")
      .split(/\r?\n|;/)
      .flatMap((line) => {
        const trimmed = line.trim();
        if (/^(DOMAIN|DOMAIN-SUFFIX|DOMAIN-KEYWORD),/i.test(trimmed)) return [trimmed];
        return trimmed.split(",");
      });

  const domains: string[] = [];
  const seen = new Set<string>();

  for (const item of rawItems) {
    const domain = normalizeFixedIpDomain(item);
    if (!domain || seen.has(domain)) continue;
    seen.add(domain);
    domains.push(domain);
  }

  return domains;
}

function removeGeneratedFixedIpRules(lines: string[], domains: Set<string>): string[] {
  return lines.filter((line) => {
    const match = /^\s*-\s*DOMAIN-SUFFIX,([^,]+),FixedIP(?:\s*(?:#.*)?)?$/.exec(line);
    if (!match) return true;
    return !domains.has(normalizeFixedIpDomain(match[1]));
  });
}

function insertFixedIpRules(sections: TopLevelSection[], domains: string[]): void {
  if (domains.length === 0) return;

  const section = ensureSection(sections, "rules");
  const headerIndex = section.lines.findIndex((line) => topLevelKey(line) === "rules");
  const header = headerIndex === -1 ? ["rules:"] : section.lines.slice(0, headerIndex + 1);
  const body = headerIndex === -1 ? section.lines : section.lines.slice(headerIndex + 1);
  const domainSet = new Set(domains);
  const rules = buildFixedIpRules(domains);
  const cleaned = removeGeneratedFixedIpRules(body, domainSet);
  const matchIndex = cleaned.findIndex((line) => /^\s*-\s*(MATCH|FINAL),/i.test(line));

  header[header.length - 1] = "rules:";
  if (matchIndex === -1) {
    section.lines = stripTrailingBlankLines([...header, ...cleaned]);
    section.lines.push(...rules);
    return;
  }

  section.lines = [
    ...header,
    ...cleaned.slice(0, matchIndex),
    ...rules,
    ...cleaned.slice(matchIndex)
  ];
}

function renderSections(sections: TopLevelSection[]): string {
  const lines = sections.flatMap((section) => section.lines);
  return `${stripTrailingBlankLines(lines).join("\n")}\n`;
}

export function mergeClashConfig(
  baseConfig: string,
  config: AppConfig,
  options: { fixedIpDomains?: unknown } = {}
): MergeClientConfigResult {
  const fixedIpDomains = normalizeFixedIpDomains(options.fixedIpDomains);
  const warnings: string[] = [];
  const source = baseConfig.trim();

  if (!source) {
    const standaloneDomains = fixedIpDomains.length > 0 ? fixedIpDomains : ["example.com"];
    warnings.push("没有提供原始 Clash 配置，已生成仅包含 Railway 节点的配置。");
    return {
      clashYaml: `${buildStandaloneClashYaml(config, standaloneDomains)}\n`,
      fixedIpDomains: standaloneDomains,
      warnings
    };
  }

  const sections = splitTopLevelSections(source);
  const keys = new Set(sections.map((section) => section.key).filter(Boolean));

  if (!keys.has("proxies")) warnings.push("原配置没有 proxies 段，已自动补上。");
  if (!keys.has("proxy-groups")) warnings.push("原配置没有 proxy-groups 段，已自动补上。");
  if (fixedIpDomains.length > 0 && !keys.has("rules")) warnings.push("原配置没有 rules 段，已自动补上固定 IP 域名规则。");
  if (fixedIpDomains.length === 0) warnings.push("没有填写固定 IP 域名，原 rules 段保持不变。");

  upsertNamedListItem(sections, "proxies", "railway-fixed-ip", buildRailwayProxyBlock(config));
  upsertNamedListItem(sections, "proxy-groups", "FixedIP", buildFixedIpGroupBlock());
  insertFixedIpRules(sections, fixedIpDomains);

  warnings.push("Railway 节点名为 railway-fixed-ip，代理组名为 FixedIP。");
  warnings.push("输出中的 YOUR_SS_PASSWORD 需要替换为 Railway 服务变量 SS_PASSWORD。");

  return {
    clashYaml: renderSections(sections),
    fixedIpDomains,
    warnings
  };
}
