import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hashSubscriptionToken, openStore } from "../src/store.ts";

test("records traffic deltas and handles counter resets", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ss-admin-store-"));
  const store = openStore(dir);
  const base = Date.now() - 1000;

  store.recordSample({ ports: { "8388": 100 }, totalBytes: 100 }, base);
  store.recordSample({ ports: { "8388": 150 }, totalBytes: 150 }, base + 100);
  store.recordSample({ ports: { "8388": 20 }, totalBytes: 20 }, base + 200);

  const summary = store.getTraffic("1h");
  assert.equal(summary.totalBytes, 70);
  assert.equal(store.getRecordedTotalBytes(), 70);

  store.close();
});

test("manages users, subscription tokens, and access logs", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ss-admin-store-"));
  const store = openStore(dir);

  const created = store.createUser({
    name: "Alice",
    note: "test user",
    quotaBytes: 1024,
    quotaPeriod: "monthly"
  });
  assert.equal(created.user.name, "Alice");
  assert.equal(created.user.status, "active");
  assert.equal(created.user.quotaBytes, 1024);

  const found = store.findSubscriptionByTokenHash(hashSubscriptionToken(created.token));
  assert.equal(found?.user.id, created.user.id);
  assert.equal(found?.tokenRecord.revoked, false);

  store.recordSubscriptionAccess(created.user.id, created.tokenRecord.id, {
    format: "clash",
    ip: "203.0.113.10",
    userAgent: "test-client"
  });

  const detail = store.getUserDetail(created.user.id);
  assert.equal(detail?.accessLogs.length, 1);
  assert.equal(detail?.accessLogs[0].format, "clash");

  const reset = store.resetSubscriptionToken(created.user.id);
  assert.ok(reset);
  const oldToken = store.findSubscriptionByTokenHash(hashSubscriptionToken(created.token));
  assert.equal(oldToken?.tokenRecord.revoked, true);

  const disabled = store.setUserStatus(created.user.id, "disabled");
  assert.equal(disabled?.status, "disabled");

  store.close();
});

test("manages nodes, user assignments, agent sync, and quota enforcement", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ss-admin-store-"));
  const store = openStore(dir);

  const createdNode = store.createNode({
    name: "Hong Kong 1",
    publicHost: "hk.example.com",
    publicPortStart: 20000,
    publicPortEnd: 20002,
    ssMethod: "aes-256-gcm"
  });
  assert.ok(createdNode.token);

  const createdUser = store.createUser({
    name: "Bob",
    nodeIds: [createdNode.node.id],
    quotaBytes: 50,
    quotaPeriod: "daily"
  });
  const assignments = store.getUserNodeAssignments(createdUser.user.id);
  assert.equal(assignments.length, 1);
  assert.equal(assignments[0].serverPort, 20000);

  const firstSync = store.syncNodeAgent(createdNode.node.id, createdNode.token, {
    load: { activeServers: 0, managerOnline: true },
    traffic: {}
  });
  assert.equal(firstSync?.assignments.length, 1);
  assert.equal(firstSync?.assignments[0].serverPort, 20000);

  store.syncNodeAgent(createdNode.node.id, createdNode.token, {
    load: { activeServers: 1, managerOnline: true },
    traffic: { ports: { "20000": 10 } }
  });
  store.syncNodeAgent(createdNode.node.id, createdNode.token, {
    load: { activeServers: 1, managerOnline: true },
    traffic: { ports: { "20000": 80 } }
  });

  const detail = store.getUserDetail(createdUser.user.id);
  assert.equal(detail?.user.status, "over_quota");
  assert.equal(store.getTrafficByUser(createdUser.user.id, "24h").totalBytes, 70);

  const afterQuota = store.syncNodeAgent(createdNode.node.id, createdNode.token, {
    load: { activeServers: 1, managerOnline: true },
    traffic: { ports: { "20000": 80 } }
  });
  assert.equal(afterQuota?.assignments.length, 0);

  const disabledNode = store.updateNode(createdNode.node.id, { status: "disabled" });
  assert.equal(disabledNode?.status, "disabled");
  assert.equal(store.listNodes()[0].assignedUserCount, 1);

  store.close();
});
