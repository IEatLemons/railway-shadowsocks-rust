# Railway Shadowsocks-Rust 节点

这个模板会在 Railway 上部署一个私有 Shadowsocks 节点，并自带中文管理后台。电脑或手机需要安装支持 Shadowsocks 的客户端，然后把 Railway 的 TCP Proxy 地址、端口、加密方式和 `SS_PASSWORD` 填进去。

它不是完整 VPN，而是一个 TCP Shadowsocks 代理节点。通常用于让浏览器或应用的指定域名流量通过 Railway 出口访问目标网站；如果开启 Railway Static Outbound IPs，目标网站看到的会是 Railway 的出口 IP。

## 工作方式

```text
浏览器 / App
  -> 本机代理客户端规则
  -> Railway TCP Proxy
  -> Railway 容器里的 shadowsocks-rust
  -> 目标网站

管理后台浏览器
  -> Railway HTTP 域名，端口 3000
  -> 内置中文管理后台
  -> 容器内 ssmanager UDP 管理接口
```

## Railway 部署

1. 创建一个新的 GitHub 仓库，并放入本项目文件。
2. 在 Railway 里从这个仓库创建项目。
3. 在 Railway 服务变量中添加：

```text
SS_PASSWORD=<一段很长的随机密码>
ADMIN_USERNAME=admin
ADMIN_PASSWORD=<另一段很长的随机密码>
ADMIN_PORT=3000
SS_METHOD=aes-256-gcm
SS_PORT=8388
SS_TIMEOUT=300
SS_MANAGER_PORT=6100
PUBLIC_SS_HOST=<创建 TCP Proxy 后再填写>
PUBLIC_SS_PORT=<创建 TCP Proxy 后再填写>
DATA_DIR=/data
DATABASE_URL=<可选，Railway PostgreSQL 连接串>
```

`SS_PASSWORD` 和 `ADMIN_PASSWORD` 必填，其他变量有默认值。`DATABASE_URL` 不填时会继续使用 `/data/admin.sqlite`；接入 Railway PostgreSQL 后会使用 PostgreSQL 保存用户、订阅 token 和访问记录。可以用下面的命令生成随机密码：

```bash
openssl rand -base64 32
```

4. 部署服务。
5. 打开 Railway 服务的 Networking 页面。
6. 创建一个公开 HTTP 域名给管理后台使用；如果 Railway 询问端口，选择或输入 `3000`。
7. 创建一个 TCP Proxy，内部端口填 `8388`。
8. 复制 TCP Proxy 生成的外部地址和端口，例如：

```text
something.proxy.rlwy.net:12345
```

9. 把这两个值写回 Railway 服务变量：

```text
PUBLIC_SS_HOST=something.proxy.rlwy.net
PUBLIC_SS_PORT=12345
```

10. 重新部署服务，让管理后台能显示最终客户端配置。
11. 不要给 `6100` 创建公开 TCP Proxy。`6100` 是容器内部 UDP 管理接口，只给后台读取状态用。
12. 如果你需要固定出口 IP，在 Railway 服务里启用 Static Outbound IPs，并把 Railway 列出的所有出口 IP 加到目标网站白名单。

## 管理后台

同一个容器会监听：

```text
3000/tcp  中文管理后台
8388/tcp  Shadowsocks 代理入口
6100/udp  容器内部管理接口
```

打开后台：

1. 在 Railway 服务 Networking 页面点击 `Generate Domain`。
2. 确认这个 HTTP 域名指向端口 `3000`。
3. 打开生成的 `https://...up.railway.app` 地址。
4. 使用 `ADMIN_USERNAME` 和 `ADMIN_PASSWORD` 登录。

如果你之前把 HTTP 域名指到了 `8388`，请删除或改成 `3000`。`8388` 不是 HTTP 服务，浏览器无法直接打开。

建议添加一个 Railway Volume，并挂载到 `/data`。这样流量历史和事件记录会保存在 `${DATA_DIR}/admin.sqlite`，服务重启后不会丢。如果设置了 `DATABASE_URL`，后台会优先使用 PostgreSQL。

使用说明已经独立成公开页面，不需要登录即可访问：

```text
https://你的后台域名/guide
```

管理后台里提供“用户”“使用说明”和“工具”入口。说明页会展示电脑和手机怎么填，也可以复制 Clash 配置；公开说明页和 `/api/public-client-config` 不会返回 `SS_PASSWORD` 明文。

### 多用户订阅

后台“用户”页面可以创建多个用户。每个用户会得到独立订阅地址：

```text
https://你的后台域名/sub/<token>/clash.yaml
https://你的后台域名/sub/<token>/ss.txt
```

后台会保存当前有效 token，用来在用户详情页再次复制订阅地址。旧版本已经创建、但数据库里没有保存完整 token 的用户，需要先重置一次订阅后才能再次复制。订阅地址本身会返回带真实 `SS_PASSWORD` 的可用配置，谁拿到地址谁就能使用节点，请像密码一样保管后台数据库和备份。

第一版仍然是共享一个 Railway TCP Proxy 和一个 Shadowsocks 端口。后台可以记录每个用户的订阅拉取记录，也可以停用用户让订阅接口不再返回配置；但已经导入过配置的客户端可能继续使用共享密码连接。当前 shadowsocks-rust 管理接口返回的是按端口统计的流量，不能可靠区分共享端口下每个用户的真实代理流量。未来要精确按用户统计和超额断开，需要迁移到“每用户独立端口/密码”的模式。

后台“工具”板块提供独立的“配置合并”页面。你可以把机场客户端当前使用的 Clash YAML 配置上传或粘贴进去，后台会把 Railway 节点追加为 `railway-fixed-ip`，并追加一个 `FixedIP` 代理组，最后输出一份合并后的 Clash 配置。可选填写要走 Railway 固定 IP 的域名，生成器会把这些规则插到 `MATCH` 规则之前。

`SS_PASSWORD` 仍然不会由后台 API 返回。合并工具里的密码输入框只在浏览器本地把 `YOUR_SS_PASSWORD` 占位符替换成真实值，不会提交给后端；也可以不填，生成后手动替换。

### 管理 API

管理后台会使用这些需要登录态的 API：

```text
POST /api/login
POST /api/logout
GET /api/me
GET /api/status
GET /api/traffic?range=1h|24h|7d
GET /api/events
GET /api/users
POST /api/users
GET /api/users/:id
PATCH /api/users/:id
POST /api/users/:id/token/reset
POST /api/merge-client-config
```

这些公开入口不需要登录：

```text
GET /guide
GET /api/public-client-config
GET /sub/:token/clash.yaml
GET /sub/:token/ss.txt
GET /healthz
```

`/healthz` 用于 Railway 健康检查。`/api/client-config` 仍保留为登录后的兼容接口。

## 电脑怎么使用

你需要一个支持 Clash 配置或 Shadowsocks 的桌面客户端。

最通用的方式：

1. 打开 `/guide` 使用说明页面。
2. 点击“复制 Clash 配置”。
3. 在电脑代理客户端中新建配置文件，把内容粘贴进去。
4. 把配置里的 `YOUR_SS_PASSWORD` 改成 Railway 服务变量 `SS_PASSWORD` 的真实值。
5. 把示例规则里的 `example.com` 改成你希望走代理的网站域名。
6. 启用代理后，打开一个 IP 查询网站，确认出口 IP 变成 Railway 的出口 IP。

如果你的客户端不支持 Clash 配置，就手动添加 Shadowsocks 节点：

```text
类型：Shadowsocks / SS
服务器地址：PUBLIC_SS_HOST
端口：PUBLIC_SS_PORT
加密方式：SS_METHOD，默认 aes-256-gcm
密码：SS_PASSWORD
UDP：关闭
```

注意：客户端里要填的是 Railway TCP Proxy 给你的外部端口，也就是 `PUBLIC_SS_PORT`，不是容器内部的 `8388`。

## 手机上怎么使用

手机也需要安装支持 Shadowsocks 的客户端。

手动添加节点时这样填：

```text
类型：Shadowsocks / SS
服务器地址：PUBLIC_SS_HOST
端口：PUBLIC_SS_PORT
加密方式：SS_METHOD，默认 aes-256-gcm
密码：SS_PASSWORD
UDP：关闭
```

如果手机客户端支持 Clash 配置，也可以复制后台里的 Clash 配置，再把 `YOUR_SS_PASSWORD` 改成 Railway 变量里的真实密码。

连接后用手机浏览器打开 IP 查询网站。如果出口 IP 没有变化，优先检查三件事：

1. 手机客户端是否真的连接到这个节点。
2. 端口是否填了 Railway TCP Proxy 的外部端口。
3. 密码是否和 Railway 变量 `SS_PASSWORD` 完全一致。

## Clash 配置示例

本仓库提供了 `clashx-example.yaml`。你也可以直接从管理后台复制同样格式的配置。

需要替换的值：

```text
YOUR_RAILWAY_TCP_PROXY_HOST
YOUR_RAILWAY_TCP_PROXY_PORT
YOUR_SS_PASSWORD
```

示例：

```yaml
proxies:
  - name: railway-fixed-ip
    type: ss
    server: something.proxy.rlwy.net
    port: 12345
    cipher: aes-256-gcm
    password: "your-long-random-password"
    udp: false
```

按域名走代理：

```yaml
rules:
  - DOMAIN-SUFFIX,example.com,railway-fixed-ip
  - DOMAIN,login.example.com,railway-fixed-ip
  - MATCH,DIRECT
```

如果你的配置里使用了代理组，可以把目标域名路由到代理组：

```yaml
rules:
  - DOMAIN-SUFFIX,example.com,FixedIP
  - MATCH,DIRECT
```

## 测试

客户端连接后：

1. 打开一个显示公网 IP 的网站。
2. 临时让这个网站的域名走 `railway-fixed-ip`。
3. 确认显示的 IP 是 Railway 的出口 IP。
4. 再测试真正的目标网站。

本地只运行管理后台，不运行 Shadowsocks：

```bash
cd admin
ADMIN_PASSWORD=local-dev-password DATA_DIR=/tmp/ss-admin npm start
```

然后打开 `http://127.0.0.1:3000`。如果本地没有 UDP `6100` 的 `ssmanager`，后台会显示节点离线和超时原因，这是正常的。

本地运行完整容器时，构建根目录的 Dockerfile，打开 `http://127.0.0.1:3000`，并让客户端连接暴露出来的 `8388` TCP 端口。

运行后台测试：

```bash
cd admin
npm test
```

## 安全注意事项

- `SS_PASSWORD` 使用长随机密码。
- `ADMIN_PASSWORD` 使用另一段长随机密码，不要和 `SS_PASSWORD` 相同。
- 不要公开 TCP Proxy 地址、端口和密码。
- 不要公开 `SS_MANAGER_PORT`。
- 不要部署没有认证的 HTTP 或 SOCKS 代理。
- 如果节点信息泄露，立刻更换 `SS_PASSWORD` 并重新部署。

## Railway 限制

- Railway TCP Proxy 处理 TCP；这个模板按 TCP Shadowsocks 节点设计。
- Railway 不会把 UDP 暴露给客户端，所以客户端里 UDP 请关闭。
- Railway Static Outbound IPs 需要付费计划。
- Railway 可能提供多个出口 IP。目标网站做白名单时，需要把它列出的所有出口 IP 都加进去。
- Railway Static Outbound IPs 是出站 IP，不是客户端连入地址。客户端要连接的是 TCP Proxy 的 host 和 port。
