<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { api } from '../api'
import LegacyIcon from './LegacyIcon.vue'
import { starterGroups, starterPrompts, type StarterGroup } from '../starterPrompts'

interface StarterPrompt { label: string; prompt: string }
interface ChatCustomization {
  hidden_modes: string[]
  controls: { skills: boolean; mcp: boolean; partners: boolean; preferences: boolean; voice: boolean }
  starters: Partial<Record<StarterGroup, StarterPrompt[]>>
}
interface PageCustomization { chat: ChatCustomization; learning: { hidden_features: string[] } }
interface CapabilityOption { id: string; label: string; description: string; icon: string; secondary?: boolean }
const DEFAULT_CHAT: ChatCustomization = {
  hidden_modes: [],
  controls: { skills: true, mcp: true, partners: true, preferences: true, voice: true },
  starters: {},
}
const props = defineProps<{ capabilities: CapabilityOption[] }>()
const emit = defineEmits<{ close: []; saved: [value: PageCustomization] }>()
const loading = ref(true)
const saving = ref(false)
const loadError = ref(false)
const saveError = ref(false)
const tab = ref<'modes' | 'controls' | 'starters'>('modes')
const group = ref<StarterGroup>('explain')
const draft = ref<PageCustomization>(structuredClone({ chat: DEFAULT_CHAT, learning: { hidden_features: [] } }))
const dialog = ref<HTMLElement | null>(null)
let previousFocus: HTMLElement | null = null
let previousOverflow = ''
const controlLabels = { skills: '技能', mcp: 'MCP 连接器', partners: '伙伴', preferences: '偏好', voice: '语音输入' } as const
const prompts = computed(() => draft.value.chat.starters[group.value] ?? starterPrompts[group.value])
const invalid = computed(() => Object.values(draft.value.chat.starters).some(rows => rows?.some(row => !row.label.trim() || !row.prompt.trim())))
function clone<T>(value: T): T { return structuredClone(value) }
async function load() {
  loading.value = true
  loadError.value = false
  try { draft.value = await api<PageCustomization>('/api/settings/page-customization') }
  catch { loadError.value = true }
  finally { loading.value = false }
}
function toggleMode(id: string) {
  const values = draft.value.chat.hidden_modes
  draft.value.chat.hidden_modes = values.includes(id) ? values.filter(value => value !== id) : [...values, id]
}
function updatePrompts(rows: StarterPrompt[]) {
  draft.value.chat.starters = { ...draft.value.chat.starters, [group.value]: rows }
}
function updatePrompt(index: number, key: 'label' | 'prompt', value: string) {
  updatePrompts(prompts.value.map((row, at) => at === index ? { ...row, [key]: value } : row))
}
function addPrompt() { updatePrompts([...prompts.value, { label: '', prompt: '' }]) }
function removePrompt(index: number) { updatePrompts(prompts.value.filter((_, at) => at !== index)) }
function resetGroup() {
  const next = { ...draft.value.chat.starters }
  delete next[group.value]
  draft.value.chat.starters = next
}
async function save() {
  if (invalid.value || loading.value || loadError.value) return
  saving.value = true
  saveError.value = false
  try {
    const result = await api<PageCustomization>('/api/settings/page-customization/chat', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft.value.chat),
    })
    emit('saved', result)
  } catch { saveError.value = true }
  finally { saving.value = false }
}
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && !saving.value) { event.preventDefault(); emit('close'); return }
  if (event.key !== 'Tab' || !dialog.value) return
  const focusable = [...dialog.value.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')]
  const first = focusable[0]
  const last = focusable.at(-1)
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
}
onMounted(() => {
  previousFocus = document.activeElement as HTMLElement | null
  previousOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  document.addEventListener('keydown', onKeydown)
  void nextTick(() => dialog.value?.querySelector<HTMLButtonElement>('button')?.focus())
  void load()
})
onBeforeUnmount(() => {
  document.body.style.overflow = previousOverflow
  document.removeEventListener('keydown', onKeydown)
  previousFocus?.focus()
})
</script>

<template>
  <Teleport to="body">
    <div class="chat-customize-backdrop" @mousedown.self="!saving && emit('close')">
      <section ref="dialog" class="chat-customize-dialog" role="dialog" aria-modal="true" aria-labelledby="chat-customize-title" aria-describedby="chat-customize-description" @mousedown.stop>
        <header class="chat-customize-header"><div><h2 id="chat-customize-title">自定义页面</h2><p id="chat-customize-description">选择页面中显示的内容，已有学习记录和已安装模块会保留。</p></div><button class="dt-note-icon-button" aria-label="关闭" :disabled="saving" @click="emit('close')"><LegacyIcon name="close" :size="16" /></button></header>
        <div class="chat-customize-body">
          <div v-if="saveError || loadError" role="alert" class="chat-customize-error">未能保存修改，草稿已保留，请重试。<button v-if="loadError" @click="load">重试</button></div>
          <div v-if="loading" class="chat-customize-loading" role="status"><LegacyIcon name="history" :size="20" />加载中…</div>
          <template v-else>
            <div class="chat-customize-tabs" role="group" aria-label="自定义分类"><button v-for="item in ([['modes','模式'],['controls','输入工具'],['starters','起始提示']] as const)" :key="item[0]" :aria-pressed="tab === item[0]" @click="tab = item[0]">{{ item[1] }}</button></div>
            <div v-if="tab === 'modes'" class="chat-customize-list"><p class="chat-customize-hint">选择模式菜单中显示的功能。已有对话会保留当前模式。</p><button v-for="capability in props.capabilities.filter(item => item.id !== 'chat')" :key="capability.id" class="chat-customize-choice" role="switch" :aria-checked="!draft.chat.hidden_modes.includes(capability.id)" @click="toggleMode(capability.id)"><span><strong>{{ capability.label }}</strong><small>{{ capability.description }}</small></span><span class="chat-customize-switch" :class="{ 'is-on': !draft.chat.hidden_modes.includes(capability.id) }"><span /></span></button></div>
            <div v-else-if="tab === 'controls'" class="chat-customize-list"><button v-for="(label, key) in controlLabels" :key="key" class="chat-customize-choice" role="switch" :aria-checked="draft.chat.controls[key]" @click="draft.chat.controls[key] = !draft.chat.controls[key]"><span><strong>{{ label }}</strong></span><span class="chat-customize-switch" :class="{ 'is-on': draft.chat.controls[key] }"><span /></span></button></div>
            <div v-else class="chat-customize-starters">
              <div class="chat-customize-groups" role="group" aria-label="起始提示分类"><button v-for="item in starterGroups" :key="item.id" :aria-pressed="group === item.id" @click="group = item.id">{{ item.label }}</button></div>
              <div class="chat-customize-prompts"><article v-for="(row, index) in prompts" :key="`${group}-${index}`"><label>显示标题<input :value="row.label" @input="updatePrompt(index, 'label', ($event.target as HTMLInputElement).value)"></label><label>填入输入框的提示内容<textarea :value="row.prompt" rows="3" @input="updatePrompt(index, 'prompt', ($event.target as HTMLTextAreaElement).value)" /></label><button class="chat-customize-remove" :aria-label="`移除提示 ${index + 1}`" @click="removePrompt(index)"><LegacyIcon name="close" :size="14" /></button></article><p v-if="!prompts.length" class="chat-customize-hint">此分类暂无提示，添加后会重新显示在聊天页。</p></div>
              <div class="chat-customize-prompt-actions"><button @click="addPrompt"><LegacyIcon name="plus" :size="14" />添加提示</button><button @click="resetGroup"><LegacyIcon name="undo" :size="14" />恢复此分类</button></div>
            </div>
          </template>
        </div>
        <footer class="chat-customize-footer"><button class="chat-customize-reset" :disabled="saving" @click="draft.chat = clone(DEFAULT_CHAT)"><LegacyIcon name="undo" :size="14" />恢复默认</button><div><button :disabled="saving" @click="emit('close')">取消</button><button class="primary" :disabled="saving || loading || loadError || invalid" @click="save">{{ saving ? '保存中…' : '保存' }}</button></div></footer>
      </section>
    </div>
  </Teleport>
</template>
