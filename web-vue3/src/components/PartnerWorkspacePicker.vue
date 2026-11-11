<script setup lang="ts">
import LegacyIcon from './LegacyIcon.vue'
type Workspace = { workspace_id: string; display_name: string }
const props = defineProps<{ workspaces: Workspace[]; modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
</script>
<template>
  <div class="partner-workspace-picker">
    <label><LegacyIcon name="folderOpen" :size="16" />工作区</label>
    <select :value="modelValue" aria-label="工作区" @change="emit('update:modelValue', ($event.target as HTMLSelectElement).value)"><option value="">Partner 私有工作区</option><option v-for="workspace in workspaces" :key="workspace.workspace_id" :value="workspace.workspace_id">{{ workspace.display_name }}</option></select>
    <p>{{ modelValue ? '这个伙伴共享该工作区的文件、知识库、技能和收藏夹。更改会保持同步；生成的文件会进入它的输出文件夹。' : '使用私有工作区，或绑定已有工作区，持续共享其中的最新资源。' }}</p>
  </div>
</template>
