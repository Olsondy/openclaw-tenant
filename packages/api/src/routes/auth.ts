import { Hono } from "hono";
import { sign } from "hono/jwt";
import bcrypt from "bcryptjs";
import { getDb } from "../db/client";

const auth = new Hono();

auth.post("/login", async (c) => {
  let body: { username?: string; password?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: "INVALID_JSON" }, 400);
  }
  const { username, password } = body;

  if (!username || !password) {
    return c.json({ success: false, error: "MISSING_CREDENTIALS" }, 400);
  }

  const db = getDb();
  const user = db
    .query<{ id: number; password_hash: string }, string>(
      "SELECT id, password_hash FROM admin_users WHERE username = ?"
    )
    .get(username);

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return c.json({ success: false, error: "INVALID_CREDENTIALS" }, 401);
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    return c.json({ success: false, error: "SERVER_MISCONFIGURATION" }, 500);
  }
  const token = await sign(
    { sub: String(user.id), username, exp: Math.floor(Date.now() / 1000) + 86400 },
    secret
  );

  return c.json({ success: true, data: { token } });
});

export default auth;
