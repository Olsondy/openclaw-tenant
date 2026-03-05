import { beforeEach, describe, expect, test } from "bun:test";
import { getDb, resetDb } from "../../db/client";
import { allocatePortPair } from "./portAllocator";

beforeEach(() => {
  resetDb();
  process.env.DB_PATH = ":memory:";
  process.env.ADMIN_USER = "admin";
  process.env.ADMIN_PASS = "x";
});

describe("allocatePortPair", () => {
  test("returns first available port pair", () => {
    const db = getDb();
    const pair = allocatePortPair(db, 18789, 18799, 28789, 28799);
    expect(pair.gatewayPort).toBe(18789);
    expect(pair.bridgePort).toBe(28789);
  });

  test("skips already used ports", () => {
    const db = getDb();
    db.run(
      `INSERT INTO licenses (license_key, gateway_token, gateway_url, gateway_port, bridge_port)
       VALUES ('K1', 't', 'ws://x', 18789, 28789)`,
    );
    const pair = allocatePortPair(db, 18789, 18799, 28789, 28799);
    expect(pair.gatewayPort).toBe(18790);
    expect(pair.bridgePort).toBe(28790);
  });

  test("throws NO_AVAILABLE_PORT when pool exhausted", () => {
    const db = getDb();
    db.run(
      `INSERT INTO licenses (license_key, gateway_token, gateway_url, gateway_port, bridge_port)
       VALUES ('K1', 't', 'ws://x', 18789, 28789)`,
    );
    expect(() => allocatePortPair(db, 18789, 18789, 28789, 28789)).toThrow("NO_AVAILABLE_PORT");
  });
});
