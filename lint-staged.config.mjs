export default {
  "*.{js,ts,json}": "biome check --write --no-errors-on-unmatched",
  "packages/ui/**/*.{svelte,ts,js}": "svelte-check --workspace packages/ui --diagnostic-sources ts,svelte --fail-on-warnings false",
};
