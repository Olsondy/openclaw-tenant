import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss(), svelte()],
  build: { outDir: "dist" },
  server: {
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
  resolve: {
    conditions: ["browser", "module", "import", "default"],
  },
  optimizeDeps: {
    exclude: ["svelte"],
  },
});
