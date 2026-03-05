export default {
  "*.{js,ts,json}": "biome check --write --no-errors-on-unmatched",
  "packages/ui/**/*.{svelte,ts,js}": () => "bun run --cwd packages/ui check",
};
