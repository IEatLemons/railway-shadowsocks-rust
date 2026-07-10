const app = document.querySelector("#app");

const RANGE_LABELS = {
  "1h": "1 小时",
  "24h": "24 小时",
  "7d": "7 天"
};

const EVENT_LEVEL_LABELS = {
  error: "错误",
  info: "信息",
  warn: "警告"
};

const EVENT_MESSAGE_LABELS = {
  "Admin login failed": "管理员登录失败",
  "Admin login succeeded": "管理员登录成功",
  "Admin service started": "管理服务已启动",
  "Admin service stopped": "管理服务已停止",
  "用户已创建": "用户已创建",
  "用户已更新": "用户已更新",
  "用户订阅地址已重置": "用户订阅地址已重置",
  "Manager connection failed": "管理接口连接失败",
  "Unhandled API error": "后台接口异常"
};

const USER_STATUS_LABELS = {
  active: "启用",
  disabled: "停用",
  over_quota: "超额停用"
};

const QUOTA_PERIOD_LABELS = {
  daily: "每天",
  monthly: "每月",
  none: "不限制",
  weekly: "每周"
};

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"];

const TOOLS = [
  {
    detail: "Clash YAML",
    path: "/tools/config-merge",
    title: "配置合并"
  }
];

let state = {
  authed: false,
  busy: false,
  merge: {
    busy: false,
    domains: "",
    error: "",
    input: "",
    output: "",
    password: "",
    warnings: []
  },
  range: "24h",
  status: null,
  traffic: null,
  userDetail: null,
  userError: "",
  userSubscription: null,
  users: null,
  events: []
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  let index = 0;
  let next = bytes;
  while (next >= 1024 && index < BYTE_UNITS.length - 1) {
    next /= 1024;
    index += 1;
  }
  return `${next.toFixed(index === 0 ? 0 : 1)} ${BYTE_UNITS[index]}`;
}

function formatTime(value) {
  if (!value) return "从未";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "medium"
  }).format(date);
}

function formatDuration(seconds) {
  const value = Number(seconds || 0);
  if (value < 60) return `${value} 秒`;
  if (value < 3600) return `${Math.floor(value / 60)} 分 ${value % 60} 秒`;
  return `${Math.floor(value / 3600)} 小时 ${Math.floor((value % 3600) / 60)} 分`;
}

function formatEventLevel(level) {
  return EVENT_LEVEL_LABELS[level] || level || "未知";
}

function formatEventMessage(message) {
  return EVENT_MESSAGE_LABELS[message] || message || "无消息";
}

function formatUserStatus(status) {
  return USER_STATUS_LABELS[status] || status || "未知";
}

function formatQuota(user) {
  if (!user?.quotaBytes) return "不限制";
  return `${formatBytes(user.quotaBytes)} / ${QUOTA_PERIOD_LABELS[user.quotaPeriod] || user.quotaPeriod || "周期"}`;
}

function quotaGbToBytes(value) {
  const gb = Number(value || 0);
  if (!Number.isFinite(gb) || gb <= 0) return null;
  return Math.round(gb * 1024 * 1024 * 1024);
}

function userStatusClass(status) {
  if (status === "active") return "online";
  if (status === "over_quota") return "warning";
  return "offline";
}

function getRoute() {
  const pathname = window.location.pathname.replace(/\/+$/, "") || "/";

  if (pathname === "/" || pathname === "/dashboard") {
    return { name: "dashboard", nav: "dashboard" };
  }

  if (pathname === "/users") {
    return { name: "users", nav: "users" };
  }

  const userMatch = /^\/users\/([^/]+)$/.exec(pathname);
  if (userMatch) {
    return { name: "user-detail", nav: "users", userId: decodeURIComponent(userMatch[1]) };
  }

  if (pathname === "/tools") {
    return { name: "tools", nav: "tools" };
  }

  if (pathname === "/tools/config-merge") {
    return { name: "config-merge", nav: "tools" };
  }

  return { name: "not-found", nav: "" };
}

function getEndpointLabel() {
  const status = state.status;
  return status?.shadowsocks?.publicHost && status?.shadowsocks?.publicPort
    ? `${status.shadowsocks.publicHost}:${status.shadowsocks.publicPort}`
    : "尚未配置客户端地址";
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  if (response.status === 401) {
    state.authed = false;
    renderLogin();
    throw new Error("未登录或登录已过期");
  }

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.message || payload.error || "请求失败");
  }
  return payload;
}

async function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

async function copyFromButton(button, text, copiedText = "已复制") {
  const originalText = button.textContent;
  await copyToClipboard(text);
  button.textContent = copiedText;
  button.disabled = true;
  window.setTimeout(() => {
    button.textContent = originalText;
    button.disabled = false;
  }, 1200);
}

function withLocalPassword(yaml, password) {
  if (!password) return yaml;
  return yaml.replaceAll("YOUR_SS_PASSWORD", JSON.stringify(password));
}

function downloadTextFile(filename, text) {
  const blob = new Blob([text], { type: "text/yaml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function niceStep(value) {
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  if (normalized <= 1) return magnitude;
  if (normalized <= 2) return 2 * magnitude;
  if (normalized <= 5) return 5 * magnitude;
  return 10 * magnitude;
}

function buildTrafficTicks(maxValue) {
  const max = Math.max(1, Number(maxValue || 0));
  const step = Math.max(1, niceStep(max / 4));
  const axisMax = Math.ceil(max / step) * step;
  const ticks = [];

  for (let value = axisMax; value >= 0; value -= step) {
    ticks.push(Math.max(0, value));
  }

  if (ticks[ticks.length - 1] !== 0) ticks.push(0);
  return ticks;
}

function chartUnitIndex(value) {
  let index = 0;
  let next = Number(value || 0);
  while (next >= 1024 && index < BYTE_UNITS.length - 1) {
    next /= 1024;
    index += 1;
  }
  return index;
}

function formatTrafficTick(value, unitIndex) {
  const scaled = Number(value || 0) / 1024 ** unitIndex;
  if (scaled === 0) return `0 ${BYTE_UNITS[unitIndex]}`;
  const digits = unitIndex === 0 || scaled >= 10 ? 0 : 1;
  return `${scaled.toFixed(digits)} ${BYTE_UNITS[unitIndex]}`;
}

function drawChart(summary) {
  const points = summary?.points || [];
  if (points.length === 0) {
    return `<div class="chart-empty">还没有流量样本</div>`;
  }

  const width = 720;
  const height = 260;
  const plot = {
    bottom: 36,
    left: 82,
    right: 28,
    top: 24
  };
  const maxBytes = Math.max(...points.map((point) => point.bytes), 1);
  const ticks = buildTrafficTicks(maxBytes);
  const axisMax = ticks[0] || maxBytes;
  const unitIndex = chartUnitIndex(axisMax);
  const minTime = summary.since;
  const maxTime = summary.until;
  const xSpan = Math.max(1, maxTime - minTime);
  const plotWidth = width - plot.left - plot.right;
  const plotHeight = height - plot.top - plot.bottom;

  const coordinates = points.map((point) => {
    const x = plot.left + ((point.timestamp - minTime) / xSpan) * plotWidth;
    const y = plot.top + (1 - point.bytes / axisMax) * plotHeight;
    return {
      point,
      value: `${x.toFixed(1)},${y.toFixed(1)}`,
      x: x.toFixed(1),
      y: y.toFixed(1)
    };
  });

  return `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="流量图表，峰值 ${escapeHtml(formatBytes(maxBytes))}">
      ${ticks
        .map((tick) => {
          const y = plot.top + (1 - tick / axisMax) * plotHeight;
          return `
            <g>
              <line class="chart-grid" x1="${plot.left}" y1="${y.toFixed(1)}" x2="${width - plot.right}" y2="${y.toFixed(1)}" />
              <text class="chart-axis-label" x="${plot.left - 10}" y="${(y + 4).toFixed(1)}" text-anchor="end">${escapeHtml(formatTrafficTick(tick, unitIndex))}</text>
            </g>
          `;
        })
        .join("")}
      <line class="chart-axis" x1="${plot.left}" y1="${height - plot.bottom}" x2="${width - plot.right}" y2="${height - plot.bottom}" />
      <line class="chart-axis" x1="${plot.left}" y1="${plot.top}" x2="${plot.left}" y2="${height - plot.bottom}" />
      <polyline points="${coordinates.map((coordinate) => coordinate.value).join(" ")}" fill="none" stroke="#1f6feb" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
      ${points
        .map((point, index) => {
          const { x, y } = coordinates[index];
          return `<circle cx="${x}" cy="${y}" r="4" fill="#168a53"><title>${formatBytes(point.bytes)}，${formatTime(point.timestamp)}</title></circle>`;
        })
        .join("")}
    </svg>
  `;
}

function metricCard(label, value, detail, statusClass = "") {
  return `
    <article class="card">
      <div class="label">${escapeHtml(label)}</div>
      <div class="metric ${statusClass}">${value}</div>
      <div class="subtle">${escapeHtml(detail)}</div>
    </article>
  `;
}

function renderShell(content, options = {}) {
  const nav = options.nav ?? "dashboard";

  app.innerHTML = `
    <div class="shell">
      <header class="topbar">
        <div class="brand">
          <h1>Shadowsocks 管理后台</h1>
          <p>${escapeHtml(getEndpointLabel())}</p>
        </div>
        <div class="topbar-controls">
          <nav class="top-nav" aria-label="主导航">
            <a class="nav-link ${nav === "dashboard" ? "active" : ""}" href="/" data-route-link>仪表盘</a>
            <a class="nav-link ${nav === "users" ? "active" : ""}" href="/users" data-route-link>用户</a>
            <a class="nav-link ${nav === "tools" ? "active" : ""}" href="/tools" data-route-link>工具</a>
            <a class="nav-link" href="/guide" target="_blank" rel="noopener">使用说明</a>
          </nav>
          <div class="actions">
            ${options.showRefresh ? `<button id="refresh">刷新</button>` : ""}
            <button id="logout">退出登录</button>
          </div>
        </div>
      </header>

      <main class="dashboard">
        ${content}
      </main>
    </div>
  `;

  bindShellEvents();
}

function renderMergePanel() {
  const merge = state.merge;
  const canUseOutput = Boolean(merge.output);

  return `
    <section class="panel merge-panel">
      <div class="panel-header">
        <h2>配置合并</h2>
        <div class="merge-actions">
          <button id="merge-generate" class="primary" ${merge.busy ? "disabled" : ""}>${merge.busy ? "生成中" : "生成最终配置"}</button>
          <button id="merge-copy" ${canUseOutput ? "" : "disabled"}>复制结果</button>
          <button id="merge-download" ${canUseOutput ? "" : "disabled"}>下载 YAML</button>
          <button id="merge-clear">清空</button>
        </div>
      </div>

      <div class="merge-grid">
        <div class="field">
          <label for="merge-file">配置文件</label>
          <input id="merge-file" type="file" accept=".yaml,.yml,.txt,.conf">
        </div>
        <div class="field">
          <label for="merge-domains">固定 IP 域名</label>
          <input id="merge-domains" value="${escapeHtml(merge.domains)}" placeholder="example.com, api.example.com">
        </div>
        <div class="field">
          <label for="merge-password">SS_PASSWORD（可选）</label>
          <input id="merge-password" type="password" value="${escapeHtml(merge.password)}" placeholder="只在浏览器替换占位符">
        </div>
      </div>

      ${merge.error ? `<div class="warning">${escapeHtml(merge.error)}</div>` : ""}
      ${merge.warnings.length > 0
        ? `<div class="merge-warnings">${merge.warnings.map((warning) => `<div class="subtle">${escapeHtml(warning)}</div>`).join("")}</div>`
        : ""}

      <div class="merge-editors">
        <div class="field">
          <label for="merge-input">当前 Clash 配置</label>
          <textarea id="merge-input" spellcheck="false" placeholder="粘贴当前正在使用的 Clash YAML 配置">${escapeHtml(merge.input)}</textarea>
        </div>
        <div class="field">
          <label for="merge-output">最终 Clash 配置</label>
          <textarea id="merge-output" spellcheck="false" readonly placeholder="生成后显示">${escapeHtml(merge.output)}</textarea>
        </div>
      </div>
    </section>
  `;
}

function renderSubscriptionNotice() {
  const subscription = state.userSubscription;
  if (!subscription) return "";

  return `
    <section class="panel subscription-result">
      <div class="panel-header">
        <h2>订阅地址</h2>
        <button id="subscription-dismiss">隐藏</button>
      </div>
      <div class="warning">订阅地址只会在创建或重置时显示一次，请妥善保存。</div>
      <div class="subscription-links">
        <div class="field">
          <label>Clash</label>
          <div class="copy-row">
            <code>${escapeHtml(subscription.clashUrl || "")}</code>
            <button id="copy-sub-clash">复制</button>
          </div>
        </div>
        <div class="field">
          <label>Shadowsocks</label>
          <div class="copy-row">
            <code>${escapeHtml(subscription.ssUrl || "")}</code>
            <button id="copy-sub-ss">复制</button>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderUserSubscriptionPanel(detail) {
  const subscription = detail?.subscription;

  if (!subscription) {
    const message = detail?.subscriptionUnavailableReason === "active_token_not_recoverable"
      ? "这个订阅地址由旧版本创建，后台没有保存完整 token。重置订阅后即可再次复制。"
      : "当前没有可复制的订阅地址。";

    return `
      <section class="panel">
        <div class="panel-header">
          <h2>订阅地址</h2>
        </div>
        <div class="warning">${escapeHtml(message)}</div>
      </section>
    `;
  }

  return `
    <section class="panel">
      <div class="panel-header">
        <h2>订阅地址</h2>
      </div>
      <div class="subscription-links">
        <div class="field">
          <label>Clash</label>
          <div class="copy-row">
            <code>${escapeHtml(subscription.clashUrl || "")}</code>
            <button data-copy-current-sub="clash">复制</button>
          </div>
        </div>
        <div class="field">
          <label>Shadowsocks</label>
          <div class="copy-row">
            <code>${escapeHtml(subscription.ssUrl || "")}</code>
            <button data-copy-current-sub="ss">复制</button>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderSharedTrafficWarning(trafficMode) {
  return `
    <div class="warning">
      ${escapeHtml(trafficMode?.message || "当前为共享端口模式，不能可靠区分每个用户的代理流量。")}
    </div>
  `;
}

function renderUsersIndex() {
  const payload = state.users || {};
  const users = payload.users || [];

  renderShell(
    `
      <section class="tools-header">
        <h2>用户</h2>
      </section>

      ${renderSharedTrafficWarning(payload.trafficMode)}
      ${state.userError ? `<div class="warning">${escapeHtml(state.userError)}</div>` : ""}
      ${renderSubscriptionNotice()}

      <section class="panel">
        <div class="panel-header">
          <h2>新建用户</h2>
        </div>
        <form id="user-create-form" class="user-form">
          <div class="field">
            <label for="user-name">名称</label>
            <input id="user-name" name="name" required placeholder="alice">
          </div>
          <div class="field">
            <label for="user-note">备注</label>
            <input id="user-note" name="note" placeholder="用途、联系人或到期信息">
          </div>
          <div class="field">
            <label for="user-quota">配额 GB</label>
            <input id="user-quota" name="quotaGb" type="number" min="0" step="0.1" placeholder="不填为不限制">
          </div>
          <div class="field">
            <label for="user-period">周期</label>
            <select id="user-period" name="quotaPeriod">
              <option value="monthly">每月</option>
              <option value="weekly">每周</option>
              <option value="daily">每天</option>
            </select>
          </div>
          <div class="form-actions">
            <button class="primary" type="submit">创建用户</button>
          </div>
        </form>
      </section>

      <section class="panel">
        <div class="panel-header">
          <h2>用户列表</h2>
        </div>
        <table>
          <thead><tr><th>用户</th><th>状态</th><th>配额</th><th>订阅访问</th><th>创建时间</th><th>操作</th></tr></thead>
          <tbody>
            ${users.length === 0
              ? `<tr><td colspan="6" class="subtle">还没有用户</td></tr>`
              : users.map((user) => `
                <tr>
                  <td>
                    <div>${escapeHtml(user.name)}</div>
                    ${user.note ? `<div class="subtle">${escapeHtml(user.note)}</div>` : ""}
                  </td>
                  <td><span class="status-pill"><span class="dot ${userStatusClass(user.status)}"></span>${escapeHtml(formatUserStatus(user.status))}</span></td>
                  <td>${escapeHtml(formatQuota(user))}</td>
                  <td>
                    <div>${escapeHtml(String(user.accessCount || 0))} 次</div>
                    <div class="subtle">${escapeHtml(user.lastAccessedAt ? formatTime(user.lastAccessedAt) : "从未拉取")}</div>
                  </td>
                  <td>${escapeHtml(formatTime(user.createdAt))}</td>
                  <td><a class="button-link small-link" href="/users/${encodeURIComponent(user.id)}" data-route-link>详情</a></td>
                </tr>
              `).join("")}
          </tbody>
        </table>
      </section>
    `,
    { nav: "users", showRefresh: true }
  );

  bindUsersEvents();
}

function renderUserDetail() {
  const detail = state.userDetail;
  if (!detail) {
    renderShell(`<section class="panel empty-state"><h2>用户不存在</h2></section>`, { nav: "users" });
    return;
  }

  const user = detail.user;
  const accessLogs = detail.accessLogs || [];
  const userTraffic = detail.userTraffic || {};
  const sharedTraffic = detail.sharedTraffic || {};

  renderShell(
    `
      <div class="breadcrumbs">
        <a href="/users" data-route-link>用户</a>
        <span>/</span>
        <span>${escapeHtml(user.name)}</span>
      </div>

      ${renderSharedTrafficWarning(detail.trafficMode)}
      ${state.userError ? `<div class="warning">${escapeHtml(state.userError)}</div>` : ""}

      <section class="metrics">
        ${metricCard("状态", `<span class="status-pill"><span class="dot ${userStatusClass(user.status)}"></span>${escapeHtml(formatUserStatus(user.status))}</span>`, user.status === "active" ? "订阅可正常拉取" : "订阅接口会返回不可用")}
        ${metricCard("配额", escapeHtml(formatQuota(user)), "共享端口模式下仅作资料记录")}
        ${metricCard("个人流量", escapeHtml(formatBytes(userTraffic.totalBytes)), "预留字段，当前共享端口模式不产生精确数据")}
        ${metricCard("共享端口流量", escapeHtml(formatBytes(sharedTraffic.totalBytes)), `当前范围：${RANGE_LABELS[state.range]}`)}
      </section>

      <section class="panel">
        <div class="panel-header">
          <h2>用户资料</h2>
          <div class="actions">
            <button id="user-toggle-status">${user.status === "active" ? "停用用户" : "启用用户"}</button>
            <button id="user-reset-token" class="primary">重置订阅</button>
          </div>
        </div>
        <dl class="config-list">
          <div><dt>名称</dt><dd>${escapeHtml(user.name)}</dd></div>
          <div><dt>备注</dt><dd>${escapeHtml(user.note || "无")}</dd></div>
          <div><dt>创建时间</dt><dd>${escapeHtml(formatTime(user.createdAt))}</dd></div>
          <div><dt>更新时间</dt><dd>${escapeHtml(formatTime(user.updatedAt))}</dd></div>
        </dl>
      </section>

      ${renderUserSubscriptionPanel(detail)}

      <section class="panel">
        <div class="panel-header">
          <h2>订阅访问记录</h2>
        </div>
        <table>
          <thead><tr><th>时间</th><th>格式</th><th>IP</th><th>User-Agent</th></tr></thead>
          <tbody>
            ${accessLogs.length === 0
              ? `<tr><td colspan="4" class="subtle">还没有订阅拉取记录</td></tr>`
              : accessLogs.map((log) => `
                <tr>
                  <td>${escapeHtml(formatTime(log.ts))}</td>
                  <td>${escapeHtml(log.format)}</td>
                  <td>${escapeHtml(log.ip || "")}</td>
                  <td><code>${escapeHtml(log.userAgent || "")}</code></td>
                </tr>
              `).join("")}
          </tbody>
        </table>
      </section>
    `,
    { nav: "users", showRefresh: true }
  );

  bindUserDetailEvents();
}

function renderToolsIndex() {
  renderShell(
    `
      <section class="tools-header">
        <h2>工具</h2>
      </section>

      <section class="tools-list">
        ${TOOLS.map((tool) => `
          <a class="tool-card" href="${tool.path}" data-route-link>
            <span class="tool-title">${escapeHtml(tool.title)}</span>
            <span class="tool-detail">${escapeHtml(tool.detail)}</span>
          </a>
        `).join("")}
      </section>
    `,
    { nav: "tools" }
  );
}

function renderConfigMergeTool() {
  renderShell(
    `
      <div class="breadcrumbs">
        <a href="/tools" data-route-link>工具</a>
        <span>/</span>
        <span>配置合并</span>
      </div>
      ${renderMergePanel()}
    `,
    { nav: "tools" }
  );

  bindMergeEvents();
}

function renderNotFound() {
  renderShell(
    `
      <section class="panel empty-state">
        <h2>页面不存在</h2>
        <a class="button-link" href="/" data-route-link>返回仪表盘</a>
      </section>
    `,
    { nav: "" }
  );
}

function renderLogin(error = "") {
  app.innerHTML = `
    <main class="login-wrap">
      <form class="login" id="login-form">
        <h1>Shadowsocks 管理后台</h1>
        <p>Railway 私有节点控制台</p>
        <div class="field">
          <label for="username">用户名</label>
          <input id="username" name="username" autocomplete="username" required>
        </div>
        <div class="field">
          <label for="password">密码</label>
          <input id="password" name="password" type="password" autocomplete="current-password" required>
        </div>
        <div class="error">${escapeHtml(error)}</div>
        <button class="primary" type="submit">登录</button>
        <a class="login-guide-link" href="/guide">不用登录，查看使用说明</a>
      </form>
    </main>
  `;

  document.querySelector("#login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await api("/api/login", {
        method: "POST",
        body: JSON.stringify({
          username: form.get("username"),
          password: form.get("password")
        })
      });
      state.authed = true;
      await refreshAll();
    } catch {
      renderLogin("用户名或密码不正确");
    }
  });
}

function renderDashboard() {
  const status = state.status;
  const traffic = state.traffic;
  const online = Boolean(status?.manager?.online);

  const warnings = status?.configWarnings || [];
  const servers = status?.servers || [];
  const events = state.events || [];

  renderShell(
    `
        <section class="metrics">
          ${metricCard(
            "节点状态",
            `<span class="status-pill"><span class="dot ${online ? "online" : "offline"}"></span>${online ? "在线" : "离线"}</span>`,
            status?.manager?.lastError || `管理接口 ${status?.manager?.host || ""}:${status?.manager?.port || ""}`
          )}
          ${metricCard("当前计数器", escapeHtml(formatBytes(status?.traffic?.currentTotalBytes)), "最近一次 ssmanager 返回的总量")}
          ${metricCard("已记录流量", escapeHtml(formatBytes(status?.traffic?.recordedTotalBytes)), `当前范围：${formatBytes(traffic?.totalBytes)}`)}
          ${metricCard("后台运行时间", escapeHtml(formatDuration(status?.admin?.uptimeSeconds)), `启动于 ${formatTime(status?.admin?.startedAt)}`)}
        </section>

        <section class="layout">
          <section class="panel">
            <div class="panel-header">
              <h2>流量</h2>
              <div class="tabs">
                ${["1h", "24h", "7d"].map((range) => `<button data-range="${range}" class="${state.range === range ? "active" : ""}">${RANGE_LABELS[range]}</button>`).join("")}
              </div>
            </div>
            <div class="chart">${drawChart(traffic)}</div>
          </section>

          <section class="stack">
            <section class="panel">
              <div class="panel-header">
                <h2>配置提醒</h2>
              </div>
              <div class="warnings">
                ${warnings.length === 0 ? `<div class="subtle">暂无提醒</div>` : warnings.map((warning) => `<div class="warning">${escapeHtml(warning)}</div>`).join("")}
              </div>
            </section>
          </section>
        </section>

        <section class="layout">
          <section class="panel">
            <div class="panel-header">
              <h2>服务端口</h2>
            </div>
            <table>
              <thead><tr><th>端口</th><th>加密方式</th><th>原始数据</th></tr></thead>
              <tbody>
                ${servers.length === 0
                  ? `<tr><td colspan="3" class="subtle">还没有返回服务端口列表</td></tr>`
                  : servers.map((server) => `
                    <tr>
                      <td>${escapeHtml(server.port)}</td>
                      <td>${escapeHtml(server.method || status?.shadowsocks?.method || "")}</td>
                      <td><code>${escapeHtml(JSON.stringify(server.raw))}</code></td>
                    </tr>
                  `).join("")}
              </tbody>
            </table>
          </section>

          <section class="panel">
            <div class="panel-header">
              <h2>事件记录</h2>
            </div>
            <table>
              <thead><tr><th>时间</th><th>级别</th><th>消息</th></tr></thead>
              <tbody>
                ${events.length === 0
                  ? `<tr><td colspan="3" class="subtle">暂无事件</td></tr>`
                  : events.slice(0, 8).map((event) => `
                    <tr>
                      <td>${escapeHtml(formatTime(event.ts))}</td>
                      <td>${escapeHtml(formatEventLevel(event.level))}</td>
                      <td>
                        <div>${escapeHtml(formatEventMessage(event.message))}</div>
                        ${event.detail ? `<div class="event-detail">${escapeHtml(event.detail)}</div>` : ""}
                      </td>
                    </tr>
                  `).join("")}
              </tbody>
            </table>
          </section>
        </section>
    `,
    { nav: "dashboard", showRefresh: true }
  );

  for (const button of document.querySelectorAll("[data-range]")) {
    button.addEventListener("click", async () => {
      state.range = button.dataset.range;
      await refreshAll();
    });
  }
}

function bindShellEvents() {
  const refresh = document.querySelector("#refresh");
  if (refresh) {
    refresh.addEventListener("click", refreshCurrentRoute);
  }

  const logout = document.querySelector("#logout");
  if (logout) {
    logout.addEventListener("click", async () => {
      await api("/api/logout", { method: "POST" }).catch(() => {});
      state.authed = false;
      renderLogin();
    });
  }

  for (const link of document.querySelectorAll("[data-route-link]")) {
    link.addEventListener("click", (event) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.altKey ||
        event.ctrlKey ||
        event.shiftKey
      ) {
        return;
      }

      const url = new URL(link.href);
      if (url.origin !== window.location.origin) return;
      event.preventDefault();
      navigate(url.pathname).catch(() => {});
    });
  }
}

function bindSubscriptionNoticeEvents() {
  const subscription = state.userSubscription;
  if (!subscription) return;

  const dismiss = document.querySelector("#subscription-dismiss");
  if (dismiss) {
    dismiss.addEventListener("click", () => {
      state.userSubscription = null;
      renderCurrentRoute();
    });
  }

  const clash = document.querySelector("#copy-sub-clash");
  if (clash) {
    clash.addEventListener("click", async (event) => {
      await copyFromButton(event.currentTarget, subscription.clashUrl || "", "已复制");
    });
  }

  const ss = document.querySelector("#copy-sub-ss");
  if (ss) {
    ss.addEventListener("click", async (event) => {
      await copyFromButton(event.currentTarget, subscription.ssUrl || "", "已复制");
    });
  }
}

function bindCurrentSubscriptionEvents() {
  const subscription = state.userDetail?.subscription;
  if (!subscription) return;

  for (const button of document.querySelectorAll("[data-copy-current-sub]")) {
    button.addEventListener("click", async (event) => {
      const format = event.currentTarget.dataset.copyCurrentSub;
      const text = format === "ss" ? subscription.ssUrl : subscription.clashUrl;
      await copyFromButton(event.currentTarget, text || "", "已复制");
    });
  }
}

function saveMergeFormState() {
  const input = document.querySelector("#merge-input");
  const domains = document.querySelector("#merge-domains");
  const password = document.querySelector("#merge-password");

  if (input) state.merge.input = input.value;
  if (domains) state.merge.domains = domains.value;
  if (password) state.merge.password = password.value;
}

function bindMergeEvents() {
  document.querySelector("#merge-file").addEventListener("change", async (event) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    state.merge.input = await file.text();
    state.merge.output = "";
    state.merge.error = "";
    state.merge.warnings = [];
    renderCurrentRoute();
  });

  for (const field of ["#merge-input", "#merge-domains", "#merge-password"]) {
    document.querySelector(field).addEventListener("input", saveMergeFormState);
  }

  document.querySelector("#merge-generate").addEventListener("click", async () => {
    saveMergeFormState();
    state.merge.busy = true;
    state.merge.error = "";
    renderCurrentRoute();

    try {
      const merged = await api("/api/merge-client-config", {
        method: "POST",
        body: JSON.stringify({
          baseConfig: state.merge.input,
          fixedIpDomains: state.merge.domains
        })
      });

      state.merge.output = withLocalPassword(merged.clashYaml || "", state.merge.password);
      state.merge.warnings = merged.warnings || [];
    } catch (error) {
      state.merge.error = error instanceof Error ? error.message : "配置合并失败";
    } finally {
      state.merge.busy = false;
      renderCurrentRoute();
    }
  });

  document.querySelector("#merge-copy").addEventListener("click", async (event) => {
    if (!state.merge.output) return;
    await copyFromButton(event.currentTarget, state.merge.output, "结果已复制");
  });

  document.querySelector("#merge-download").addEventListener("click", () => {
    if (!state.merge.output) return;
    downloadTextFile("clash-railway-merged.yaml", state.merge.output);
  });

  document.querySelector("#merge-clear").addEventListener("click", () => {
    state.merge = {
      busy: false,
      domains: "",
      error: "",
      input: "",
      output: "",
      password: "",
      warnings: []
    };
    renderCurrentRoute();
  });
}

function bindUsersEvents() {
  bindSubscriptionNoticeEvents();

  const form = document.querySelector("#user-create-form");
  if (!form) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    state.userError = "";
    const formData = new FormData(event.currentTarget);

    try {
      const result = await api("/api/users", {
        method: "POST",
        body: JSON.stringify({
          name: formData.get("name"),
          note: formData.get("note"),
          quotaBytes: quotaGbToBytes(formData.get("quotaGb")),
          quotaPeriod: formData.get("quotaPeriod")
        })
      });
      state.userSubscription = result.subscription;
      await loadUsers();
      renderCurrentRoute();
    } catch (error) {
      state.userError = error instanceof Error ? error.message : "创建用户失败";
      renderCurrentRoute();
    }
  });
}

function bindUserDetailEvents() {
  bindCurrentSubscriptionEvents();

  const detail = state.userDetail;
  const user = detail?.user;
  if (!user) return;

  const toggle = document.querySelector("#user-toggle-status");
  if (toggle) {
    toggle.addEventListener("click", async () => {
      state.userError = "";
      try {
        await api(`/api/users/${encodeURIComponent(user.id)}`, {
          method: "PATCH",
          body: JSON.stringify({
            status: user.status === "active" ? "disabled" : "active"
          })
        });
        await loadUserDetail(user.id);
        renderCurrentRoute();
      } catch (error) {
        state.userError = error instanceof Error ? error.message : "更新用户失败";
        renderCurrentRoute();
      }
    });
  }

  const reset = document.querySelector("#user-reset-token");
  if (reset) {
    reset.addEventListener("click", async () => {
      state.userError = "";
      try {
        await api(`/api/users/${encodeURIComponent(user.id)}/token/reset`, {
          method: "POST"
        });
        state.userSubscription = null;
        await loadUserDetail(user.id);
        renderCurrentRoute();
      } catch (error) {
        state.userError = error instanceof Error ? error.message : "重置订阅失败";
        renderCurrentRoute();
      }
    });
  }
}

function renderCurrentRoute() {
  const route = getRoute();

  if (route.name === "dashboard") {
    renderDashboard();
    return;
  }

  if (route.name === "users") {
    renderUsersIndex();
    return;
  }

  if (route.name === "user-detail") {
    renderUserDetail();
    return;
  }

  if (route.name === "tools") {
    renderToolsIndex();
    return;
  }

  if (route.name === "config-merge") {
    renderConfigMergeTool();
    return;
  }

  renderNotFound();
}

async function navigate(pathname) {
  if (window.location.pathname !== pathname) {
    window.history.pushState({}, "", pathname);
  }

  await refreshCurrentRoute();
}

async function loadUsers() {
  state.users = await api("/api/users");
}

async function loadUserDetail(userId) {
  state.userSubscription = null;
  state.userDetail = await api(`/api/users/${encodeURIComponent(userId)}?range=${encodeURIComponent(state.range)}`);
}

async function refreshCurrentRoute() {
  const route = getRoute();

  if (route.name === "dashboard") {
    await refreshAll();
    return;
  }

  if (route.name === "users") {
    await loadUsers();
    renderCurrentRoute();
    return;
  }

  if (route.name === "user-detail") {
    await loadUserDetail(route.userId);
    renderCurrentRoute();
    return;
  }

  renderCurrentRoute();
}

async function refreshAll() {
  state.busy = true;
  const [status, traffic, events] = await Promise.all([
    api("/api/status"),
    api(`/api/traffic?range=${encodeURIComponent(state.range)}`),
    api("/api/events")
  ]);
  state.status = status;
  state.traffic = traffic;
  state.events = events.events || [];
  state.busy = false;
  renderCurrentRoute();
}

async function boot() {
  try {
    await api("/api/me");
    state.authed = true;
    await refreshCurrentRoute();
  } catch {
    renderLogin();
  }
}

boot();
window.addEventListener("popstate", () => {
  if (!state.authed) return;
  refreshCurrentRoute().catch(() => {});
});

setInterval(() => {
  if (state.authed && !state.busy && getRoute().name === "dashboard") refreshAll().catch(() => {});
}, 15000);
