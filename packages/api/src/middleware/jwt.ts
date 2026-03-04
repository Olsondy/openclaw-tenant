import { createMiddleware } from "hono/factory";
import { verify } from "hono/jwt";

export const jwtMiddleware = createMiddleware(async (c, next) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ success: false, error: "UNAUTHORIZED" }, 401);
  }

  const token = authHeader.slice(7);
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    return c.json({ success: false, error: "SERVER_MISCONFIGURATION" }, 500);
  }

  try {
    const payload = await verify(token, secret, "HS256");
    c.set("jwtPayload", payload);
    await next();
  } catch {
    return c.json({ success: false, error: "INVALID_TOKEN" }, 401);
  }
});
