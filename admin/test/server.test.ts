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

test("creates per-user subscription URLs and gates disabled users", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ss-admin-server-"));
  const config = readConfig({
    ADMIN_PASSWORD: "secret",
    DATA_DIR: dir,
    PUBLIC_SS_HOST: "tcp.example.com",
    PUBLIC_SS_PORT: "12345",
    SS_METHOD: "aes-256-gcm",
    SS_PASSWORD: "server-secret"
  });
  const store = openStore(dir);
  const server = createAdminServer(config, store);
  const baseUrl = await listen(server);

  try {
    const publicResponse = await fetch(`${baseUrl}/api/public-client-config`);
    assert.equal(publicResponse.status, 200);
    assert.doesNotMatch(await publicResponse.text(), /server-secret/);

    const loginResponse = await fetch(`${baseUrl}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "secret" })
    });
    assert.equal(loginResponse.status, 200);
    const cookie = loginResponse.headers.get("set-cookie")?.split(";")[0] || "";
    assert.ok(cookie);

    const createResponse = await fetch(`${baseUrl}/api/users`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie
      },
      body: JSON.stringify({ name: "Alice" })
    });
    assert.equal(createResponse.status, 201);
    const created = await createResponse.json();
    assert.match(created.subscription.clashUrl, /\/sub\/.+\/clash\.yaml$/);
    assert.match(created.subscription.ssUrl, /\/sub\/.+\/ss\.txt$/);

    const clashResponse = await fetch(created.subscription.clashUrl);
    assert.equal(clashResponse.status, 200);
    const clash = await clashResponse.text();
    assert.match(clash, /railway-user-Alice/);
    assert.match(clash, /password: server-secret/);

    const ssResponse = await fetch(created.subscription.ssUrl);
    assert.equal(ssResponse.status, 200);
    const ssText = Buffer.from(await ssResponse.text(), "base64").toString("utf8");
    assert.match(ssText, /^ss:\/\//);
    assert.match(ssText, /@tcp\.example\.com:12345#railway-user-Alice/);

    const detailResponse = await fetch(`${baseUrl}/api/users/${encodeURIComponent(created.user.id)}`, {
      headers: { Cookie: cookie }
    });
    assert.equal(detailResponse.status, 200);
    const detail = await detailResponse.json();
    assert.equal(detail.accessLogs.length, 2);
    assert.equal(detail.subscription.clashUrl, created.subscription.clashUrl);
    assert.equal(detail.subscription.ssUrl, created.subscription.ssUrl);
    assert.equal(detail.trafficMode.perUserReliable, false);

    const disableResponse = await fetch(`${baseUrl}/api/users/${encodeURIComponent(created.user.id)}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie
      },
      body: JSON.stringify({ status: "disabled" })
    });
    assert.equal(disableResponse.status, 200);

    const disabledClashResponse = await fetch(created.subscription.clashUrl);
    assert.equal(disabledClashResponse.status, 403);
  } finally {
    await close(server);
    store.close();
  }
});

test("creates nodes, assigns users, and serves multi-node subscriptions", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ss-admin-server-"));
  const config = readConfig({
    ADMIN_PASSWORD: "secret",
    DATA_DIR: dir,
    PUBLIC_SS_HOST: "legacy.example.com",
    PUBLIC_SS_PORT: "12345",
    SS_METHOD: "aes-256-gcm",
    SS_PASSWORD: "legacy-secret"
  });
  const store = openStore(dir);
  const server = createAdminServer(config, store);
  const baseUrl = await listen(server);

  try {
    const loginResponse = await fetch(`${baseUrl}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "secret" })
    });
    const cookie = loginResponse.headers.get("set-cookie")?.split(";")[0] || "";
    assert.ok(cookie);

    const nodeResponse = await fetch(`${baseUrl}/api/nodes`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie
      },
      body: JSON.stringify({
        name: "HK 1",
        publicHost: "hk.example.com",
        publicPortStart: 20000,
        publicPortEnd: 20002,
        ssMethod: "chacha20-ietf-poly1305"
      })
    });
    assert.equal(nodeResponse.status, 201);
    const createdNode = await nodeResponse.json();
    assert.ok(createdNode.token);

    const createUserResponse = await fetch(`${baseUrl}/api/users`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie
      },
      body: JSON.stringify({ name: "Carol", nodeIds: [createdNode.node.id] })
    });
    assert.equal(createUserResponse.status, 201);
    const createdUser = await createUserResponse.json();

    const syncResponse = await fetch(`${baseUrl}/api/node-agent/sync`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${createdNode.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        nodeId: createdNode.node.id,
        traffic: {},
        load: { activeServers: 0, managerOnline: true }
      })
    });
    assert.equal(syncResponse.status, 200);
    const sync = await syncResponse.json();
    assert.equal(sync.assignments.length, 1);
    assert.equal(sync.assignments[0].serverPort, 20000);

    const clashResponse = await fetch(createdUser.subscription.clashUrl);
    assert.equal(clashResponse.status, 200);
    const clash = await clashResponse.text();
    assert.match(clash, /server: hk\.example\.com/);
    assert.match(clash, /port: 20000/);
    assert.match(clash, /cipher: chacha20-ietf-poly1305/);
    assert.doesNotMatch(clash, /legacy-secret/);
  } finally {
    await close(server);
    store.close();
  }
});
