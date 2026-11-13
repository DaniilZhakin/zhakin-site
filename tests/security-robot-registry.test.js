import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const registry = JSON.parse(await readFile(new URL("../data/security-robot-registry.json", import.meta.url), "utf8"));

test("registry remains non-production and recommendation-only", () => {
  assert.equal(registry.status, "design_only");
  assert.equal(registry.production_connected, false);
  assert.equal(registry.automatic_actions_enabled, false);
  assert.equal(registry.operating_mode, "observe_and_recommend");
  assert.equal(registry.human_approval_required_for_consequential_actions, true);
});

test("robot identifiers and names are unique", () => {
  const ids = registry.robots.map((item) => item.id);
  const names = registry.robots.map((item) => item.name);
  assert.ok(ids.length > 0);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(new Set(names).size, names.length);
});

test("every robot declares permissions and forbidden actions", () => {
  for (const robot of registry.robots) {
    assert.ok(robot.id, "robot id is required");
    assert.ok(robot.name, "robot name is required");
    assert.ok(robot.role, "robot role is required");
    assert.ok(Array.isArray(robot.permissions) && robot.permissions.length > 0, `${robot.id} must declare permissions`);
    assert.ok(Array.isArray(robot.forbidden_actions) && robot.forbidden_actions.length > 0, `${robot.id} must declare forbidden actions`);
  }
});

test("coordinator has restricted permissions and cannot override approval", () => {
  const leader = registry.robots.find((item) => item.id === registry.coordinator_id);
  assert.ok(leader);
  assert.equal(leader.role, "coordinator");
  assert.ok(leader.forbidden_actions.includes("execute_mutations"));
  assert.ok(leader.forbidden_actions.includes("override_human_approval"));
});

test("wallet and exchange robots cannot perform financial operations", () => {
  const wallet = registry.robots.find((item) => item.id === "wallet-shield");
  const exchange = registry.robots.find((item) => item.id === "exchange-guard");
  assert.ok(wallet);
  assert.ok(wallet.forbidden_actions.includes("change_balances"));
  assert.ok(wallet.forbidden_actions.includes("transfer_assets"));
  assert.ok(wallet.forbidden_actions.includes("trade"));
  assert.ok(exchange);
  assert.ok(exchange.forbidden_actions.includes("place_orders"));
  assert.ok(exchange.forbidden_actions.includes("use_trading_credentials"));
});

test("infrastructure and identity robots cannot make privileged changes", () => {
  const identity = registry.robots.find((item) => item.id === "identity-guard");
  const infrastructure = registry.robots.find((item) => item.id === "infrastructure-guard");
  const antiDdos = registry.robots.find((item) => item.id === "anti-ddos-guard");
  assert.ok(identity?.forbidden_actions.includes("change_roles"));
  assert.ok(identity?.forbidden_actions.includes("access_secrets"));
  assert.ok(infrastructure?.forbidden_actions.includes("change_dns"));
  assert.ok(infrastructure?.forbidden_actions.includes("modify_secrets"));
  assert.ok(antiDdos?.forbidden_actions.includes("change_waf"));
  assert.ok(antiDdos?.forbidden_actions.includes("block_ips"));
});
