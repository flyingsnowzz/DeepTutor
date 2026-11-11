<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import LegacyIcon from './LegacyIcon.vue'
import type { UsageSummary } from '../usageSummary'

const props = defineProps<{ turn: UsageSummary; session: UsageSummary }>()
const open = ref(false)
const scope = ref<'turn' | 'session'>('turn')
const anchor = ref<HTMLButtonElement | null>(null)
const panel = ref<HTMLElement | null>(null)
const position = ref({ top: 0, left: 0 })
const id = `usage-${Math.random().toString(36).slice(2)}`
const summary = computed(() => scope.value === 'turn' ? props.turn : props.session)
const compact = new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 })
const tokenFigure = computed(() => compact.format(props.turn.total_tokens ?? 0))
const number = (value?: number | null) => value == null ? '—' : value.toLocaleString('zh-CN')
const rate = (value?: number | null) => value == null ? '—' : `${(value * 100).toFixed(1)}%`
const seconds = (value?: number | null) => value == null ? '—' : `${value.toFixed(2)} 秒`
const cacheKnown = computed(() => Boolean(summary.value.cache_reported_calls))
const uncached = computed(() => cacheKnown.value ? Math.max(0, (summary.value.cache_input_tokens ?? 0) - (summary.value.cache_read_input_tokens ?? 0) - (summary.value.cache_creation_input_tokens ?? 0)) : null)
const rows = computed(() => [
  ['输入 Token', number(summary.value.prompt_tokens)], ['未缓存输入', number(uncached.value)], ['缓存读取', cacheKnown.value ? number(summary.value.cache_read_input_tokens) : '—'],
  ['缓存写入', number(summary.value.cache_write_reported_calls ? summary.value.cache_creation_input_tokens : null)], ['输出 Token', number(summary.value.completion_tokens)], ['推理 Token', number(summary.value.reasoning_tokens)],
  ['缓存命中率', rate(summary.value.cache_hit_rate)], ['模型耗时', seconds(summary.value.duration_seconds)], ['首 Token 时间', seconds(summary.value.ttft_seconds)],
  ['TPS', summary.value.tokens_per_second == null ? '—' : `${summary.value.tokens_per_second.toFixed(1)} tok/s`],
])
function place() {
  const rect = anchor.value?.getBoundingClientRect(); const box = panel.value?.getBoundingClientRect()
  if (!rect || !box) return
  const above = rect.top - box.height - 8
  position.value = { left: Math.max(12, Math.min(rect.right - box.width, window.innerWidth - box.width - 12)), top: Math.max(12, above >= 12 ? above : Math.min(rect.bottom + 8, window.innerHeight - box.height - 12)) }
}
function dismiss(event: PointerEvent) { if (!panel.value?.contains(event.target as Node) && !anchor.value?.contains(event.target as Node)) open.value = false }
function escape(event: KeyboardEvent) { if (event.key === 'Escape') { open.value = false; anchor.value?.focus() } }
function close() { open.value = false; anchor.value?.focus() }
watch(open, async value => {
  if (value) {
    document.addEventListener('pointerdown', dismiss); document.addEventListener('keydown', escape)
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true)
    await nextTick(); place(); panel.value?.focus()
  } else {
    document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape)
    window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true)
  }
})
watch(scope, () => void nextTick(place))
onUnmounted(() => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) })
</script>

<template>
  <button ref="anchor" type="button" class="chat-usage-trigger" :aria-expanded="open" :aria-controls="id" aria-haspopup="dialog" :aria-label="`${tokenFigure} Token，缓存命中率 ${rate(turn.cache_hit_rate)}`" @click="open = !open"><span><LegacyIcon name="capability" :size="12" />{{ tokenFigure }}<span class="chat-usage-word">Token</span></span><span><LegacyIcon name="knowledge" :size="12" /><span class="chat-usage-word">缓存命中率</span>{{ rate(turn.cache_hit_rate) }}</span><LegacyIcon name="chevronDown" :size="12" :class="{ open }" /></button>
  <Teleport to="body"><div v-if="open" :id="id" ref="panel" class="chat-usage-panel" role="dialog" aria-label="Token 用量与性能" tabindex="-1" :style="{ top: `${position.top}px`, left: `${position.left}px` }">
    <div class="chat-usage-scope" role="group" aria-label="统计范围"><button type="button" :aria-pressed="scope === 'turn'" @click="scope = 'turn'">本轮</button><button type="button" :aria-pressed="scope === 'session'" @click="scope = 'session'">本次会话</button><button type="button" aria-label="关闭" @click="close"><LegacyIcon name="close" :size="13" /></button></div>
    <div class="chat-usage-total"><span>总 Token</span><strong>{{ number(summary.total_tokens) }}</strong></div>
    <dl><div v-for="row in rows" :key="row[0]"><dt>{{ row[0] }}</dt><dd>{{ row[1] }}</dd></div></dl>
  </div></Teleport>
</template>
