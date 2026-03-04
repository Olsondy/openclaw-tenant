import { describe, test, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { resetDb } from "../db/client";
import authRoutes from "./auth";

const app = new Hono();
app.route("/auth", authRoutes);

beforeEach(() => {
  resetDb();
  process.env.DB_PATH = ":memory:";
  process.env.ADMIN_USER = "admin";
  process.env.ADMIN_PASS = "secret123";
  process.env.JWT_SECRET = "test-jwt-secret";
});

describe("POST /auth/login", () => {
  test("returns 400 when fields missing", async () => {
    const res = await app.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  test("returns 401 for wrong password", async () => {
    const res = await app.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "wrong" }),
    });
    expect(res.status).toBe(401);
  });

  test("returns token for correct credentials", async () => {
    const res = await app.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "secret123" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; data: { token: string } };
    expect(body.success).toBe(true);
    expect(typeof body.data.token).toBe("string");
  });
});
