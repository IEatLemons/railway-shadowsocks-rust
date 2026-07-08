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
          <a class="button-link" href="/guide" target="_blank" rel="noopener">使用说明</a>
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

        ${renderMergePanel()}

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
      </main>
    </div>
  `;

  document.querySelector("#refresh").addEventListener("click", refreshAll);
  document.querySelector("#logout").addEventListener("click", async () => {
    await api("/api/logout", { method: "POST" }).catch(() => {});
    state.authed = false;
    renderLogin();
  });
  for (const button of document.querySelectorAll("[data-range]")) {
    button.addEventListener("click", async () => {
      state.range = button.dataset.range;
      await refreshAll();
    });
  }

  document.querySelector("#merge-file").addEventListener("change", async (event) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    state.merge.input = await file.text();
    state.merge.output = "";
    state.merge.error = "";
    state.merge.warnings = [];
    renderDashboard();
  });

  document.querySelector("#merge-generate").addEventListener("click", async () => {
    state.merge.input = document.querySelector("#merge-input").value;
    state.merge.domains = document.querySelector("#merge-domains").value;
    state.merge.password = document.querySelector("#merge-password").value;
    state.merge.busy = true;
    state.merge.error = "";
    renderDashboard();

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
      renderDashboard();
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
    renderDashboard();
  });
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
