import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openStore } from "../src/store.ts";

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
