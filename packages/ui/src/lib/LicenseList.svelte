<script lang="ts">
import { api, clearToken, type License } from "./api";

interface Props {
  onLogout: () => void;
}
let { onLogout }: Props = $props();

let licenses = $state<License[]>([]);
let loading = $state(true);
let generating = $state(false);
let error = $state("");

// 弹窗状态
let showModal = $state(false);
// 表单字段
let formOwnerTag = $state("");
let formExpiryDate = $state(""); // 留空 = 永久
let formTokenTtlDays = $state(30);
let formHostIp = $state(""); // 留空 = 服务器默认
let formBaseDomain = $state(""); // 留空 = 使用 IP

const STATUS = {
  unbound: { label: "未绑定", cls: "bg-gray-100 text-gray-600" },
  active: { label: "已激活", cls: "bg-green-100 text-green-700" },
  revoked: { label: "已撤销", cls: "bg-red-100 text-red-600" },
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

function openModal() {
  formOwnerTag = "";
  formExpiryDate = "";
  formTokenTtlDays = 30;
  formHostIp = "";
  formBaseDomain = "";
  showModal = true;
}

async function generate() {
  generating = true;
  try {
    const opts: Parameters<typeof api.generateLicense>[0] = {};
    if (formOwnerTag) opts.ownerTag = formOwnerTag;
    if (formExpiryDate) opts.expiryDate = formExpiryDate;
    if (formTokenTtlDays !== 30) opts.tokenTtlDays = formTokenTtlDays;
    if (formHostIp) opts.hostIp = formHostIp;
    if (formBaseDomain) opts.baseDomain = formBaseDomain;

    const res = await api.generateLicense(opts);
    licenses = [res.data, ...licenses];
    showModal = false;
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
      l.id === license.id ? { ...l, status: "revoked" as const } : l,
    );
  } catch (e) {
    error = e instanceof Error ? e.message : "撤销失败";
  }
}

function logout() {
  clearToken();
  onLogout();
}

$effect(() => {
  load();
});
</script>

<div class="min-h-screen bg-slate-50 font-sans selection:bg-blue-200">
  <!-- 高级质感背景 -->
  <div class="fixed inset-0 pointer-events-none z-0">
    <div class="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-indigo-100/40 via-transparent to-transparent"></div>
    <div class="absolute inset-0 bg-[radial-gradient(circle_at_bottom_left,_var(--tw-gradient-stops))] from-blue-100/40 via-transparent to-transparent"></div>
  </div>

  <!-- Top nav -->
  <nav class="relative z-10 bg-white/70 backdrop-blur-md border-b border-slate-200/60 sticky top-0">
    <div class="max-w-[1400px] mx-auto px-6 lg:px-8 h-16 flex items-center justify-between">
      <div class="flex items-center gap-3">
        <div class="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
          <svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2.5"
              d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
            />
          </svg>
        </div>
        <span class="text-slate-800 font-semibold tracking-tight">OpenClaw Hub</span>
      </div>
      <button onclick={logout} class="text-sm font-medium text-slate-500 hover:text-slate-900 transition-colors flex items-center gap-1.5">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"
          ><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg
        >
        登出
      </button>
    </div>
  </nav>

  <!-- Main -->
  <main class="relative z-10 max-w-[1400px] mx-auto px-6 lg:px-8 py-8 lg:py-10">
    {#if error}
      <div class="mb-6 animate-in slide-in-from-top-4 fade-in duration-300">
        <div class="bg-red-50/80 backdrop-blur-sm border border-red-200/60 rounded-xl px-5 py-4 flex items-center justify-between shadow-sm">
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center shrink-0">
              <svg class="w-4 h-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"
                ><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg
              >
            </div>
            <p class="text-sm font-medium text-red-800">{error}</p>
          </div>
          <button onclick={() => (error = '')} class="text-red-400 hover:text-red-600 transition-colors p-1 rounded-md hover:bg-red-100">✕</button>
        </div>
      </div>
    {/if}

    <div class="bg-white/70 backdrop-blur-xl rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-200/60 overflow-hidden">
      <!-- Card header -->
      <div class="px-6 py-5 border-b border-slate-100/80 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white/40">
        <div>
          <h2 class="text-lg font-semibold text-slate-800">授权管理 (Licenses)</h2>
          <p class="text-sm text-slate-500 mt-1">管理用户节点、硬件绑定与容器部署状态</p>
        </div>
        <button
          onclick={openModal}
          class="relative overflow-hidden group bg-slate-900 hover:bg-slate-800 text-white font-medium px-5 py-2.5 rounded-xl transition-all active:scale-[0.98] shadow-md shadow-slate-900/10 text-sm flex items-center gap-2"
        >
          <div class="absolute inset-0 bg-white/20 translate-y-[-100%] group-hover:translate-y-[100%] transition-transform duration-500"></div>
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
          </svg>
          生成 License
        </button>
      </div>

      <!-- Table -->
      {#if loading}
        <div class="py-32 flex flex-col items-center justify-center gap-4">
          <div class="w-10 h-10 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin"></div>
          <p class="text-slate-400 text-sm font-medium">正在加载节点数据...</p>
        </div>
      {:else if licenses.length === 0}
        <div class="py-32 flex flex-col items-center justify-center text-center px-4">
          <div class="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center mb-4 text-blue-500">
            <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"
              ><path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.5"
                d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122"
              /></svg
            >
          </div>
          <h3 class="text-slate-800 font-semibold mb-1">尚无 License</h3>
          <p class="text-slate-500 text-sm max-w-sm mb-6">点击右上角按钮生成您的第一个节点授权凭证，系统将自动调度资源配置。</p>
          <button onclick={openModal} class="text-blue-600 font-medium text-sm hover:text-blue-700">立即创建 &rarr;</button>
        </div>
      {:else}
        <div class="overflow-x-auto">
          <table class="w-full text-sm text-left">
            <thead class="bg-slate-50/50 backdrop-blur-sm shadow-[inset_0_-1px_0_rgba(203,213,225,0.4)]">
              <tr>
                <th class="px-6 py-4 font-semibold text-slate-500 text-xs uppercase tracking-wider">License详情</th>
                <th class="px-6 py-4 font-semibold text-slate-500 text-xs uppercase tracking-wider">周期及状态</th>
                <th class="px-6 py-4 font-semibold text-slate-500 text-xs uppercase tracking-wider">绑定设备</th>
                <th class="px-6 py-4 font-semibold text-slate-500 text-xs uppercase tracking-wider">底层节点 (Node)</th>
                <th class="px-6 py-4 font-semibold text-slate-500 text-xs uppercase tracking-wider text-right">管理</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100/80">
              {#each licenses as license (license.id)}
                <tr class="group hover:bg-blue-50/30 transition-colors duration-200">
                  <!-- 第一列：主要 Key 和 创建日期 -->
                  <td class="px-6 py-4 align-top">
                    <div class="flex flex-col gap-1.5 pt-1">
                      <div class="flex items-center gap-2">
                        <span class="font-mono text-[13px] font-semibold text-slate-900 bg-slate-100/70 px-2 py-1 rounded-md border border-slate-200/50">{license.license_key}</span>
                      </div>
                      <div class="text-xs text-slate-500 flex items-center gap-1.5">
                        <svg class="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"
                          ><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg
                        >
                        生成于 {license.created_at.slice(0, 10)}
                      </div>
                      {#if license.owner_tag}
                        <div class="text-xs text-indigo-600/80 font-medium">@{license.owner_tag}</div>
                      {/if}
                    </div>
                  </td>

                  <!-- 第二列：总状态及两个 Expiry -->
                  <td class="px-6 py-4 align-top">
                    <div class="flex flex-col gap-2 pt-1">
                      <div>
                        <span
                          class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold tracking-wide border {license.status === 'active'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200/50'
                            : license.status === 'revoked'
                              ? 'bg-rose-50 text-rose-700 border-rose-200/50'
                              : 'bg-slate-100 text-slate-600 border-slate-200/50'}"
                        >
                          <div class="w-1.5 h-1.5 rounded-full mr-1.5 {license.status === 'active' ? 'bg-emerald-500' : license.status === 'revoked' ? 'bg-rose-500' : 'bg-slate-400'}"></div>
                          {STATUS[license.status].label}
                        </span>
                      </div>
                      <div class="space-y-1 mt-1 text-[13px]">
                        <div class="flex justify-between w-40">
                          <span class="text-slate-400">凭证到期:</span>
                          <span class="text-slate-700 font-medium">{license.expiry_date ?? '永久生效'}</span>
                        </div>
                        <div class="flex justify-between w-40">
                          <span class="text-slate-400">Token限期:</span>
                          <span class="text-slate-700 font-medium whitespace-nowrap">
                            {#if license.token_expires_at}
                              {license.token_expires_at.slice(0, 10)}
                              {#if new Date(license.token_expires_at) < new Date()}
                                <span class="text-orange-500 ml-1 font-bold animate-pulse" title="在下次Verify时自动轮换">!</span>
                              {/if}
                            {:else}
                              —
                            {/if}
                          </span>
                        </div>
                      </div>
                    </div>
                  </td>

                  <!-- 第三列：绑定的硬件信息 -->
                  <td class="px-6 py-4 align-top">
                    <div class="pt-1.5 space-y-2">
                      {#if license.hwid}
                        <div class="flex items-center gap-2">
                          <svg class="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"
                            ><path
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              stroke-width="2"
                              d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                            /></svg
                          >
                          <span class="text-slate-800 font-medium">{license.device_name ?? 'Unknown PC'}</span>
                        </div>
                        <div class="font-mono text-xs text-slate-400 bg-slate-50 px-2 py-1 rounded inline-block">
                          {license.hwid.slice(0, 14)}...
                        </div>
                      {:else}
                        <span class="text-slate-300 italic flex items-center gap-1"> 尚未绑定终端 </span>
                      {/if}
                    </div>
                  </td>

                  <!-- 第四列：Provisioning 以及 Node URL -->
                  <td class="px-6 py-4 align-top">
                    <div class="flex flex-col gap-2 pt-1.5">
                      <div class="flex items-center gap-2">
                        {#if license.provision_status === 'ready'}
                          <span class="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-100">
                            <svg class="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor"
                              ><path
                                fill-rule="evenodd"
                                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                clip-rule="evenodd"
                              /></svg
                            >
                            节点就绪
                          </span>
                        {:else if license.provision_status === 'running'}
                          <span class="flex items-center gap-1.5 text-xs font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md border border-blue-100">
                            <div class="w-3 h-3 border-2 border-blue-600 border-r-transparent rounded-full animate-spin"></div>
                            资源分配中...
                          </span>
                        {:else if license.provision_status === 'failed'}
                          <span class="flex items-center gap-1.5 text-xs font-semibold text-rose-600 bg-rose-50 px-2 py-0.5 rounded-md border border-rose-100" title={license.provision_error ?? ''}>
                            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"
                              ><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg
                            >
                            分配失败
                          </span>
                        {:else}
                          <span class="flex items-center gap-1.5 text-xs font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200">
                            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"
                              ><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg
                            >
                            等待调度
                          </span>
                        {/if}
                      </div>

                      {#if license.gateway_url}
                        <div class="mt-1">
                          <a
                            href={license.gateway_url}
                            target="_blank"
                            class="text-blue-600 text-[13px] hover:text-blue-800 hover:underline inline-flex items-center gap-1 truncate max-w-[200px] font-medium transition-colors"
                          >
                            {license.gateway_url.replace('ws://', '').replace('wss://', '')}
                            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"
                              ><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg
                            >
                          </a>
                          {#if license.container_name}
                            <div class="text-[11px] text-slate-400 font-mono mt-0.5">{license.container_name}</div>
                          {/if}
                        </div>
                      {/if}
                    </div>
                  </td>

                  <!-- 第五列：操作 -->
                  <td class="px-6 py-4 align-top text-right pt-5">
                    {#if license.status !== 'revoked'}
                      <button
                        onclick={() => revoke(license)}
                        class="text-xs font-semibold text-rose-500 hover:text-white bg-rose-50 hover:bg-rose-500 px-3 py-1.5 rounded-lg transition-all duration-200 border border-rose-100 hover:border-rose-500 shadow-sm opacity-0 group-hover:opacity-100 focus:opacity-100 translate-x-2 group-hover:translate-x-0"
                      >
                        吊销废弃
                      </button>
                    {:else}
                      <span class="text-slate-300 text-xs px-3">已注销</span>
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

<!-- ─── 生成 License 弹窗 (保留原逻辑，仅微调UI匹配) ───────────────── -->
{#if showModal}
  <!-- 遮罩 -->
  <div
    class="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
    onclick={(e) => {
      if (e.target === e.currentTarget) showModal = false
    }}
  >
    <!-- 弹窗卡片 -->
    <div class="relative w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 border border-slate-100">
      <!-- 顶部水汽发光背景点缀 -->
      <div class="absolute -top-24 -right-24 w-48 h-48 bg-blue-500/20 rounded-full blur-3xl pointer-events-none"></div>

      <!-- 弹窗头部 -->
      <div class="relative px-6 py-5 border-b border-slate-100/80 flex items-center justify-between z-10">
        <h3 class="text-slate-800 font-bold text-lg tracking-tight flex items-center gap-2">
          <svg class="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"
            ><path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2.5"
              d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
            /></svg
          >
          签发新凭证
        </h3>
        <button onclick={() => (showModal = false)} class="text-slate-400 hover:text-slate-700 hover:bg-slate-100 p-1.5 rounded-full transition-colors">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <!-- 表单内容 -->
      <div class="relative px-6 py-5 space-y-4 z-10 max-h-[70vh] overflow-y-auto">
        <!-- Owner Tag -->
        <div>
          <label class="block text-[13px] font-semibold text-slate-700 mb-1.5">
            归属标签 (Owner Tag) <span class="text-slate-400 font-normal ml-1">可留空</span>
          </label>
          <input
            type="text"
            bind:value={formOwnerTag}
            placeholder="例: alice, enterprise-01"
            class="w-full rounded-xl border border-slate-200 bg-slate-50/50 focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 text-sm px-4 py-2.5 outline-none transition-all placeholder:text-slate-400"
          />
        </div>

        <!-- License 到期日 -->
        <div>
          <label class="block text-[13px] font-semibold text-slate-700 mb-1.5">
            业务本身到期日 <span class="text-slate-400 font-normal ml-1">留空视作永久</span>
          </label>
          <input
            type="date"
            bind:value={formExpiryDate}
            class="w-full rounded-xl border border-slate-200 bg-slate-50/50 focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 text-sm px-4 py-2.5 outline-none transition-all text-slate-700"
          />
        </div>

        <!-- Token 有效期 -->
        <div>
          <label class="block text-[13px] font-semibold text-slate-700 mb-1.5"> Auth Token 轮换周期 </label>
          <div class="flex items-center gap-3">
            <div class="relative w-28">
              <input
                type="number"
                bind:value={formTokenTtlDays}
                min="1"
                max="3650"
                class="w-full rounded-xl border border-slate-200 bg-slate-50/50 focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 text-sm pl-4 pr-8 py-2.5 outline-none transition-all text-slate-700 font-medium"
              />
              <span class="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">天</span>
            </div>
            <span class="text-[12px] text-slate-500 leading-snug flex-1">
              Token到期会自动触发底层 <code class="bg-slate-100 text-slate-600 px-1 py-0.5 rounded">openclaw.json</code> 配置的轮换。
            </span>
          </div>
        </div>

        <!-- 分割线 -->
        <div class="flex items-center gap-4 py-1">
          <div class="h-px bg-slate-100 flex-1"></div>
          <span class="text-[11px] font-semibold text-slate-400 tracking-wider uppercase">Advanced</span>
          <div class="h-px bg-slate-100 flex-1"></div>
        </div>

        <!-- 宿主机 IP -->
        <div>
          <label class="block text-[13px] font-semibold text-slate-700 mb-1.5">
            宿主机 IP (Host IP) <span class="text-slate-400 font-normal ml-1">留空使用默认</span>
          </label>
          <input
            type="text"
            bind:value={formHostIp}
            placeholder="e.g. 192.168.1.100"
            class="w-full rounded-xl border border-slate-200 bg-slate-50/50 focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 text-sm px-4 py-2.5 outline-none transition-all font-mono placeholder:font-sans placeholder:text-slate-400 text-slate-700"
          />
        </div>

        <!-- 自定义域名 -->
        <div>
          <label class="block text-[13px] font-semibold text-slate-700 mb-1.5">
            独立域名接入 <span class="text-slate-400 font-normal ml-1">不需要则留空</span>
          </label>
          <input
            type="text"
            bind:value={formBaseDomain}
            placeholder="e.g. openclaw.example.com"
            class="w-full rounded-xl border border-slate-200 bg-slate-50/50 focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 text-sm px-4 py-2.5 outline-none transition-all placeholder:text-slate-400 text-slate-700"
          />
        </div>
      </div>

      <!-- 底部按钮 -->
      <div class="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-3 rounded-b-2xl">
        <button
          onclick={() => (showModal = false)}
          disabled={generating}
          class="px-5 py-2.5 text-sm font-medium text-slate-600 hover:text-slate-900 rounded-xl hover:bg-slate-200/50 transition-colors disabled:opacity-50">取消</button
        >
        <button
          onclick={generate}
          disabled={generating}
          class="bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:bg-blue-400 disabled:cursor-not-allowed text-white font-semibold px-6 py-2.5 rounded-xl transition-all text-sm flex items-center gap-2 shadow-sm shadow-blue-500/20"
        >
          {#if generating}
            <div class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
            签发部署中...
          {:else}
            确认创建
          {/if}
        </button>
      </div>
    </div>
  </div>
{/if}
