<script lang="ts">
  import { api, clearToken, type License } from "./api";

  let { onLogout }: { onLogout: () => void } = $props();

  let licenses = $state<License[]>([]);
  let loading = $state(true);
  let generating = $state(false);
  let error = $state("");

  const STATUS = {
    unbound: { label: "未绑定", cls: "bg-gray-100 text-gray-600" },
    active:  { label: "已激活", cls: "bg-green-100 text-green-700" },
    revoked: { label: "已撤销", cls: "bg-red-100 text-red-600"   },
  } as const;

  async function load() {
    try {
      const res = await api.getLicenses();
      licenses = res.data;
    } catch (e) {
      error = e instanceof Error ? e.message : "加载失败";
    } finally {
      loading = false;
    }
  }

  async function generate() {
    generating = true;
    try {
      const res = await api.generateLicense();
      licenses = [res.data, ...licenses];
    } catch (e) {
      error = e instanceof Error ? e.message : "生成失败";
    } finally {
      generating = false;
    }
  }

  async function revoke(license: License) {
    if (!confirm(`确认撤销 ${license.license_key}？此操作不可恢复。`)) return;
    try {
      await api.revokeLicense(license.id);
      licenses = licenses.map((l) =>
        l.id === license.id ? { ...l, status: "revoked" as const } : l
      );
    } catch (e) {
      error = e instanceof Error ? e.message : "撤销失败";
    }
  }

  function logout() {
    clearToken();
    onLogout();
  }

  $effect(() => { load(); });
</script>

<div class="min-h-screen bg-[#f8f9fa]">
  <!-- Top nav -->
  <nav class="bg-[#1a73e8] shadow">
    <div class="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
      <div class="flex items-center gap-2">
        <svg class="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 20 20">
          <path fill-rule="evenodd" d="M18 8a6 6 0 01-7.743 5.743L10 14l-1 1-1 1H6v2H2v-4l4.257-4.257A6 6 0 1118 8zm-6-4a1 1 0 100 2 2 2 0 012 2 1 1 0 102 0 4 4 0 00-4-4z" clip-rule="evenodd" />
        </svg>
        <span class="text-white font-medium text-sm">OpenClaw Auth Manager</span>
      </div>
      <button
        onclick={logout}
        class="text-blue-100 hover:text-white text-sm transition-colors"
      >登出</button>
    </div>
  </nav>

  <!-- Main -->
  <main class="max-w-7xl mx-auto px-6 py-6">
    {#if error}
      <div class="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 flex justify-between">
        {error}
        <button onclick={() => error = ""} class="text-red-400 hover:text-red-600">✕</button>
      </div>
    {/if}

    <div class="bg-white rounded-xl shadow-sm border border-gray-100">
      <!-- Card header -->
      <div class="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
        <h2 class="text-sm font-medium text-gray-900">License 管理</h2>
        <button
          onclick={generate}
          disabled={generating}
          class="bg-[#1a73e8] hover:bg-[#1557b0] disabled:bg-blue-300 text-white text-xs font-medium px-4 py-2 rounded-lg transition-colors flex items-center gap-1.5"
        >
          {#if generating}
            <span class="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
          {:else}
            <span class="text-base leading-none">+</span>
          {/if}
          生成 License
        </button>
      </div>

      <!-- Table -->
      {#if loading}
        <div class="py-20 text-center text-gray-400 text-sm">加载中...</div>
      {:else if licenses.length === 0}
        <div class="py-20 text-center text-gray-400 text-sm">
          暂无 License，点击右上角按钮生成第一个
        </div>
      {:else}
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-gray-100">
                {#each ["License Key", "状态", "设备名", "HWID", "到期日", "创建时间", "操作"] as col}
                  <th class="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide whitespace-nowrap">
                    {col}
                  </th>
                {/each}
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-50">
              {#each licenses as license (license.id)}
                <tr class="hover:bg-gray-50 transition-colors">
                  <td class="px-6 py-4 font-mono text-xs text-gray-800 whitespace-nowrap">
                    {license.license_key}
                  </td>
                  <td class="px-6 py-4">
                    <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium {STATUS[license.status].cls}">
                      {STATUS[license.status].label}
                    </span>
                  </td>
                  <td class="px-6 py-4 text-gray-600">{license.device_name ?? "—"}</td>
                  <td class="px-6 py-4 font-mono text-xs text-gray-400">
                    {license.hwid ? license.hwid.slice(0, 12) + "…" : "—"}
                  </td>
                  <td class="px-6 py-4 text-gray-600">{license.expiry_date ?? "永久"}</td>
                  <td class="px-6 py-4 text-gray-400 text-xs whitespace-nowrap">
                    {license.created_at.slice(0, 10)}
                  </td>
                  <td class="px-6 py-4">
                    {#if license.status !== "revoked"}
                      <button
                        onclick={() => revoke(license)}
                        class="text-red-500 hover:text-red-700 text-xs font-medium transition-colors"
                      >撤销</button>
                    {:else}
                      <span class="text-gray-300 text-xs">—</span>
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </div>
  </main>
</div>
