import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { cors } from "hono/cors";
import { getDb } from "./db/client";
import { jwtMiddleware } from "./middleware/jwt";
import authRoutes from "./routes/auth";
import licensesRoutes from "./routes/licenses";
import verifyRoutes from "./routes/verify";
import { resumePendingProvisioning } from "./services/provisioning/licenseProvisioningService";

getDb(); // Initialize DB and run migrations on startup
resumePendingProvisioning(); // Resume any interrupted provisioning jobs

const app = new Hono();

app.use("*", cors());

// Public routes
app.route("/api/auth", authRoutes);
app.route("/api/verify", verifyRoutes);

// Protected routes
app.use("/api/licenses/*", jwtMiddleware);
app.route("/api/licenses", licensesRoutes);

// Serve static UI (built Svelte)
const uiDist = process.env.UI_DIST_PATH ?? "../ui/dist";
app.use("/*", serveStatic({ root: uiDist }));
app.get("*", serveStatic({ path: `${uiDist}/index.html` }));

const port = Number(process.env.PORT ?? 3000);
console.log(`🚀 OpenClaw Auth running on http://localhost:${port}`);

export default { port, fetch: app.fetch };
