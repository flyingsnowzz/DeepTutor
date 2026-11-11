<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import LegacyIcon from './LegacyIcon.vue'
import MarkdownView from './MarkdownView.vue'

type SoulSource = 'default' | 'library' | 'persona' | 'custom'
type SoulTemplate = { id: string; name: string; content: string }
type Persona = { name: string; description?: string; content?: string }
type Tab = 'library' | 'persona' | 'custom'

const props = defineProps<{
  source: SoulSource
  soulId: string
  content: string
  library: SoulTemplate[]
  personas: Persona[]
}>()
const emit = defineEmits<{
  'update:source': [value: SoulSource]
  'update:soul-id': [value: string]
  'update:content': [value: string]
}>()

const initialTab: Tab = props.source === 'persona' ? 'persona' : props.source === 'custom' ? 'custom' : 'library'
const tab = ref<Tab>(initialTab)
const mode = ref<'edit' | 'preview'>('edit')
const detached = computed(() => tab.value !== 'custom' && props.source === 'custom')
const tabs: { key: Tab; label: string; icon: string }[] = [
  { key: 'library', label: '灵魂库', icon: 'book' },
  { key: 'persona', label: '克隆 Persona', icon: 'profile' },
  { key: 'custom', label: '自己撰写', icon: 'sparkles' },
]
watch(() => props.source, source => {
  if (source === 'persona') tab.value = 'persona'
  else if (source === 'custom') tab.value = 'custom'
  else if (source === 'library') tab.value = 'library'
})
function selectTab(next: Tab) {
  tab.value = next
  mode.value = 'edit'
  if (next === 'custom') emit('update:source', 'custom')
}
function selectLibrary(id: string) {
  const entry = props.library.find(item => item.id === id)
  emit('update:source', 'library')
  emit('update:soul-id', id)
  emit('update:content', entry?.content || '')
  mode.value = 'edit'
}
function selectPersona(name: string) {
  const entry = props.personas.find(item => item.name === name)
  emit('update:source', 'persona')
  emit('update:soul-id', name)
  emit('update:content', entry?.content || '')
  mode.value = 'edit'
}
function updateContent(value: string) {
  emit('update:source', 'custom')
  emit('update:soul-id', '')
  emit('update:content', value)
}
</script>

<template>
  <div class="partner-soul-picker">
    <div class="soul-source-tabs" role="tablist" aria-label="灵魂来源">
      <button v-for="item in tabs" :key="item.key" type="button" role="tab" :aria-selected="tab === item.key" @click="selectTab(item.key)"><LegacyIcon :name="item.icon" :size="16" />{{ item.label }}</button>
    </div>

    <div v-if="tab === 'library'" class="soul-template-chips">
      <button v-for="soul in library" :key="soul.id" type="button" :class="{ selected: source === 'library' && soulId === soul.id }" @click="selectLibrary(soul.id)">{{ soul.name }}</button>
      <p v-if="!library.length">暂无灵魂模板。</p>
    </div>
    <div v-else-if="tab === 'persona'" class="soul-template-chips">
      <button v-for="persona in personas" :key="persona.name" type="button" :class="{ selected: source === 'persona' && soulId === persona.name }" :title="persona.description" @click="selectPersona(persona.name)">{{ persona.name }}</button>
      <p v-if="!personas.length">当前聊天工作区还没有 Persona。</p>
    </div>

    <div class="soul-editor">
      <header><span>SOUL.md</span><div role="group" aria-label="编辑或预览"><button type="button" :aria-pressed="mode === 'edit'" @click="mode = 'edit'"><LegacyIcon name="edit" :size="14" />编辑</button><button type="button" :aria-pressed="mode === 'preview'" @click="mode = 'preview'"><LegacyIcon name="search" :size="14" />预览</button></div></header>
      <textarea v-if="mode === 'edit'" :value="content" aria-label="SOUL.md 编辑" spellcheck="false" placeholder="# Soul
描述这个伙伴是谁、如何说话、重视什么…" @input="updateContent(($event.target as HTMLTextAreaElement).value)" />
      <div v-else class="soul-preview"><MarkdownView v-if="content.trim()" :content="content" /><p v-else>暂无预览内容。</p></div>
    </div>

    <p v-if="tab === 'persona' && source === 'persona' && soulId" class="soul-editor-note">Persona 的 Markdown 会复制到伙伴中，后续修改 Persona 不会影响它。</p>
    <p v-else-if="detached" class="soul-editor-note">已编辑——你的版本会成为这个伙伴的灵魂，原模板不会被修改。</p>
  </div>
</template>
