<script lang="ts">
import { isLoggedIn } from "./lib/api";
import LicenseList from "./lib/LicenseList.svelte";
import Login from "./lib/Login.svelte";

let loggedIn = $state(isLoggedIn());
</script>

{#if loggedIn}
  <LicenseList
    onLogout={() => {
      loggedIn = false
    }}
  />
{:else}
  <Login
    onLogin={() => {
      loggedIn = true
    }}
  />
{/if}
