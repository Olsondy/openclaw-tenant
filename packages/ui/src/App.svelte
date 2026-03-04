<script lang="ts">
  import { isLoggedIn } from "./lib/api";
  import Login from "./lib/Login.svelte";
  import LicenseList from "./lib/LicenseList.svelte";

  let loggedIn = $state(isLoggedIn());
</script>

{#if loggedIn}
  <LicenseList onLogout={() => (loggedIn = false)} />
{:else}
  <Login onLogin={() => (loggedIn = true)} />
{/if}
