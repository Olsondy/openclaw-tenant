import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { cors } from "hono/cors";
import { getDb } from "./db/client";

import approveWebuiRoutes from "./routes/approve-webui";
import authRoutes from "./routes/auth";
import bootstrapConfigRoutes from "./routes/bootstrap-config";
import healthRoutes from "./routes/health";
import licensesRoutes from "./routes/licenses";
import modelPresetsRoutes from "./routes/model-presets";
import settingsRoutes from "./routes/settings";
import verifyRoutes from "./routes/verify";
import { resumePendingProvisioning } from "./services/provisioning/licenseProvisioningService";

getDb(); // Initialize DB and run migrations on startup
resumePendingProvisioning(); // Resume any interrupted provisioning jobs

const app = new Hono();

app.use("*", cors());

// exec 接口（无 JWT，由 licenseKey+hwid 双因子保护，Nginx 层限流）
app.route("/api/auth", authRoutes);
app.route("/api/verify", verifyRoutes);
app.route("/api/licenses", bootstrapConfigRoutes);
app.route("/api/licenses", approveWebuiRoutes);

// 页面接口（各路由文件内部自挂 jwtMiddleware）
app.route("/api/licenses", licensesRoutes);
app.route("/api/licenses/health", healthRoutes);
app.route("/api/settings", settingsRoutes);
app.route("/api/settings/model-presets", modelPresetsRoutes);

// Serve static UI (built Svelte)
const uiDist = process.env.UI_DIST_PATH ?? "../ui/dist";
app.use("/*", serveStatic({ root: uiDist }));
app.get("*", serveStatic({ path: `${uiDist}/index.html` }));

const port = Number(process.env.PORT ?? 3000);
console.log(`🚀 OpenClaw Auth running on http://localhost:${port}`);

export default { port, fetch: app.fetch };
