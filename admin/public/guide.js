const app = document.querySelector("#guide-app");

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function fieldValue(value, fallback = "未配置") {
  return value ? escapeHtml(value) : `<span class="missing">${escapeHtml(fallback)}</span>`;
}

function getClientFields(clientConfig) {
  return {
    host: clientConfig?.publicHost || "",
    method: clientConfig?.method || "aes-256-gcm",
    passwordHint: "使用 Railway 服务变量 SS_PASSWORD 的值",
    port: clientConfig?.publicPort || "",
    type: "Shadowsocks / SS",
    udp: "关闭"
  };
}

function buildManualConfigText(clientConfig) {
  const fields = getClientFields(clientConfig);
  return [
    "类型：Shadowsocks / SS",
    `服务器地址：${fields.host || "请先配置 PUBLIC_SS_HOST"}`,
    `端口：${fields.port || "请先配置 PUBLIC_SS_PORT"}`,
    `加密方式：${fields.method || "aes-256-gcm"}`,
    "密码：Railway 服务变量 SS_PASSWORD 的值（页面不会显示明文）",
    "UDP：关闭"
  ].join("\n");
}

function renderManualFields(clientConfig) {
  const fields = getClientFields(clientConfig);

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

function renderGuide(clientConfig, error = "") {
  const endpoint = clientConfig?.publicHost && clientConfig?.publicPort
    ? `${clientConfig.publicHost}:${clientConfig.publicPort}`
    : "尚未配置客户端地址";
  const ssPort = clientConfig?.ssPort || 8388;

  app.innerHTML = `
    <div class="shell guide-shell">
      <header class="topbar">
        <div class="brand">
          <h1>Shadowsocks 使用说明</h1>
          <p>${escapeHtml(endpoint)}</p>
        </div>
        <div class="actions">
          <button id="copy-manual">复制填写信息</button>
          <button id="copy-clash">复制 Clash 配置</button>
          <a class="button-link" href="/">管理后台</a>
        </div>
      </header>

      <main class="dashboard">
        ${error ? `<div class="warning">${escapeHtml(error)}</div>` : ""}
        <section class="panel guide-panel">
          <div class="guide-intro">
            这个服务不是完整 VPN，而是一个私有 Shadowsocks 节点。电脑或手机需要安装支持 Shadowsocks 的客户端，然后把下面的节点信息填进去。
          </div>

          <div class="guide-grid">
            <section class="guide-section">
              <h2>先确认</h2>
              <ol>
                <li>Railway 的 HTTP 域名指向管理后台端口 <code>3000</code>。</li>
                <li>Railway 的 TCP Proxy 指向 Shadowsocks 端口 <code>${escapeHtml(ssPort)}</code>。</li>
                <li><code>PUBLIC_SS_HOST</code> 和 <code>PUBLIC_SS_PORT</code> 填的是 TCP Proxy 给你的外部地址和端口。</li>
                <li>密码用 Railway 变量里的 <code>SS_PASSWORD</code>，这个页面不会显示明文密码。</li>
              </ol>
            </section>

            <section class="guide-section">
              <h2>电脑</h2>
              <ol>
                <li>安装支持 Clash 或 Shadowsocks 的客户端。</li>
                <li>如果客户端支持 Clash 配置，复制下方“Clash 配置”，新建配置文件后粘贴进去。</li>
                <li>把配置里的 <code>YOUR_SS_PASSWORD</code> 改成 Railway 变量 <code>SS_PASSWORD</code> 的真实值。</li>
                <li>把示例规则 <code>example.com</code> 改成你要走代理的网站域名，或在客户端里切到全局模式。</li>
                <li>启用代理后打开 IP 查询网站，确认出口 IP 变成 Railway 的出口 IP。</li>
              </ol>
            </section>

            <section class="guide-section">
              <h2>手机</h2>
              <ol>
                <li>安装支持 Shadowsocks 的手机客户端。</li>
                <li>新建节点，类型选择 <code>Shadowsocks</code> 或 <code>SS</code>。</li>
                <li>按下面“手动填写信息”逐项填写服务器地址、端口、加密方式和密码。</li>
                <li>UDP 关闭；保存后连接节点。</li>
                <li>手机浏览器打开 IP 查询网站，确认出口 IP 正常变化。</li>
              </ol>
            </section>
          </div>
        </section>

        <section class="layout">
          <section class="panel">
            <div class="panel-header">
              <h2>手动填写信息</h2>
            </div>
            ${renderManualFields(clientConfig)}
          </section>

          <section class="panel">
            <div class="panel-header">
              <h2>Clash 配置</h2>
            </div>
            <pre>${escapeHtml(clientConfig?.clashYaml || "")}</pre>
          </section>
        </section>
      </main>
    </div>
  `;

  document.querySelector("#copy-manual").addEventListener("click", async (event) => {
    await copyFromButton(event.currentTarget, buildManualConfigText(clientConfig), "信息已复制");
  });
  document.querySelector("#copy-clash").addEventListener("click", async (event) => {
    await copyFromButton(event.currentTarget, clientConfig?.clashYaml || "", "配置已复制");
  });
}

async function boot() {
  try {
    const response = await fetch("/api/public-client-config", { credentials: "same-origin" });
    const clientConfig = await response.json();
    if (!response.ok) throw new Error(clientConfig.message || clientConfig.error || "读取配置失败");
    renderGuide(clientConfig);
  } catch (error) {
    renderGuide(null, error instanceof Error ? error.message : "读取配置失败");
  }
}

boot();
