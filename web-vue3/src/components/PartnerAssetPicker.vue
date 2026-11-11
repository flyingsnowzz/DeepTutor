<script setup lang="ts">
import LegacyIcon from './LegacyIcon.vue'
type Option = { id: string; label: string; hint?: string }
type Selection = { knowledge_bases: string[]; skills: string[]; notebooks: string[] }
const props = defineProps<{ value: Selection; knowledgeBases: Option[]; skills: Option[]; notebooks: Option[] }>()
const emit = defineEmits<{ change: [value: Selection] }>()
const groups = [
  { key: 'knowledge_bases' as const, title: '知识库', icon: 'database', empty: '暂无可用知识库。' },
  { key: 'skills' as const, title: '技能', icon: 'book', empty: '暂无可用技能。' },
  { key: 'notebooks' as const, title: '收藏夹', icon: 'notebookPen', empty: '暂无可用收藏夹。' },
]
function options(key: keyof Selection) { return key === 'knowledge_bases' ? props.knowledgeBases : key === 'skills' ? props.skills : props.notebooks }
function toggle(key: keyof Selection, id: string) {
  const current = props.value[key]
  emit('change', { ...props.value, [key]: current.includes(id) ? current.filter(item => item !== id) : [...current, id] })
}
</script>
<template>
  <div class="partner-asset-picker">
    <section v-for="group in groups" :key="group.key">
      <h4><LegacyIcon :name="group.icon" :size="16" />{{ group.title }}<span v-if="value[group.key].length">{{ value[group.key].length }}</span></h4>
      <p v-if="!options(group.key).length">{{ group.empty }}</p>
      <div v-else class="partner-asset-chips"><button v-for="option in options(group.key)" :key="option.id" type="button" :class="{ selected: value[group.key].includes(option.id) }" :title="option.hint" @click="toggle(group.key, option.id)">{{ option.label }}</button></div>
    </section>
    <p class="partner-asset-note">选中的内容会复制进伙伴的私有工作区。</p>
  </div>
</template>
