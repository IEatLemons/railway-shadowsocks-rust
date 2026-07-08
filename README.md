# Railway Shadowsocks-Rust Node

This template deploys a private Shadowsocks server on Railway. ClashX can use it as an encrypted proxy node, and Railway Static Outbound IPs can make the target website see Railway's outbound IPs.

## What This Does

```text
Browser
  -> ClashX rule routing
  -> Railway TCP Proxy
  -> shadowsocks-rust manager in Railway
  -> target website

Admin browser
  -> Railway HTTP service
  -> Railway Private Networking
  -> shadowsocks-rust manager UDP API
```

This is not a full VPN. It is a TCP Shadowsocks proxy intended for browser or app traffic that ClashX routes by domain.

## Railway Setup

1. Create a new GitHub repository with these files.
2. Create a Railway project from that repository.
3. In the Railway service variables, add:

```text
SS_PASSWORD=<use-a-long-random-password>
SS_METHOD=aes-256-gcm
SS_PORT=8388
SS_TIMEOUT=300
SS_MANAGER_PORT=6100
```

Only `SS_PASSWORD` is required. The other variables have defaults.
Use a base64-style random password, for example one generated with:

```bash
openssl rand -base64 32
```

4. Deploy the service.
5. Open the service networking settings.
6. Add a TCP Proxy for internal port `8388`.
7. Copy the generated TCP proxy host and port, such as:

```text
something.proxy.rlwy.net:12345
```

8. Do not add a public TCP Proxy for `6100`. The manager port is UDP and should only be reached through Railway Private Networking.
9. If you need a fixed outbound IP, enable Static Outbound IPs for the Railway service and add all listed outbound IPs to the target website's allowlist.

## Admin Dashboard Setup

This repository also includes a standalone admin service in `admin/`. Deploy it as a second Railway service in the same project or environment.

1. Create a new Railway service from the same GitHub repository.
2. Set the service root directory to `admin`.
3. Add these service variables:

```text
ADMIN_USERNAME=admin
ADMIN_PASSWORD=<use-a-different-long-random-password>
SS_MANAGER_HOST=<your-shadowsocks-service-name>.railway.internal
SS_MANAGER_PORT=6100
PUBLIC_SS_HOST=<your Railway TCP proxy host>
PUBLIC_SS_PORT=<your Railway TCP proxy port>
SS_METHOD=aes-256-gcm
SS_PORT=8388
SS_TIMEOUT=300
DATA_DIR=/data
```

4. Add a Railway volume mounted at `/data` if you want traffic history and events to survive restarts.
5. Enable a public HTTP domain for the admin service.
6. Log in with `ADMIN_USERNAME` and `ADMIN_PASSWORD`.

The admin service stores traffic samples in SQLite at `${DATA_DIR}/admin.sqlite`. It never returns `SS_PASSWORD` through the web UI or API. If you want the dashboard to show that the Shadowsocks password is configured, set `SS_PASSWORD_CONFIGURED=true` on the admin service.

### Admin API

The dashboard uses these authenticated API endpoints:

```text
POST /api/login
POST /api/logout
GET /api/me
GET /api/status
GET /api/traffic?range=1h|24h|7d
GET /api/client-config
GET /api/events
```

`/healthz` is unauthenticated for Railway health checks.

## ClashX Config

Copy `clashx-example.yaml` into your ClashX profile and replace:

```text
YOUR_RAILWAY_TCP_PROXY_HOST
YOUR_RAILWAY_TCP_PROXY_PORT
YOUR_SS_PASSWORD
```

Example:

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

Then add the target domains:

```yaml
rules:
  - DOMAIN-SUFFIX,example.com,railway-fixed-ip
  - DOMAIN,login.example.com,railway-fixed-ip
  - MATCH,DIRECT
```

If your profile uses a proxy group, route those domains to the group instead:

```yaml
rules:
  - DOMAIN-SUFFIX,example.com,FixedIP
  - MATCH,DIRECT
```

## Testing

After ClashX is connected:

1. Open a site that shows your public IP.
2. Temporarily route that site's domain to `railway-fixed-ip`.
3. Confirm the shown IP is one of Railway's static outbound IPs.
4. Test the actual target website.

For the admin service locally:

```bash
cd admin
ADMIN_PASSWORD=local-dev-password DATA_DIR=/tmp/ss-admin npm start
```

Then open `http://127.0.0.1:3000`. Without a local `ssmanager` listening on UDP `6100`, the dashboard should show the node as offline and report the timeout reason.

Run the admin tests with:

```bash
cd admin
npm test
```

## Security Notes

- Use a long random `SS_PASSWORD`.
- Use a separate long random `ADMIN_PASSWORD`.
- Do not share the TCP proxy host, port, and password.
- Do not expose `SS_MANAGER_PORT` publicly.
- Do not deploy an unauthenticated HTTP or SOCKS proxy.
- Rotate `SS_PASSWORD` if the node details are exposed.

## Known Railway Limits

- Railway TCP Proxy handles TCP. This template is intended for TCP traffic, and UDP is not exposed through Railway.
- Railway Static Outbound IPs require a paid plan.
- Railway may provide multiple outbound IPs for high availability. Add all of them to the target allowlist.
- Railway static outbound IPs are for outbound traffic, not for connecting into the service. ClashX connects to the TCP proxy host and port.
