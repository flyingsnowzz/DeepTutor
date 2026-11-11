<script setup lang="ts">
import { computed } from 'vue'
import {
  phaseLabel,
  selectAttachmentProcessing,
  type ProcessingMessage,
} from '../attachmentProcessing'

const props = defineProps<{
  messages: ProcessingMessage[]
  streaming: boolean
}>()

const items = computed(() => selectAttachmentProcessing(props.messages, props.streaming))
</script>

<template>
  <div v-if="items.length" class="attachment-processing" aria-live="polite">
    <h4>附件处理</h4>
    <ul>
      <li
        v-for="item in items"
        :key="item.attachmentId"
        class="attachment-processing-row"
        :class="`phase-${item.phase}`"
      >
        <span class="attachment-processing-dot" aria-hidden="true" />
        <span class="attachment-processing-name">{{ item.filename }}</span>
        <em class="attachment-processing-phase">{{ phaseLabel(item.phase) }}</em>
        <small v-if="item.detail" class="attachment-processing-detail">{{ item.detail }}</small>
      </li>
    </ul>
  </div>
</template>
