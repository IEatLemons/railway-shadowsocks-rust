import test from "node:test";
import assert from "node:assert/strict";
import { includeCurrentServer, normalizeServers, normalizeStat, parseManagerResponse } from "../src/managerClient.ts";

test("parses stat responses from ssmanager", () => {
  const parsed = parseManagerResponse('stat: {"8388":11370}');
  assert.equal(parsed.type, "stat");
  assert.deepEqual(parsed.payload, { "8388": 11370 });
});

test("normalizes nested traffic counters", () => {
  const stat = normalizeStat({
    "8388": {
      tcp: {
        download: 10,
        upload: 20
      },
      udp: 5
    },
    "8389": 7
  });

  assert.deepEqual(stat.ports, {
    "8388": 35,
    "8389": 7
  });
  assert.equal(stat.totalBytes, 42);
});

test("normalizes server lists from array and object payloads", () => {
  assert.deepEqual(normalizeServers([8388]), [{ port: "8388", raw: 8388 }]);
  assert.deepEqual(normalizeServers({ "8388": { method: "aes-256-gcm" } }), [
    {
      method: "aes-256-gcm",
      port: "8388",
      raw: { method: "aes-256-gcm" }
    }
  ]);
});

test("includes the configured current server when ssmanager returns an empty list", () => {
  assert.deepEqual(includeCurrentServer([], { method: "aes-256-gcm", port: 8388 }), [
    {
      current: true,
      method: "aes-256-gcm",
      port: "8388",
      raw: {
        method: "aes-256-gcm",
        server_port: 8388,
        source: "configured"
      }
    }
  ]);
});

test("marks an existing configured server as current without duplicating it", () => {
  assert.deepEqual(
    includeCurrentServer([{ port: "8388", raw: 8388 }], { method: "chacha20-ietf-poly1305", port: 8388 }),
    [{ current: true, method: "chacha20-ietf-poly1305", port: "8388", raw: 8388 }]
  );
});
