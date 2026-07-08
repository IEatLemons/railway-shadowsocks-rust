const app = document.querySelector("#app");

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
  if (!value) return "Never";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium"
  }).format(new Date(value));
}

function formatDuration(seconds) {
  const value = Number(seconds || 0);
  if (value < 60) return `${value}s`;
  if (value < 3600) return `${Math.floor(value / 60)}m ${value % 60}s`;
  return `${Math.floor(value / 3600)}h ${Math.floor((value % 3600) / 60)}m`;
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
    throw new Error("Unauthorized");
  }

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.message || payload.error || "Request failed");
  }
  return payload;
}

function drawChart(summary) {
  const points = summary?.points || [];
  if (points.length === 0) {
    return `<div class="chart-empty">No traffic samples yet</div>`;
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
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Traffic chart">
      <line x1="${pad}" y1="${height - pad}" x2="${width - pad}" y2="${height - pad}" stroke="#cbd5df" />
      <line x1="${pad}" y1="${pad}" x2="${pad}" y2="${height - pad}" stroke="#cbd5df" />
      <polyline points="${coordinates.join(" ")}" fill="none" stroke="#1f6feb" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
      ${points
        .map((point) => {
          const [x, y] = coordinates[points.indexOf(point)].split(",");
          return `<circle cx="${x}" cy="${y}" r="4" fill="#168a53"><title>${formatBytes(point.bytes)} at ${formatTime(point.timestamp)}</title></circle>`;
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

function renderLogin(error = "") {
  app.innerHTML = `
    <main class="login-wrap">
      <form class="login" id="login-form">
        <h1>Shadowsocks Admin</h1>
        <p>Railway node dashboard</p>
        <div class="field">
          <label for="username">Username</label>
          <input id="username" name="username" autocomplete="username" required>
        </div>
        <div class="field">
          <label for="password">Password</label>
          <input id="password" name="password" type="password" autocomplete="current-password" required>
        </div>
        <div class="error">${escapeHtml(error)}</div>
        <button class="primary" type="submit">Log In</button>
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
      renderLogin("Invalid username or password");
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
    : "Not configured";

  const warnings = status?.configWarnings || [];
  const servers = status?.servers || [];
  const events = state.events || [];

  app.innerHTML = `
    <div class="shell">
      <header class="topbar">
        <div class="brand">
          <h1>Shadowsocks Admin</h1>
          <p>${escapeHtml(endpoint)}</p>
        </div>
        <div class="actions">
          <button id="refresh">Refresh</button>
          <button id="copy-config">Copy Config</button>
          <button id="logout">Logout</button>
        </div>
      </header>

      <main class="dashboard">
        <section class="metrics">
          ${metricCard(
            "Node",
            `<span class="status-pill"><span class="dot ${online ? "online" : "offline"}"></span>${online ? "Online" : "Offline"}</span>`,
            status?.manager?.lastError || `Manager ${status?.manager?.host || ""}:${status?.manager?.port || ""}`
          )}
          ${metricCard("Current Counter", escapeHtml(formatBytes(status?.traffic?.currentTotalBytes)), "Latest ssmanager ping total")}
          ${metricCard("Recorded Traffic", escapeHtml(formatBytes(status?.traffic?.recordedTotalBytes)), `Range total: ${formatBytes(traffic?.totalBytes)}`)}
          ${metricCard("Admin Uptime", escapeHtml(formatDuration(status?.admin?.uptimeSeconds)), `Started ${formatTime(status?.admin?.startedAt)}`)}
        </section>

        <section class="layout">
          <section class="panel">
            <div class="panel-header">
              <h2>Traffic</h2>
              <div class="tabs">
                ${["1h", "24h", "7d"].map((range) => `<button data-range="${range}" class="${state.range === range ? "active" : ""}">${range}</button>`).join("")}
              </div>
            </div>
            <div class="chart">${drawChart(traffic)}</div>
          </section>

          <section class="stack">
            <section class="panel">
              <div class="panel-header">
                <h2>Client Config</h2>
              </div>
              <pre>${escapeHtml(clientConfig?.clashYaml || "")}</pre>
            </section>
            <section class="panel">
              <div class="panel-header">
                <h2>Warnings</h2>
              </div>
              <div class="warnings">
                ${warnings.length === 0 ? `<div class="subtle">No warnings</div>` : warnings.map((warning) => `<div class="warning">${escapeHtml(warning)}</div>`).join("")}
              </div>
            </section>
          </section>
        </section>

        <section class="layout">
          <section class="panel">
            <div class="panel-header">
              <h2>Servers</h2>
            </div>
            <table>
              <thead><tr><th>Port</th><th>Method</th><th>Raw</th></tr></thead>
              <tbody>
                ${servers.length === 0
                  ? `<tr><td colspan="3" class="subtle">No server list returned</td></tr>`
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
              <h2>Events</h2>
            </div>
            <table>
              <thead><tr><th>Time</th><th>Level</th><th>Message</th></tr></thead>
              <tbody>
                ${events.length === 0
                  ? `<tr><td colspan="3" class="subtle">No events</td></tr>`
                  : events.slice(0, 8).map((event) => `
                    <tr>
                      <td>${escapeHtml(formatTime(event.ts))}</td>
                      <td>${escapeHtml(event.level)}</td>
                      <td>${escapeHtml(event.message)}</td>
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
  document.querySelector("#copy-config").addEventListener("click", async () => {
    await navigator.clipboard.writeText(clientConfig?.clashYaml || "");
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
