<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

const props = withDefaults(defineProps<{ latestBackup: string | null; variant?: 'full' | 'compact' }>(), { variant: 'compact' })
const dismissed = ref<string | null>(null)
const expanded = ref(false)
const visible = computed(() => Boolean(props.latestBackup && dismissed.value !== props.latestBackup))
onMounted(() => { dismissed.value = window.localStorage.getItem('dt:memory:banner-dismissed') })
watch(() => props.latestBackup, () => { expanded.value = false })
function dismiss() {
  if (!props.latestBackup) return
  window.localStorage.setItem('dt:memory:banner-dismissed', props.latestBackup)
  dismissed.value = props.latestBackup
}
</script>

<template>
  <div v-if="visible" class="memory-archived-banner" :class="`is-${variant}`">
    <template v-if="variant === 'full'">
      <span class="memory-archived-icon" aria-hidden="true">▣</span>
      <div><strong>你的 v1 记忆已归档</strong><p>保存在 memory/backup/{{ latestBackup }}。v2 将从零开始——与 DeepTutor 互动并点击各文档的“更新”来建立记忆。</p></div>
      <button type="button" aria-label="关闭" @click="dismiss">×</button>
    </template>
    <template v-else>
      <button type="button" class="memory-archived-toggle" :aria-expanded="expanded" @click="expanded = !expanded"><span><i aria-hidden="true">▣</i>你的 v1 记忆已归档</span><span aria-hidden="true">{{ expanded ? '⌃' : '⌄' }}</span></button>
      <div v-if="expanded" class="memory-archived-detail"><p>保存在 memory/backup/{{ latestBackup }}。v2 将从零开始——与 DeepTutor 互动并点击各文档的“更新”来建立记忆。</p><button type="button" aria-label="关闭" @click="dismiss">×</button></div>
    </template>
  </div>
</template>
