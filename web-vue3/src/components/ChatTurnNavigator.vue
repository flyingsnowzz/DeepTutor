<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import type { ChatOutlineEntry } from '../chatOutline'

const emit = defineEmits<{ jump: [key: string]; bottom: [] }>()
const props = defineProps<{ entries: ChatOutlineEntry[]; scrollRoot: HTMLElement | null }>()
const activeKey = ref('')
const hoveredKey = ref<string | null>(null)
const left = ref(4)
const hot = ref(false)
const hovered = computed(() => props.entries.find(entry => entry.key === hoveredKey.value) || null)
const keys = computed(() => props.entries.map(entry => entry.key))
function update() {
  const root = props.scrollRoot
  if (!root) return
  const turns = [...root.querySelectorAll<HTMLElement>('[data-turn-key]')]
  const rootRect = root.getBoundingClientRect()
  const first = turns[0]?.getBoundingClientRect()
  if (first) left.value = Math.max(4, first.left - rootRect.left - 28)
  let current = ''
  for (const entry of props.entries) {
    const element = root.querySelector<HTMLElement>(`[data-turn-key="${entry.key}"]`)
    if (element && element.getBoundingClientRect().top <= rootRect.top + 120) current = entry.key
  }
  activeKey.value = current || props.entries[0]?.key || ''
}
function jump(key: string) {
  const root = props.scrollRoot
  const element = root?.querySelector<HTMLElement>(`[data-turn-key="${key}"]`)
  if (!root || !element) return
  const top = root.scrollTop + element.getBoundingClientRect().top - root.getBoundingClientRect().top - 56
  root.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
  activeKey.value = key
  emit('jump', key)
  element.classList.add('chat-turn-flash')
  setTimeout(() => element.classList.remove('chat-turn-flash'), 1000)
}
function bottom() { const root = props.scrollRoot; if (root) root.scrollTo({ top: root.scrollHeight, behavior: 'smooth' }); activeKey.value = ''; emit('bottom') }
function keydown(event: KeyboardEvent) {
  if (!event.altKey || event.metaKey || event.ctrlKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return
  const target = event.target as HTMLElement | null
  if (target?.isContentEditable || ['INPUT', 'TEXTAREA'].includes(target?.tagName || '')) return
  const at = activeKey.value ? keys.value.indexOf(activeKey.value) : -1
  if (!keys.value.length) return
  event.preventDefault()
  if (event.key === 'ArrowUp') jump(keys.value[Math.max(0, (at === -1 ? keys.value.length : at) - 1)])
  else if (at === -1 || at >= keys.value.length - 1) bottom()
  else jump(keys.value[at + 1])
}
watch(() => props.entries, () => void nextTick(update), { deep: true })
watch(() => props.scrollRoot, (next, previous) => { previous?.removeEventListener('scroll', update); next?.addEventListener('scroll', update); void nextTick(update) })
onMounted(() => { window.addEventListener('keydown', keydown); window.addEventListener('resize', update); props.scrollRoot?.addEventListener('scroll', update); void nextTick(update) })
onUnmounted(() => { window.removeEventListener('keydown', keydown); window.removeEventListener('resize', update); props.scrollRoot?.removeEventListener('scroll', update) })
</script>

<template>
  <div v-if="entries.length >= 3" class="chat-turn-navigator" :class="{ hot }" :style="{ left: `${left}px` }" @mouseenter="hot = true" @mouseleave="hot = false; hoveredKey = null">
    <nav aria-label="跳转到你的提问">
      <button v-for="entry in entries" :key="entry.key" type="button" :data-tick="entry.key" :aria-current="activeKey === entry.key ? 'true' : undefined" :aria-label="`${entry.ordinal}. ${entry.title}`" @mouseenter="hoveredKey = entry.key" @focus="hoveredKey = entry.key" @blur="hoveredKey = null" @click="jump(entry.key)"><i :style="{ width: `${12 + entry.weight * (hot ? 22 : 12)}px` }" /></button>
    </nav>
    <div v-if="hovered" class="chat-turn-preview"><small>{{ hovered.ordinal }}/{{ entries.length }}<span v-if="hovered.capability && hovered.capability !== 'chat'"> · {{ hovered.capability }}</span></small><strong>{{ hovered.title }}</strong><p v-if="hovered.reply">{{ hovered.reply }}</p></div>
  </div>
</template>
