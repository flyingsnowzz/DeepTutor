<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import type { ContextBudget } from '../contextBudget'

const props = defineProps<{ budget: ContextBudget }>()
const open = ref(false)
const root = ref<HTMLElement | null>(null)
const trigger = ref<HTMLButtonElement | null>(null)
const colors: Record<string, string> = { messages: '#6366f1', system_prompt: '#0ea5e9', system_tools: '#14b8a6', mcp_tools: '#10b981', tool_manifest: '#84cc16', extended_tools: '#f59e0b', persona_style: '#f97316', partner_turn_policy: '#d946ef', memory: '#a855f7', learning_journal: '#3b82f6', knowledge_base_note: '#8b5cf6', skills: '#06b6d4', sources: '#0891b2', notebooks: '#e879a3', workspace: '#65a30d', workspace_instructions: '#0d9488', capability: '#64748b' }
const fallbackColors = ['#6366f1', '#0ea5e9', '#14b8a6', '#f59e0b', '#a855f7', '#64748b']
const labels: Record<string, string> = { messages: '对话消息', system_prompt: '系统提示词', system_tools: '内置工具定义', mcp_tools: 'MCP 工具定义', tool_manifest: '工具清单', extended_tools: '扩展工具清单', persona_style: 'Persona 风格', partner_turn_policy: '伙伴轮次策略', memory: '记忆', learning_journal: '学习日志', knowledge_base_note: '知识库说明', skills: '技能', sources: '来源', notebooks: '收藏夹', workspace: '工作区', workspace_instructions: '工作区提示词', capability: '能力' }
const used = computed(() => Number.isFinite(props.budget.used_tokens) ? Math.max(0, props.budget.used_tokens) : 0)
const total = computed(() => Number.isFinite(props.budget.window) && props.budget.window > 0 ? props.budget.window : Math.max(used.value, 1))
const free = computed(() => Number.isFinite(props.budget.free_tokens) ? Math.max(0, props.budget.free_tokens) : Math.max(0, total.value - used.value))
const usedShare = computed(() => used.value / total.value * 100)
const percent = computed(() => `${Math.round(usedShare.value)}%`)
const segments = computed(() => (props.budget.segments || []).filter(segment => segment && typeof segment.key === 'string' && segment.key.length && Number.isFinite(segment.tokens) && segment.tokens > 0))
const circumference = 2 * Math.PI * 6.5
function color(key: string) { if (colors[key]) return colors[key]; let hash = 0; for (let index = 0; index < key.length; index += 1) hash = (hash * 31 + key.charCodeAt(index)) >>> 0; return fallbackColors[hash % fallbackColors.length] }
function formatTokens(value: number) { if (!Number.isFinite(value) || value <= 0) return '0'; const compact = (scaled: number) => scaled.toFixed(1).replace(/\.0$/, ''); return value >= 1_000_000 ? `${compact(value / 1_000_000)}M` : value >= 1000 ? `${compact(value / 1000)}k` : String(Math.round(value)) }
function formatPercent(share: number) { if (!Number.isFinite(share) || share <= 0) return '0%'; if (share < 1) return '<1%'; if (share < 10) return `${share.toFixed(1).replace(/\.0$/, '')}%`; return `${Math.round(share)}%` }
function dismiss(event: MouseEvent) { if (root.value && !root.value.contains(event.target as Node)) open.value = false }
function escape(event: KeyboardEvent) { if (event.key === 'Escape') { open.value = false; trigger.value?.focus() } }
watch(open, value => { if (value) { document.addEventListener('mousedown', dismiss); document.addEventListener('keydown', escape) } else { document.removeEventListener('mousedown', dismiss); document.removeEventListener('keydown', escape) } })
onUnmounted(() => { document.removeEventListener('mousedown', dismiss); document.removeEventListener('keydown', escape) })
</script>

<template>
  <div ref="root" class="context-budget-chip"><button ref="trigger" type="button" :class="{ nearFull: usedShare >= 90, open }" :aria-label="`上下文窗口：已用 ${percent}`" :aria-expanded="open" aria-haspopup="dialog" @click="open = !open"><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="2" opacity=".25" /><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" :stroke-dasharray="circumference" :stroke-dashoffset="circumference * (1 - Math.min(100, Math.max(0, usedShare)) / 100)" /></svg><span>{{ percent }}</span></button>
    <div v-if="open" class="context-budget-panel" role="dialog" aria-label="上下文窗口"><header><div><span>上下文窗口</span><small v-if="budget.model">{{ budget.model }}</small></div><strong>{{ formatTokens(used) }} / {{ formatTokens(total) }}（{{ percent }}）<em v-if="budget.window_estimated">估算</em></strong><div class="context-budget-bar"><i v-for="segment in segments" :key="segment.key" :style="{ width: `${Math.min(100, segment.tokens / total * 100)}%`, backgroundColor: color(segment.key) }" /></div></header>
      <div class="context-budget-segments"><div v-for="segment in segments" :key="segment.key"><i :style="{ backgroundColor: color(segment.key) }" /><span>{{ labels[segment.key] || segment.key.replace(/_/g, ' ') }}</span><small>{{ formatTokens(segment.tokens) }}</small><small>{{ formatPercent(segment.tokens / total * 100) }}</small></div><div class="free"><i /><span>剩余空间</span><small>{{ formatTokens(free) }}</small><small>{{ formatPercent(free / total * 100) }}</small></div></div>
      <footer v-if="budget.window_estimated || budget.counter === 'heuristic' || (budget.deferred_tool_count || 0) > 0"><p v-if="budget.window_estimated">窗口大小由模型名推断得出，可在设置中按模型指定。</p><p v-if="budget.counter === 'heuristic'">token 数是按字符估算的粗略值。</p><p v-if="(budget.deferred_tool_count || 0) > 0">{{ budget.deferred_tool_count }} 个扩展工具按需加载，未被调用前不占用上下文。</p></footer>
    </div>
  </div>
</template>
