# Railway Shadowsocks-Rust Node

This template deploys a private Shadowsocks server on Railway. ClashX can use it as an encrypted proxy node, and Railway Static Outbound IPs can make the target website see Railway's outbound IPs.

## What This Does

```text
Browser
  -> ClashX rule routing
  -> Railway TCP Proxy
  -> shadowsocks-rust in Railway
  -> target website
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

8. If you need a fixed outbound IP, enable Static Outbound IPs for the Railway service and add all listed outbound IPs to the target website's allowlist.

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

## Security Notes

- Use a long random `SS_PASSWORD`.
- Do not share the TCP proxy host, port, and password.
- Do not deploy an unauthenticated HTTP or SOCKS proxy.
- Rotate `SS_PASSWORD` if the node details are exposed.

## Known Railway Limits

- Railway TCP Proxy handles TCP. This template is intended for TCP traffic, and UDP is not exposed through Railway.
- Railway Static Outbound IPs require a paid plan.
- Railway may provide multiple outbound IPs for high availability. Add all of them to the target allowlist.
- Railway static outbound IPs are for outbound traffic, not for connecting into the service. ClashX connects to the TCP proxy host and port.
