<script setup lang="ts">
import { ref } from 'vue'
import LegacyIcon from './LegacyIcon.vue'
import type { SiblingInfo } from '../messageBranches'
import { copyText } from '../clipboard'
import ChatPlayAudioButton from './ChatPlayAudioButton.vue'

const props = withDefaults(defineProps<{ content: string; role: string; sibling?: SiblingInfo; canEdit?: boolean; canRegenerate?: boolean; canDelete?: boolean; disabled?: boolean; autoPlayFresh?: boolean; autoplayEnabled?: boolean }>(), { sibling: undefined, canEdit: false, canRegenerate: false, canDelete: false, disabled: false, autoPlayFresh: false, autoplayEnabled: false })
const emit = defineEmits<{ edit: []; regenerate: []; delete: []; switchBranch: [parentId: number | null, childId: number]; failed: [message: string] }>()
const copied = ref(false)
const copyFailed = ref(false)
const confirming = ref(false)
let copyTimer: ReturnType<typeof setTimeout> | undefined
async function copy() {
  copyFailed.value = false
  try {
    await copyText(props.content)
    copied.value = true
    if (copyTimer) clearTimeout(copyTimer)
    copyTimer = setTimeout(() => { copied.value = false }, 1600)
  } catch { copyFailed.value = true }
}
function switchTo(index: number) {
  if (!props.sibling) return
  const childId = props.sibling.siblingIds[index]
  if (childId !== undefined) emit('switchBranch', props.sibling.parentId, childId)
}
</script>

<template>
  <div class="chat-message-actions" :class="`is-${role}`">
    <div v-if="sibling && sibling.total > 1" class="chat-branch-navigator">
      <button type="button" aria-label="上一个分支" :disabled="sibling.index <= 1 || disabled" @click="switchTo(sibling.index - 2)"><LegacyIcon name="chevronLeft" :size="12" /></button><span>{{ sibling.index }} / {{ sibling.total }}</span><button type="button" aria-label="下一个分支" :disabled="sibling.index >= sibling.total || disabled" @click="switchTo(sibling.index)"><LegacyIcon name="chevronRight" :size="12" /></button>
    </div>
    <div class="chat-message-action-buttons">
      <button type="button" :title="copied ? '已复制' : copyFailed ? '复制失败' : '复制'" :aria-label="copied ? '已复制' : copyFailed ? '复制失败' : '复制'" @click="copy"><LegacyIcon :name="copied ? 'check' : 'copy'" :size="14" /></button>
      <ChatPlayAudioButton v-if="role === 'assistant'" :content="content" :auto-play-fresh="autoPlayFresh" :autoplay-enabled="autoplayEnabled" @failed="emit('failed', $event)" />
      <button v-if="canEdit" type="button" title="编辑" aria-label="编辑" :disabled="disabled" @click="emit('edit')"><LegacyIcon name="edit" :size="14" /></button>
      <button v-if="canRegenerate" type="button" title="重新生成" aria-label="重新生成" :disabled="disabled" @click="emit('regenerate')"><LegacyIcon name="undo" :size="14" /></button>
      <button v-if="canDelete && !confirming" type="button" title="删除" aria-label="删除本轮对话" :disabled="disabled" @click="confirming = true"><LegacyIcon name="trash" :size="14" /></button>
      <span v-if="confirming" class="chat-delete-confirm">删除本轮对话？<button type="button" class="danger" @click="emit('delete'); confirming = false">删除</button><button type="button" @click="confirming = false">取消</button></span>
    </div>
  </div>
</template>
