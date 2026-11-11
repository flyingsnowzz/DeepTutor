<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { api } from '../api'
import LegacyIcon from './LegacyIcon.vue'

interface Surface { kind: string; title: string; description: string }
interface Customization { chat?: unknown; learning: { hidden_features: string[] } }
const props = defineProps<{ surfaces: Surface[] }>()
const emit = defineEmits<{ close: []; saved: [value: Customization] }>()
const loading = ref(true)
const saving = ref(false)
const failed = ref(false)
const draft = ref<string[]>([])
const dialog = ref<HTMLElement | null>(null)
let previousFocus: HTMLElement | null = null
let previousOverflow = ''
function toggle(kind: string) { draft.value = draft.value.includes(kind) ? draft.value.filter(item => item !== kind) : [...draft.value, kind] }
async function load() {
  loading.value = true
  failed.value = false
  try { draft.value = (await api<Customization>('/api/settings/page-customization')).learning.hidden_features || [] }
  catch { failed.value = true }
  finally { loading.value = false }
}
async function save() {
  saving.value = true
  failed.value = false
  try {
    const result = await api<Customization>('/api/settings/page-customization/learning', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hidden_features: draft.value }) })
    emit('saved', result)
  } catch { failed.value = true }
  finally { saving.value = false }
}
function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && !saving.value) { event.preventDefault(); emit('close'); return }
  if (event.key !== 'Tab' || !dialog.value) return
  const nodes = [...dialog.value.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex]:not([tabindex="-1"])')]
  const first = nodes[0]
  const last = nodes.at(-1)
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
}
onMounted(() => {
  previousFocus = document.activeElement as HTMLElement | null
  previousOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  document.addEventListener('keydown', keydown)
  void nextTick(() => dialog.value?.querySelector<HTMLButtonElement>('button')?.focus())
  void load()
})
onBeforeUnmount(() => { document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', keydown); previousFocus?.focus() })
</script>

<template>
  <Teleport to="body"><div class="chat-customize-backdrop" @mousedown.self="!saving && emit('close')"><section ref="dialog" class="chat-customize-dialog learning-customize-dialog" role="dialog" aria-modal="true" aria-labelledby="learning-customize-title" @mousedown.stop>
    <header class="chat-customize-header"><div><h2 id="learning-customize-title">自定义页面</h2><p>选择页面中显示的内容，已有学习记录和已安装模块会保留。</p></div><button class="dt-note-icon-button" aria-label="关闭" :disabled="saving" @click="emit('close')"><LegacyIcon name="close" :size="16" /></button></header>
    <div class="chat-customize-body"><p v-if="failed" role="alert" class="chat-customize-error">未能加载或保存页面设置，请重试。</p><div v-if="loading" role="status" class="chat-customize-loading">加载中…</div><div v-else class="chat-customize-list"><p class="chat-customize-hint">选择在新建学习页显示的学习方式。隐藏后可以随时重新添加。</p><button v-for="surface in props.surfaces" :key="surface.kind" class="chat-customize-choice" role="switch" :aria-checked="!draft.includes(surface.kind)" @click="toggle(surface.kind)"><span><strong>{{ surface.title }}</strong><small>{{ surface.description }}</small></span><span class="chat-customize-switch" :class="{ 'is-on': !draft.includes(surface.kind) }"><span /></span></button></div></div>
    <footer class="chat-customize-footer"><button class="chat-customize-reset" :disabled="saving" @click="draft = []"><LegacyIcon name="undo" :size="14" />恢复默认</button><div><button :disabled="saving" @click="emit('close')">取消</button><button class="primary" :disabled="saving || loading" @click="save">{{ saving ? '保存中…' : '保存' }}</button></div></footer>
  </section></div></Teleport>
</template>
