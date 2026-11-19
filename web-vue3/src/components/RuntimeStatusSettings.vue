<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { api } from '../api'
import { parseRuntimeStatusPayload, type RuntimeStatusPayload } from '../runtimeStatusPayload'

const props = defineProps<{ language?: string }>()
const chinese = computed(() => (props.language || 'zh').toLowerCase().startsWith('zh'))
const tr = (zh: string, en: string) => chinese.value ? zh : en
const runtime = ref<RuntimeStatusPayload | null>(null)
const loading = ref(true)
const error = ref('')
let timer: ReturnType<typeof setTimeout> | undefined
let controller: AbortController | null = null
let active = false
let failures = 0
let pendingVisibleRefresh = false
function clearTimer() { if (timer) clearTimeout(timer); timer = undefined }
function schedule() {
  clearTimer()
  if (!active || document.visibilityState !== 'visible') return
  const delay = failures ? Math.min(120_000, 5_000 * 2 ** Math.min(failures - 1, 5)) : 30_000
  timer = setTimeout(() => void refresh(), delay)
}
const health = computed(() => {
  const status = runtime.value
  if (!status) return 'unavailable'
  if (status.recovery_backlog > 0) return 'recovering'
  if (((status.worker_count > 1 || status.coordination_mode === 'redis') && (!status.redis_configured || status.redis_status !== 'ok')) || status.leader_healthy === false) return 'degraded'
  return 'healthy'
})
const healthLabel = computed(() => ({ healthy: tr('正常', 'Healthy'), recovering: tr('恢复中', 'Recovering'), degraded: tr('需要关注', 'Degraded'), unavailable: tr('不可用', 'Unavailable') })[health.value])
const healthDescription = computed(() => ({ healthy: tr('轮次归属和恢复服务运行正常。', 'Turn ownership and recovery services are operating normally.'), recovering: tr('运行时正在协调中断的工作。', 'The runtime is reconciling interrupted work.'), degraded: tr('轮次协调需要管理员处理。', 'Turn coordination needs operator attention.'), unavailable: tr('无法获取运行状态。', 'The runtime status endpoint is not available.') })[health.value])
const redisLabel = computed(() => ({ ok: tr('已连接', 'Connected'), unavailable: tr('不可用', 'Unavailable'), not_configured: tr('未配置', 'Not configured') })[runtime.value?.redis_status || 'not_configured'])
async function refresh() {
  if (controller || document.visibilityState !== 'visible') return
  controller = new AbortController()
  clearTimer()
  loading.value = true
  error.value = ''
  try {
    const response = await api<unknown>('/api/system/runtime', { signal: controller.signal })
    if (!active) return
    failures = 0
    runtime.value = parseRuntimeStatusPayload(response)
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') return
    if (!active) return
    failures += 1
    error.value = cause instanceof Error ? cause.message : tr('运行状态加载失败', 'Runtime health could not be loaded.')
  } finally {
    controller = null
    if (active) {
      loading.value = false
      if (pendingVisibleRefresh && document.visibilityState === 'visible') {
        pendingVisibleRefresh = false
        void refresh()
      } else schedule()
    }
  }
}
function onVisibility() {
  if (document.visibilityState === 'visible') {
    if (controller?.signal.aborted) pendingVisibleRefresh = true
    else void refresh()
  }
  else { clearTimer(); controller?.abort() }
}
onMounted(() => {
  active = true
  window.addEventListener('focus', onVisibility)
  document.addEventListener('visibilitychange', onVisibility)
  void refresh()
})
onUnmounted(() => {
  active = false
  pendingVisibleRefresh = false
  clearTimer()
  controller?.abort()
  window.removeEventListener('focus', onVisibility)
  document.removeEventListener('visibilitychange', onVisibility)
})
</script>

<template>
  <div class="runtime-settings">
    <section class="runtime-health-card" aria-labelledby="runtime-health-title">
      <header><div><h2 id="runtime-health-title">{{ tr('轮次运行状态', 'Turn runtime') }} <span class="runtime-health-chip" :class="health">{{ healthLabel }}</span></h2><p>{{ healthDescription }}</p></div><button type="button" :disabled="loading" @click="refresh">{{ tr('刷新', 'Refresh') }}</button></header>
      <p v-if="loading && !runtime" class="runtime-loading">{{ tr('正在加载运行状态…', 'Loading runtime status...') }}</p>
      <p v-if="error" class="runtime-error" role="alert">{{ runtime ? tr('最近一次刷新失败，正在显示上次的状态。', 'The latest refresh failed. Showing the last safe snapshot.') : error }}</p>
      <dl v-if="runtime" class="runtime-metrics">
        <div><dt>{{ tr('工作进程', 'Workers') }}</dt><dd>{{ runtime.worker_count }}</dd></div>
        <div><dt>{{ tr('协调方式', 'Coordination') }}</dt><dd>{{ runtime.coordination_mode === 'redis' ? 'Redis' : tr('进程内', 'In process') }}</dd></div>
        <div><dt>{{ tr('活跃轮次', 'Active owner turns') }}</dt><dd>{{ runtime.owner_turn_count }}</dd></div>
        <div><dt>{{ tr('恢复积压', 'Recovery backlog') }}</dt><dd>{{ runtime.recovery_backlog }}</dd></div>
        <div><dt>Redis</dt><dd>{{ redisLabel }}</dd></div>
        <div><dt>{{ tr('协调领导者', 'Leader') }}</dt><dd>{{ runtime.leader_healthy === false ? tr('异常', 'Unhealthy') : runtime.leader_id || tr('不适用', 'Not applicable') }}</dd></div>
        <div><dt>{{ tr('协议', 'Protocol') }}</dt><dd>{{ runtime.protocol_version }}</dd></div>
        <div><dt>{{ tr('工作进程 ID', 'Worker ID') }}</dt><dd :title="runtime.worker_id">{{ runtime.worker_id }}</dd></div>
      </dl>
    </section>
    <section v-if="runtime" class="runtime-coordination-card"><h2>{{ tr('轮次协调', 'Turn coordination') }}</h2><p>{{ tr('这些启动参数来自当前运行环境，仅供查看。', 'These startup settings are shown from the active runtime.') }}</p><div class="runtime-fields"><label>{{ tr('后端工作进程', 'Backend workers') }}<input :value="runtime.worker_count" type="number" disabled /></label><label>{{ tr('协调后端', 'Coordination backend') }}<select :value="runtime.coordination_mode" disabled><option value="memory">{{ tr('进程内', 'In process') }}</option><option value="redis">Redis</option></select></label></div><details><summary>{{ tr('高级', 'Advanced') }}</summary><div class="runtime-fields"><label>{{ tr('租约有效期（秒）', 'Lease TTL (seconds)') }}<input :value="runtime.lease_ttl_seconds" type="number" disabled /></label><label>{{ tr('恢复间隔（秒）', 'Recovery interval (seconds)') }}<input :value="runtime.recovery_interval_seconds" type="number" disabled /></label></div></details></section>
  </div>
</template>

<style scoped>
.runtime-settings{display:grid;gap:24px;margin:0 0 28px}.runtime-health-card,.runtime-coordination-card{border:1px solid var(--border);border-radius:16px;background:var(--card);padding:20px}.runtime-health-card header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.runtime-health-card h2,.runtime-coordination-card h2{margin:0;font-size:14px;font-weight:600}.runtime-health-card p,.runtime-coordination-card p{margin:6px 0 0;color:var(--muted-foreground);font-size:12px;line-height:1.6}.runtime-health-card button{border:0;background:transparent;color:var(--muted-foreground);cursor:pointer;font-size:12px}.runtime-health-card button:disabled{opacity:.5}.runtime-health-chip{display:inline-block;margin-left:6px;padding:2px 8px;border-radius:999px;background:var(--muted);font-size:11px}.runtime-health-chip.healthy{color:#16803d}.runtime-health-chip.degraded,.runtime-health-chip.recovering{color:#b36b00}.runtime-health-chip.unavailable{color:#b42318}.runtime-error{color:#b42318!important}.runtime-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;margin:20px 0 0;padding-top:16px;border-top:1px solid var(--border)}.runtime-metrics div{min-width:0}.runtime-metrics dt{color:var(--muted-foreground);font-size:11px}.runtime-metrics dd{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin:4px 0 0;font-size:14px;font-weight:600}.runtime-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin-top:20px}.runtime-fields label{display:grid;gap:6px;font-size:12px}.runtime-fields input,.runtime-fields select{width:100%;padding:9px 12px;border:1px solid var(--border);border-radius:10px;background:var(--background);color:var(--foreground)}.runtime-fields :disabled{opacity:.65}.runtime-coordination-card details{margin-top:20px;padding-top:16px;border-top:1px solid var(--border)}.runtime-coordination-card summary{cursor:pointer;font-size:14px;font-weight:500}@media(max-width:700px){.runtime-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.runtime-fields{grid-template-columns:1fr}}
</style>
