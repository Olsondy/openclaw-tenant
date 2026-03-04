<script lang="ts">
  import { api, saveToken } from "./api";

  let { onLogin }: { onLogin: () => void } = $props();

  let username = $state("");
  let password = $state("");
  let error = $state("");
  let loading = $state(false);

  async function handleSubmit(e: Event) {
    e.preventDefault();
    error = "";
    loading = true;
    try {
      const res = await api.login(username, password);
      saveToken(res.data.token);
      onLogin();
    } catch (err) {
      error = err instanceof Error ? err.message : "登录失败";
    } finally {
      loading = false;
    }
  }
</script>

<div class="min-h-screen bg-[#f8f9fa] flex items-center justify-center">
  <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 w-full max-w-sm">
    <!-- Logo -->
    <div class="text-center mb-8">
      <div class="w-12 h-12 bg-[#1a73e8] rounded-full flex items-center justify-center mx-auto mb-4">
        <svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
            d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
      </div>
      <h1 class="text-2xl font-medium text-gray-900">OpenClaw Auth</h1>
      <p class="text-sm text-gray-500 mt-1">管理员登录</p>
    </div>

    <form onsubmit={handleSubmit} class="space-y-4">
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">用户名</label>
        <input
          type="text"
          bind:value={username}
          placeholder="admin"
          required
          class="w-full rounded-lg border-gray-300 focus:border-[#1a73e8] focus:ring-[#1a73e8] text-sm"
        />
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">密码</label>
        <input
          type="password"
          bind:value={password}
          required
          class="w-full rounded-lg border-gray-300 focus:border-[#1a73e8] focus:ring-[#1a73e8] text-sm"
        />
      </div>

      {#if error}
        <p class="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
      {/if}

      <button
        type="submit"
        disabled={loading}
        class="w-full bg-[#1a73e8] hover:bg-[#1557b0] disabled:bg-blue-300 text-white font-medium py-2.5 rounded-lg transition-colors text-sm mt-2"
      >
        {loading ? "登录中..." : "登录"}
      </button>
    </form>
  </div>
</div>
