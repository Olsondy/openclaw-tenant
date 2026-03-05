import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { sign } from "hono/jwt";
import { jwtMiddleware } from "./jwt";

async function makeToken(secret = "test-secret") {
  return sign({ sub: "1", exp: Math.floor(Date.now() / 1000) + 3600 }, secret);
}

describe("jwtMiddleware", () => {
  const app = new Hono();
  app.use("/protected/*", jwtMiddleware);
  app.get("/protected/data", (c) => c.json({ ok: true }));

  test("rejects request with no Authorization header", async () => {
    process.env.JWT_SECRET = "test-secret";
    const res = await app.request("/protected/data");
    expect(res.status).toBe(401);
  });

  test("rejects invalid token", async () => {
    process.env.JWT_SECRET = "test-secret";
    const res = await app.request("/protected/data", {
      headers: { Authorization: "Bearer invalid.token.here" },
    });
    expect(res.status).toBe(401);
  });

  test("allows valid token", async () => {
    process.env.JWT_SECRET = "test-secret";
    const token = await makeToken("test-secret");
    const res = await app.request("/protected/data", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });
});
