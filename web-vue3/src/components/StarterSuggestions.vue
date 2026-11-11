<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { api, post } from '../api'
import { starterGroups, starterPrompts, type StarterGroup } from '../starterPrompts'
import LegacyIcon from './LegacyIcon.vue'
import StarterGlyph from './StarterGlyph.vue'
const emit = defineEmits<{ pick: [prompt: string] }>()
const props = withDefaults(defineProps<{ disabled?: boolean; customStarters?: Partial<Record<StarterGroup, Array<{ label: string; prompt: string }>>> }>(), { disabled: false, customStarters: () => ({}) })
const open = ref<StarterGroup | null>(null)
const advice = ref<{ label: string; prompt: string } | null>(null)
const working = ref(false); const asked = ref(false); const failed = ref(false); const noMaterial = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined; let disposed = false
async function load(attempt = 0) {
  try {
    const result = await api<{ suggestions: Array<{ label: string; prompt: string }>; stale?: boolean; status?: string }>('/api/dashboard/suggestions')
    if (disposed) return
    if (result.suggestions?.length) { advice.value = result.suggestions[0]; working.value = false; failed.value = false; return }
    if (result.stale && result.status !== 'error' && result.status !== 'no-material' && attempt < 10) { working.value = true; timer = setTimeout(() => void load(attempt + 1), 3500); return }
    noMaterial.value = result.status === 'no-material'; failed.value = !noMaterial.value; working.value = false
  } catch { if (!disposed) { failed.value = true; working.value = false } }
}
async function generate() {
  clearTimeout(timer); working.value = true; asked.value = true; failed.value = false
  try { const result = await post<{ suggestions: Array<{ label: string; prompt: string }>; status?: string }>('/api/dashboard/suggestions/refresh', {}); advice.value = result.suggestions?.[0] || null; noMaterial.value = result.status === 'no-material'; failed.value = !advice.value && !noMaterial.value }
  catch { failed.value = true }
  finally { working.value = false }
}
function pick(prompt: string) { if (!props.disabled) { emit('pick', prompt); open.value = null } }
onMounted(() => { working.value = true; void load() })
onUnmounted(() => { disposed = true; clearTimeout(timer) })
</script>
<template>
  <div class="dt-starters" @keydown.esc="open = null">
    <div class="dt-starter-menu"><div class="dt-starter-tabs"><button v-for="group in starterGroups.filter(group => !Array.isArray(props.customStarters[group.id]) || props.customStarters[group.id]?.length)" :key="group.id" type="button" class="dt-starter-tab" :aria-expanded="open === group.id" @click="open = open === group.id ? null : group.id"><span v-if="open === group.id" class="dt-starter-pill" /><StarterGlyph :group="group.id" /><span>{{ group.label }}</span></button></div><div v-if="open" class="dt-starter-card" role="group" :aria-label="starterGroups.find(group => group.id === open)?.label"><div class="dt-starter-card-body"><button v-for="item in (props.customStarters[open] ?? starterPrompts[open])" :key="item.label" type="button" class="dt-starter-row" :title="item.prompt" :disabled="disabled" @click="pick(item.prompt)"><span>{{ item.label }}</span><span class="dt-starter-enter"><LegacyIcon name="cornerDownLeft" :size="14" :stroke-width="1.8" /></span></button></div></div></div>
    <div class="dt-starter-advice"><span v-if="working" class="dt-starter-advice-status"><LegacyIcon name="loaderCircle" :size="12" class="dt-starter-spinner" />正在寻找值得探索的方向…</span><div v-else-if="advice" class="dt-starter-advice-chip"><button type="button" class="dt-starter-advice-main" :title="advice.prompt" :disabled="disabled" @click="pick(advice.prompt)"><StarterGlyph group="exploreNext" /><span class="dt-starter-advice-label">为你推荐</span><span class="dt-starter-advice-text">{{ advice.label }}</span></button><button type="button" class="dt-starter-advice-more" aria-label="换一个建议" :disabled="disabled" @click="generate"><LegacyIcon name="refreshCw" :size="14" :stroke-width="1.2" /></button></div><template v-else><span v-if="asked" class="dt-starter-advice-status">{{ noMaterial ? '学习记录还不够，先聊几句吧。' : failed ? '暂时无法生成建议，请重试。' : '' }}</span><button v-if="!noMaterial" type="button" class="dt-starter-advice-action" :disabled="disabled" @click="generate"><StarterGlyph group="exploreNext" />生成学习引导</button></template></div>
  </div>
</template>
