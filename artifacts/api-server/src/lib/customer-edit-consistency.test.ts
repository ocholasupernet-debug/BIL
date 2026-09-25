import assert from "node:assert/strict";
import test from "node:test";
import { saveCustomerEditWithRouter } from "./customer-edit-consistency.js";

type Row = { plan: string };

function setup() {
  const events: string[] = [];
  const options = {
    applyRouter: async (markMutation: () => void) => {
      events.push("router");
      markMutation();
      return { routerSynced: true };
    },
    restoreRouter: async () => { events.push("restore"); },
    saveRecord: async (): Promise<Row> => { events.push("save"); return { plan: "new" }; },
    readRecord: async (): Promise<Row> => { events.push("read"); return { plan: "old" }; },
    matchesRequested: (row: Row) => row.plan === "new",
    matchesBefore: (row: Row) => row.plan === "old",
    confirmedRejected: () => true,
  };
  return { events, options };
}

test("saves only after applying router access", async () => {
  const { events, options } = setup();
  const result = await saveCustomerEditWithRouter(options);
  assert.equal(result.row.plan, "new");
  assert.equal(result.router.routerSynced, true);
  assert.deepEqual(events, ["router", "save"]);
});

test("does not write the database when router validation fails before mutation", async () => {
  const { events, options } = setup();
  options.applyRouter = async () => { events.push("router"); throw new Error("invalid plan"); };
  await assert.rejects(saveCustomerEditWithRouter(options), /edit was not saved.*invalid plan/);
  assert.deepEqual(events, ["router"]);
});

test("restores router access when a router operation partly succeeds then fails", async () => {
  const { events, options } = setup();
  options.applyRouter = async markMutation => {
    events.push("router");
    markMutation();
    throw new Error("expiry schedule failed");
  };
  await assert.rejects(saveCustomerEditWithRouter(options), /MikroTik was restored.*expiry schedule failed/);
  assert.deepEqual(events, ["router", "restore"]);
});

test("treats a failed database response as success when read-back confirms the edit", async () => {
  const { events, options } = setup();
  options.saveRecord = async () => { events.push("save"); throw new Error("response lost"); };
  options.readRecord = async () => { events.push("read"); return { plan: "new" }; };
  const result = await saveCustomerEditWithRouter(options);
  assert.equal(result.row.plan, "new");
  assert.deepEqual(events, ["router", "save", "read"]);
});

test("restores router access when the database still has the old record", async () => {
  const { events, options } = setup();
  options.saveRecord = async () => { events.push("save"); throw new Error("database rejected"); };
  await assert.rejects(saveCustomerEditWithRouter(options), /not saved and MikroTik was restored.*database rejected/);
  assert.deepEqual(events, ["router", "save", "read", "restore"]);
});

test("does not blindly roll back when the database outcome cannot be determined", async () => {
  const { events, options } = setup();
  options.saveRecord = async () => { events.push("save"); throw new Error("timeout"); };
  options.readRecord = async () => { events.push("read"); throw new Error("unavailable"); };
  await assert.rejects(saveCustomerEditWithRouter(options), /Administrator attention is required/);
  assert.deepEqual(events, ["router", "save", "read"]);
});

test("does not restore from an old read-back after an uncertain write timeout", async () => {
  const { events, options } = setup();
  options.saveRecord = async () => { events.push("save"); throw new Error("timeout"); };
  options.confirmedRejected = () => false;
  await assert.rejects(saveCustomerEditWithRouter(options), /could not be confirmed.*refresh this user/);
  assert.deepEqual(events, ["router", "save", "read"]);
});

test("reports an unsuccessful router rollback instead of claiming the edit was undone", async () => {
  const { events, options } = setup();
  options.saveRecord = async () => { events.push("save"); throw new Error("database rejected"); };
  options.restoreRouter = async () => { events.push("restore"); throw new Error("router offline"); };
  await assert.rejects(saveCustomerEditWithRouter(options), /MikroTik could not be restored.*router offline/);
  assert.deepEqual(events, ["router", "save", "read", "restore"]);
});