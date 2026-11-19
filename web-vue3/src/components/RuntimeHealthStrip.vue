<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { api } from '../api'

interface RuntimeStatus { worker_count: number; coordination_mode: 'memory' | 'redis'; redis_configured: boolean; redis_status: string; leader_healthy: boolean | null; recovery_backlog: number }
const props = defineProps<{ language?: string }>()
const chinese = computed(() => (props.language || 'zh').toLowerCase().startsWith('zh'))
const runtime = ref<RuntimeStatus | null>(null)
const health = computed(() => {
  const status = runtime.value
  if (!status) return 'unavailable'
  if (status.recovery_backlog > 0) return 'recovering'
  if (((status.worker_count > 1 || status.coordination_mode === 'redis') && (!status.redis_configured || status.redis_status !== 'ok')) || status.leader_healthy === false) return 'degraded'
  return 'healthy'
})
const label = computed(() => (chinese.value
  ? { healthy: '正常', recovering: '恢复中', degraded: '需要关注', unavailable: '不可用' }
  : { healthy: 'Healthy', recovering: 'Recovering', degraded: 'Needs attention', unavailable: 'Unavailable' })[health.value])
let timer: ReturnType<typeof setTimeout> | undefined
let active = false
async function refresh() {
  try { const result = await api<{ runtime_status?: RuntimeStatus } & RuntimeStatus>('/api/system/runtime'); if (active) runtime.value = result.runtime_status ?? result }
  catch { if (active) runtime.value = null }
  finally { if (active && !document.hidden) timer = setTimeout(refresh, 30000) }
}
function visibilityChanged() { if (timer) clearTimeout(timer); timer = undefined; if (!document.hidden) void refresh() }
onMounted(() => { active = true; document.addEventListener('visibilitychange', visibilityChanged); void refresh() })
onUnmounted(() => { active = false; if (timer) clearTimeout(timer); document.removeEventListener('visibilitychange', visibilityChanged) })
</script>

<template><div class="runtime-health-strip"><i :class="health" /><strong>{{ chinese ? '轮次运行' : 'Turn runtime' }}</strong><span>{{ label }}</span><RouterLink to="/settings/network">{{ chinese ? '详情' : 'Details' }}</RouterLink></div></template>

<style scoped>
.runtime-health-strip{display:inline-flex;align-items:center;gap:8px;font-size:12px}.runtime-health-strip i{width:8px;height:8px;border-radius:50%;background:#9ca3af}.runtime-health-strip i.healthy{background:#10b981}.runtime-health-strip i.recovering{background:#fbbf24}.runtime-health-strip i.degraded{background:#f87171}.runtime-health-strip strong{font-size:13px;font-weight:500}.runtime-health-strip span{color:var(--muted-foreground)}.runtime-health-strip a{color:var(--muted-foreground);text-decoration:underline}
</style>
