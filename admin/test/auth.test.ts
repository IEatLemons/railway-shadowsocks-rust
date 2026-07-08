import test from "node:test";
import assert from "node:assert/strict";
import { parseCookies, safeEqualString } from "../src/auth.ts";

test("parses cookie headers", () => {
  assert.deepEqual(parseCookies("a=1; ss_admin_session=hello%20there"), {
    a: "1",
    ss_admin_session: "hello there"
  });
});

test("compares strings through constant-length hashes", () => {
  assert.equal(safeEqualString("secret", "secret"), true);
  assert.equal(safeEqualString("secret", "other"), false);
});
