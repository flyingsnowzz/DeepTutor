<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import LegacyIcon from './LegacyIcon.vue'
import ComposerGlyph from './ComposerGlyph.vue'

interface ConnectorOption { id: string; name: string }
const props = withDefaults(defineProps<{ options?: ConnectorOption[]; selected: Set<string>; everyTurn: boolean; below?: boolean }>(), { options: () => [] })
const emit = defineEmits<{ 'update:selected': [value: Set<string>]; 'update:everyTurn': [value: boolean] }>()
const open = ref(false)
const root = ref<HTMLElement | null>(null)
const trigger = ref<HTMLButtonElement | null>(null)
const value = computed(() => props.selected.size ? `已引用 ${props.selected.size} 个` : '自动')
function toggle(id: string) {
  const next = new Set(props.selected)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  emit('update:selected', next)
}
function outside(event: MouseEvent) { if (open.value && !root.value?.contains(event.target as Node)) open.value = false }
function keydown(event: KeyboardEvent) { if (event.key === 'Escape' && open.value) { open.value = false; trigger.value?.focus() } }
onMounted(() => { document.addEventListener('click', outside); document.addEventListener('keydown', keydown) })
onUnmounted(() => { document.removeEventListener('click', outside); document.removeEventListener('keydown', keydown) })
</script>

<template>
  <div ref="root" class="composer-tray-control">
    <button ref="trigger" type="button" class="chat-mode-trigger" aria-label="连接器" :aria-expanded="open" @click="open = !open"><ComposerGlyph name="connector-hub" :size="14" /><span>连接器</span><strong>{{ value }}</strong><LegacyIcon name="chevronDown" :size="11" /></button>
    <div v-if="open" class="composer-tray-popover" :class="{ below }" role="dialog" aria-label="连接器">
      <div role="listbox" aria-label="连接器" aria-multiselectable="true">
        <button v-if="options.length" type="button" role="option" :aria-selected="!selected.size" @click="emit('update:selected', new Set())"><ComposerGlyph name="connector-hub" :size="16" /><span><strong>自动</strong><small>Dito 可以使用每个已连接服务的工具</small></span><LegacyIcon v-if="!selected.size" name="check" :size="13" /></button>
        <button v-for="option in options" :key="option.id" type="button" role="option" :aria-selected="selected.has(option.id)" @click="toggle(option.id)"><span class="connector-lead"><ComposerGlyph name="connector-hub" :size="14" /><i /></span><span><strong>{{ option.name }}</strong><small>已连接</small></span><LegacyIcon v-if="selected.has(option.id)" name="check" :size="13" /></button>
        <p v-if="!options.length">还没有连接器</p>
      </div>
      <footer><label><button type="button" role="switch" :aria-checked="everyTurn" @click="emit('update:everyTurn', !everyTurn)"><span /></button>每轮附带</label><RouterLink to="/space/mcp" @click="open = false">添加连接器 <LegacyIcon name="plus" :size="13" /></RouterLink></footer>
    </div>
  </div>
</template>
