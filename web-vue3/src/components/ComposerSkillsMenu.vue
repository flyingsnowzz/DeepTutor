<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import LegacyIcon from './LegacyIcon.vue'
import ComposerGlyph from './ComposerGlyph.vue'

interface SkillOption { id: string; name: string; description?: string }
const props = withDefaults(defineProps<{ options?: SkillOption[]; selected: Set<string>; everyTurn: boolean; below?: boolean }>(), { options: () => [] })
const emit = defineEmits<{ 'update:selected': [value: Set<string>]; 'update:everyTurn': [value: boolean] }>()
const open = ref(false)
const query = ref('')
const root = ref<HTMLElement | null>(null)
const trigger = ref<HTMLButtonElement | null>(null)
const filtered = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase()
  return props.options.filter(option => `${option.name} ${option.description || ''}`.toLocaleLowerCase().includes(needle))
})
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
    <button ref="trigger" type="button" class="chat-mode-trigger" aria-label="技能" :aria-expanded="open" @click="open = !open"><ComposerGlyph name="skill-deck" :size="14" /><span>技能</span><strong>{{ value }}</strong><LegacyIcon name="chevronDown" :size="11" /></button>
    <div v-if="open" class="composer-tray-popover" :class="{ below }" role="dialog" aria-label="技能">
      <label v-if="options.length >= 7" class="composer-tray-search"><LegacyIcon name="search" :size="14" /><input v-model="query" aria-label="搜索技能" placeholder="搜索技能" /></label>
      <div role="listbox" aria-label="技能" aria-multiselectable="true">
        <button type="button" role="option" :aria-selected="!selected.size" @click="emit('update:selected', new Set())"><ComposerGlyph name="skill-deck" :size="16" /><span><strong>自动</strong><small>Dito 自己判断该读哪些技能</small></span><LegacyIcon v-if="!selected.size" name="check" :size="13" /></button>
        <button v-for="option in filtered" :key="option.id" type="button" role="option" :aria-selected="selected.has(option.id)" @click="toggle(option.id)"><ComposerGlyph name="skill-deck" :size="14" /><span><strong>{{ option.name }}</strong><small v-if="option.description">{{ option.description }}</small></span><LegacyIcon v-if="selected.has(option.id)" name="check" :size="13" /></button>
        <p v-if="!filtered.length">{{ options.length ? '没有结果' : '还没有技能' }}</p>
      </div>
      <footer><label><button type="button" role="switch" :aria-checked="everyTurn" @click="emit('update:everyTurn', !everyTurn)"><span /></button>每轮附带</label><RouterLink to="/space/skills" @click="open = false">管理技能 <LegacyIcon name="cornerUpRight" :size="13" /></RouterLink></footer>
    </div>
  </div>
</template>
