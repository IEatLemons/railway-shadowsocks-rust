import test from "node:test";
import assert from "node:assert/strict";
import {
  buildStandaloneClashYaml,
  buildUserClashYaml,
  buildUserSsSubscription,
  mergeClashConfig,
  normalizeFixedIpDomains
} from "../src/clientConfig.ts";
import { readConfig } from "../src/config.ts";

function testConfig() {
  return readConfig({
    ADMIN_PASSWORD: "secret",
    PUBLIC_SS_HOST: "tcp.example.com",
    PUBLIC_SS_PORT: "12345",
    SS_METHOD: "chacha20-ietf-poly1305",
    SS_PASSWORD: "server-secret"
  });
}

test("builds standalone clash config for the railway node", () => {
  assert.equal(
    buildStandaloneClashYaml(testConfig(), ["example.com"]),
    [
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
    ].join("\n")
  );
});

test("merges railway node into an existing clash config", () => {
  const baseConfig = [
    "mixed-port: 7890",
    "allow-lan: false",
    "",
    "proxies:",
    "  - { name: airport-a, type: ss, server: a.example.com, port: 443, cipher: aes-128-gcm, password: pass }",
    "  - name: railway-fixed-ip",
    "    type: ss",
    "    server: old-railway.example.com",
    "    port: 11111",
    "",
    "proxy-groups:",
    "  - name: Proxy",
    "    type: select",
    "    proxies:",
    "      - airport-a",
    "  - name: FixedIP",
    "    type: select",
    "    proxies:",
    "      - old-railway",
    "",
    "rules:",
    "  - DOMAIN-SUFFIX,old.example.com,Proxy",
    "  - MATCH,Proxy"
  ].join("\n");

  const merged = mergeClashConfig(baseConfig, testConfig(), {
    fixedIpDomains: "example.com, api.example.com"
  });
  const output = merged.clashYaml;

  assert.match(output, /name: airport-a/);
  assert.match(output, /name: railway-fixed-ip/);
  assert.match(output, /server: tcp\.example\.com/);
  assert.doesNotMatch(output, /old-railway\.example\.com/);
  assert.equal(output.match(/name: railway-fixed-ip/g)?.length, 1);
  assert.equal(output.match(/name: FixedIP/g)?.length, 1);
  assert.ok(output.indexOf("  - DOMAIN-SUFFIX,example.com,FixedIP") < output.indexOf("  - MATCH,Proxy"));
  assert.ok(output.indexOf("  - DOMAIN-SUFFIX,api.example.com,FixedIP") < output.indexOf("  - MATCH,Proxy"));
});

test("normalizes fixed ip domain input", () => {
  assert.deepEqual(
    normalizeFixedIpDomains("DOMAIN-SUFFIX,Example.COM\nhttps://api.example.com/path\nbad value"),
    ["example.com", "api.example.com"]
  );
});

test("builds per-user subscription payloads with the real server password", () => {
  const user = { id: "user-1", name: "Alice Zhang" };
  const clash = buildUserClashYaml(testConfig(), user);
  const ssSubscription = buildUserSsSubscription(testConfig(), user);
  const ssUri = Buffer.from(ssSubscription, "base64").toString("utf8");

  assert.match(clash, /name: railway-user-Alice-Zhang/);
  assert.match(clash, /password: server-secret/);
  assert.doesNotMatch(clash, /YOUR_SS_PASSWORD/);
  assert.match(ssUri, /^ss:\/\//);
  assert.match(ssUri, /@tcp\.example\.com:12345#railway-user-Alice-Zhang/);
});
