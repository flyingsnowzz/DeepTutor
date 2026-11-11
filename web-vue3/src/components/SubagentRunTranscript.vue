<script setup lang="ts">
import { computed } from 'vue'
import { subagentMeta, visibleSubagentEvents, type SubagentEvent } from '../subagentTrace'

const props = defineProps<{ events: SubagentEvent[] }>()
const visible = computed(() => visibleSubagentEvents(props.events))
function channel(event: SubagentEvent) {
  return String(subagentMeta(event).subagent_channel || 'log')
}
function text(event: SubagentEvent) {
  return event.content || ''
}
function toolLines(value: string) {
  return value.split('\n').slice(0, 3).join('\n')
}
</script>

<template>
  <div class="subagent-transcript">
    <div v-if="!visible.length" class="subagent-empty">…</div>
    <template v-for="(event, index) in visible" :key="index">
      <section v-if="['question', 'user_question'].includes(channel(event))" class="subagent-question">
        <h4>{{ channel(event) === 'user_question' ? '你问' : 'DeepTutor 问' }}</h4>
        <p>{{ text(event) }}</p>
      </section>
      <p v-else-if="['text', 'result'].includes(channel(event))" class="subagent-line"><i>●</i>{{ text(event) }}</p>
      <p v-else-if="channel(event) === 'tool'" class="subagent-line tool"><i>●</i>{{ text(event) }}</p>
      <p v-else-if="channel(event) === 'reasoning'" class="subagent-reasoning">{{ text(event) }}</p>
      <details v-else-if="channel(event) === 'tool_result'" class="subagent-tool-result">
        <summary>工具输出</summary>
        <pre>{{ text(event) }}</pre>
        <small v-if="text(event).split('\n').length > 3">已折叠 {{ text(event).split('\n').length - 3 }} 行</small>
      </details>
      <p v-else-if="channel(event) === 'error'" class="subagent-error">{{ text(event) }}</p>
      <p v-else class="subagent-log">{{ text(event) }}</p>
    </template>
  </div>
</template>
