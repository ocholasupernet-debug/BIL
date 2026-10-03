import assert from "node:assert/strict";
import test from "node:test";
import { resolveRouterIdByExactName, validateExpectedRouterName } from "../portal-refresh-target.mjs";

test("resolves the exact tenant router name rather than reusing a stale numeric ID", () => {
  const routers = [
    { id: 85, name: "come1" },
    { id: 112, name: "come3" },
    { id: 113, name: "Come3" },
  ];

  assert.equal(resolveRouterIdByExactName(routers, "come3"), 112);
});

test("fails closed when the exact tenant router name is absent or ambiguous", () => {
  assert.throws(
    () => resolveRouterIdByExactName([{ id: 85, name: "come1" }], "come3"),
    /No tenant router has the exact name come3/,
  );
  assert.throws(
    () => resolveRouterIdByExactName([{ id: 112, name: "come3" }, { id: 113, name: "come3" }], "come3"),
    /More than one tenant router has the exact name come3/,
  );
});

test("rejects router names that could alter the API path", () => {
  assert.throws(() => validateExpectedRouterName("../come3"), /exact valid stored name/);
});