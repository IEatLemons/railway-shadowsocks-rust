import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { readConfig } from "../src/config.ts";
import { createAdminServer } from "../src/server.ts";
import { openStore } from "../src/store.ts";

async function listen(server: http.Server): Promise<string> {
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

test("serves public usage config without an admin session", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ss-admin-server-"));
  const config = readConfig({
    ADMIN_PASSWORD: "secret",
    DATA_DIR: dir,
    PUBLIC_SS_HOST: "tcp.example.com",
    PUBLIC_SS_PORT: "12345",
    SS_METHOD: "chacha20-ietf-poly1305"
  });
  const store = openStore(dir);
  const server = createAdminServer(config, store);
  const baseUrl = await listen(server);

  try {
    const guideResponse = await fetch(`${baseUrl}/guide`);
    assert.equal(guideResponse.status, 200);
    assert.match(await guideResponse.text(), /Shadowsocks 使用说明/);

    const publicResponse = await fetch(`${baseUrl}/api/public-client-config`);
    assert.equal(publicResponse.status, 200);
    assert.deepEqual(await publicResponse.json(), {
      clashYaml: [
        "proxies:",
        "  - name: railway-fixed-ip",
        "    type: ss",
        "    server: tcp.example.com",
        "    port: 12345",
        "    cipher: chacha20-ietf-poly1305",
        "    password: YOUR_SS_PASSWORD",
        "    udp: false",
        "",
        "proxy-groups:",
        "  - name: FixedIP",
        "    type: select",
        "    proxies:",
        "      - railway-fixed-ip",
        "      - DIRECT",
        "",
        "rules:",
        "  - DOMAIN-SUFFIX,example.com,FixedIP",
        "  - MATCH,DIRECT"
      ].join("\n"),
      method: "chacha20-ietf-poly1305",
      publicHost: "tcp.example.com",
      publicPort: "12345",
      ssPort: 8388
    });

    const privateResponse = await fetch(`${baseUrl}/api/client-config`);
    assert.equal(privateResponse.status, 401);
  } finally {
    await close(server);
    store.close();
  }
});
