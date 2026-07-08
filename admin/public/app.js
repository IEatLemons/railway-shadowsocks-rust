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
  "Manager connection failed": "管理接口连接失败",
  "Unhandled API error": "后台接口异常"
};

let state = {
  authed: false,
  busy: false,
  range: "24h",
  status: null,
  traffic: null,
  clientConfig: null,
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
  const units = ["B", "KB", "MB", "GB", "TB"];
  let index = 0;
  let next = bytes;
  while (next >= 1024 && index < units.length - 1) {
    next /= 1024;
    index += 1;
  }
  return `${next.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
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

function drawChart(summary) {
  const points = summary?.points || [];
  if (points.length === 0) {
    return `<div class="chart-empty">还没有流量样本</div>`;
  }

  const width = 720;
  const height = 260;
  const pad = 28;
  const maxBytes = Math.max(...points.map((point) => point.bytes), 1);
  const minTime = summary.since;
  const maxTime = summary.until;
  const xSpan = Math.max(1, maxTime - minTime);

  const coordinates = points.map((point) => {
    const x = pad + ((point.timestamp - minTime) / xSpan) * (width - pad * 2);
    const y = height - pad - (point.bytes / maxBytes) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  return `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="流量图表">
      <line x1="${pad}" y1="${height - pad}" x2="${width - pad}" y2="${height - pad}" stroke="#cbd5df" />
      <line x1="${pad}" y1="${pad}" x2="${pad}" y2="${height - pad}" stroke="#cbd5df" />
      <polyline points="${coordinates.join(" ")}" fill="none" stroke="#1f6feb" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
      ${points
        .map((point, index) => {
          const [x, y] = coordinates[index].split(",");
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

function getClientFields(status, clientConfig) {
  const host = clientConfig?.publicHost || status?.shadowsocks?.publicHost || "";
  const port = clientConfig?.publicPort || status?.shadowsocks?.publicPort || "";
  const method = clientConfig?.method || status?.shadowsocks?.method || "";
  const passwordConfigured = status?.shadowsocks?.passwordConfigured;
  const passwordHint = passwordConfigured === false
    ? "未检测到 SS_PASSWORD，请先在 Railway 变量中设置"
    : "使用 Railway 服务变量 SS_PASSWORD 的值";

  return {
    host,
    method,
    passwordHint,
    port,
    type: "Shadowsocks / SS",
    udp: "关闭"
  };
}

function fieldValue(value, fallback = "未配置") {
  return value ? escapeHtml(value) : `<span class="missing">${escapeHtml(fallback)}</span>`;
}

function buildManualConfigText(status, clientConfig) {
  const fields = getClientFields(status, clientConfig);
  return [
    "类型：Shadowsocks / SS",
    `服务器地址：${fields.host || "请先配置 PUBLIC_SS_HOST"}`,
    `端口：${fields.port || "请先配置 PUBLIC_SS_PORT"}`,
    `加密方式：${fields.method || "aes-256-gcm"}`,
    "密码：Railway 服务变量 SS_PASSWORD 的值（后台不会显示明文）",
    "UDP：关闭"
  ].join("\n");
}

function renderManualFields(status, clientConfig) {
  const fields = getClientFields(status, clientConfig);

  return `
    <dl class="config-list">
      <div>
        <dt>类型</dt>
        <dd><code>${escapeHtml(fields.type)}</code></dd>
      </div>
      <div>
        <dt>服务器地址</dt>
        <dd><code>${fieldValue(fields.host, "未配置 PUBLIC_SS_HOST")}</code></dd>
      </div>
      <div>
        <dt>端口</dt>
        <dd><code>${fieldValue(fields.port, "未配置 PUBLIC_SS_PORT")}</code></dd>
      </div>
      <div>
        <dt>加密方式</dt>
        <dd><code>${fieldValue(fields.method)}</code></dd>
      </div>
      <div>
        <dt>密码</dt>
        <dd>${escapeHtml(fields.passwordHint)}</dd>
      </div>
      <div>
        <dt>UDP</dt>
        <dd><code>${escapeHtml(fields.udp)}</code></dd>
      </div>
    </dl>
  `;
}

function renderUsageGuide(status, clientConfig) {
  return `
    <section class="panel guide-panel">
      <div class="panel-header">
        <h2>使用说明</h2>
        <button id="copy-manual">复制填写信息</button>
      </div>

      <div class="guide-intro">
        这个服务不是完整 VPN，而是一个私有 Shadowsocks 节点。电脑或手机需要安装支持 Shadowsocks 的客户端，然后把下面的节点信息填进去。
      </div>

      <div class="guide-grid">
        <section class="guide-section">
          <h3>先确认</h3>
          <ol>
            <li>Railway 的 HTTP 域名指向管理后台端口 <code>3000</code>。</li>
            <li>Railway 的 TCP Proxy 指向 Shadowsocks 端口 <code>8388</code>。</li>
            <li><code>PUBLIC_SS_HOST</code> 和 <code>PUBLIC_SS_PORT</code> 填的是 TCP Proxy 给你的外部地址和端口。</li>
            <li>密码用 Railway 变量里的 <code>SS_PASSWORD</code>，后台不会显示明文密码。</li>
          </ol>
        </section>

        <section class="guide-section">
          <h3>电脑</h3>
          <ol>
            <li>安装支持 Clash 或 Shadowsocks 的客户端。</li>
            <li>如果客户端支持 Clash 配置，复制右侧“Clash 配置”，新建配置文件后粘贴进去。</li>
            <li>把配置里的 <code>YOUR_SS_PASSWORD</code> 改成 Railway 变量 <code>SS_PASSWORD</code> 的真实值。</li>
            <li>把示例规则 <code>example.com</code> 改成你要走代理的网站域名，或在客户端里切到全局模式。</li>
            <li>启用代理后打开 IP 查询网站，确认出口 IP 变成 Railway 的出口 IP。</li>
          </ol>
        </section>

        <section class="guide-section">
          <h3>手机</h3>
          <ol>
            <li>安装支持 Shadowsocks 的手机客户端。</li>
            <li>新建节点，类型选择 <code>Shadowsocks</code> 或 <code>SS</code>。</li>
            <li>按下面“手动填写信息”逐项填写服务器地址、端口、加密方式和密码。</li>
            <li>UDP 关闭；保存后连接节点。</li>
            <li>手机浏览器打开 IP 查询网站，确认出口 IP 正常变化。</li>
          </ol>
        </section>
      </div>

      <section class="manual-section">
        <h3>手动填写信息</h3>
        ${renderManualFields(status, clientConfig)}
      </section>
    </section>
  `;
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
  const clientConfig = state.clientConfig;
  const online = Boolean(status?.manager?.online);
  const endpoint = status?.shadowsocks?.publicHost && status?.shadowsocks?.publicPort
    ? `${status.shadowsocks.publicHost}:${status.shadowsocks.publicPort}`
    : "尚未配置客户端地址";

  const warnings = status?.configWarnings || [];
  const servers = status?.servers || [];
  const events = state.events || [];

  app.innerHTML = `
    <div class="shell">
      <header class="topbar">
        <div class="brand">
          <h1>Shadowsocks 管理后台</h1>
          <p>${escapeHtml(endpoint)}</p>
        </div>
        <div class="actions">
          <button id="refresh">刷新</button>
          <button id="copy-config">复制 Clash 配置</button>
          <button id="logout">退出登录</button>
        </div>
      </header>

      <main class="dashboard">
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

        ${renderUsageGuide(status, clientConfig)}

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
                <h2>Clash 配置</h2>
              </div>
              <pre>${escapeHtml(clientConfig?.clashYaml || "")}</pre>
            </section>
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
      </main>
    </div>
  `;

  document.querySelector("#refresh").addEventListener("click", refreshAll);
  document.querySelector("#logout").addEventListener("click", async () => {
    await api("/api/logout", { method: "POST" }).catch(() => {});
    state.authed = false;
    renderLogin();
  });
  document.querySelector("#copy-config").addEventListener("click", async (event) => {
    await copyFromButton(event.currentTarget, clientConfig?.clashYaml || "", "配置已复制");
  });
  document.querySelector("#copy-manual").addEventListener("click", async (event) => {
    await copyFromButton(event.currentTarget, buildManualConfigText(status, clientConfig), "信息已复制");
  });
  for (const button of document.querySelectorAll("[data-range]")) {
    button.addEventListener("click", async () => {
      state.range = button.dataset.range;
      await refreshAll();
    });
  }
}

async function refreshAll() {
  state.busy = true;
  const [status, traffic, clientConfig, events] = await Promise.all([
    api("/api/status"),
    api(`/api/traffic?range=${encodeURIComponent(state.range)}`),
    api("/api/client-config"),
    api("/api/events")
  ]);
  state.status = status;
  state.traffic = traffic;
  state.clientConfig = clientConfig;
  state.events = events.events || [];
  state.busy = false;
  renderDashboard();
}

async function boot() {
  try {
    await api("/api/me");
    state.authed = true;
    await refreshAll();
  } catch {
    renderLogin();
  }
}

boot();
setInterval(() => {
  if (state.authed && !state.busy) refreshAll().catch(() => {});
}, 15000);
