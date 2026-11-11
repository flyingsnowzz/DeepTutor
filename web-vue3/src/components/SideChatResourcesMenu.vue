<script setup lang="ts">
import { computed } from 'vue'
import LegacyIcon from './LegacyIcon.vue'
import ResourceReuseToggle from './ResourceReuseToggle.vue'
import type { ResourceReusePolicy } from '../resourceReuse'

export interface SideChatResourceValue {
  modelId: string
  persona: string
  knowledgeBases: string[]
  skills: string[]
  mcp: string[]
}

const props = withDefaults(defineProps<{
  modelValue: SideChatResourceValue
  llmOptions?: Array<{ profile_id: string; model_id: string; profile_name?: string; model_name?: string }>
  knowledgeBases?: Array<{ name: string; metadata?: { type?: string } }>
  skills?: Array<{ id: string; name: string }>
  mcp?: Array<{ id: string; name: string }>
  personas?: Array<{ id: string; name: string }>
  referenceCounts?: Record<string, number>
  reuse: ResourceReusePolicy
}>(), {
  llmOptions: () => [],
  knowledgeBases: () => [],
  skills: () => [],
  mcp: () => [],
  personas: () => [],
  referenceCounts: () => ({}),
})
const emit = defineEmits<{
  'update:modelValue': [value: SideChatResourceValue]
  'update:reuse': [value: ResourceReusePolicy]
  pick: [kind: 'questions' | 'notebooks' | 'books' | 'reading' | 'history' | 'memory']
}>()

const visibleKnowledgeBases = computed(() =>
  props.knowledgeBases.filter(item => !['subagent', 'partner'].includes(String(item.metadata?.type || ''))),
)
const selectedCount = computed(() =>
  (props.modelValue.modelId ? 1 : 0) +
  (props.modelValue.persona ? 1 : 0) +
  props.modelValue.knowledgeBases.length +
  props.modelValue.skills.length +
  props.modelValue.mcp.length +
  Object.values(props.referenceCounts).reduce((total, count) => total + count, 0),
)

function update(patch: Partial<SideChatResourceValue>) {
  emit('update:modelValue', { ...props.modelValue, ...patch })
}
function toggle(key: 'knowledgeBases' | 'skills' | 'mcp', value: string) {
  const current = props.modelValue[key]
  update({
    [key]: current.includes(value)
      ? current.filter(item => item !== value)
      : [...current, value],
  })
}
function setReuse(kind: 'knowledge' | 'persona' | 'skills' | 'mcp', enabled: boolean) {
  emit('update:reuse', { ...props.reuse, [kind]: enabled })
}
</script>

<template>
  <details class="side-chat-resources">
    <summary><LegacyIcon name="resources" :size="14" />资源与模型<span v-if="selectedCount">{{ selectedCount }}</span></summary>
    <div class="side-chat-resource-body">
      <label v-if="llmOptions.length">模型
        <select :value="modelValue.modelId" @change="update({ modelId: ($event.target as HTMLSelectElement).value })">
          <option value="">系统默认</option>
          <option v-for="option in llmOptions" :key="`${option.profile_id}:${option.model_id}`" :value="`${option.profile_id}:${option.model_id}`">
            {{ option.profile_name || option.profile_id }} · {{ option.model_name || option.model_id }}
          </option>
        </select>
      </label>
      <label v-if="personas.length" class="side-chat-resource-row">Persona
        <span class="side-chat-resource-control">
          <select :value="modelValue.persona" @change="update({ persona: ($event.target as HTMLSelectElement).value })">
            <option value="">不使用</option>
            <option v-for="persona in personas" :key="persona.id" :value="persona.id">{{ persona.name }}</option>
          </select>
          <ResourceReuseToggle :every-turn="reuse.persona" @update:every-turn="setReuse('persona', $event)" />
        </span>
      </label>
      <fieldset v-if="visibleKnowledgeBases.length">
        <legend><span>知识库</span><ResourceReuseToggle :every-turn="reuse.knowledge" @update:every-turn="setReuse('knowledge', $event)" /></legend>
        <label v-for="item in visibleKnowledgeBases" :key="item.name"><input type="checkbox" :checked="modelValue.knowledgeBases.includes(item.name)" @change="toggle('knowledgeBases', item.name)">{{ item.name }}</label>
      </fieldset>
      <fieldset v-if="skills.length">
        <legend><span>技能</span><ResourceReuseToggle :every-turn="reuse.skills" @update:every-turn="setReuse('skills', $event)" /></legend>
        <label v-for="item in skills" :key="item.id"><input type="checkbox" :checked="modelValue.skills.includes(item.id)" @change="toggle('skills', item.id)">{{ item.name }}</label>
      </fieldset>
      <fieldset v-if="mcp.length">
        <legend><span>MCP</span><ResourceReuseToggle :every-turn="reuse.mcp" @update:every-turn="setReuse('mcp', $event)" /></legend>
        <label v-for="item in mcp" :key="item.id"><input type="checkbox" :checked="modelValue.mcp.includes(item.id)" @change="toggle('mcp', item.id)">{{ item.name }}</label>
      </fieldset>
      <fieldset class="side-chat-reference-actions"><legend>引用</legend>
        <button type="button" @click="emit('pick', 'questions')">题库<span v-if="referenceCounts.questions">{{ referenceCounts.questions }}</span></button>
        <button type="button" @click="emit('pick', 'notebooks')">收藏<span v-if="referenceCounts.notebooks">{{ referenceCounts.notebooks }}</span></button>
        <button type="button" @click="emit('pick', 'books')">书籍<span v-if="referenceCounts.books">{{ referenceCounts.books }}</span></button>
        <button type="button" @click="emit('pick', 'reading')">阅读<span v-if="referenceCounts.reading">{{ referenceCounts.reading }}</span></button>
        <button type="button" @click="emit('pick', 'history')">历史<span v-if="referenceCounts.history">{{ referenceCounts.history }}</span></button>
        <button type="button" @click="emit('pick', 'memory')">记忆<span v-if="referenceCounts.memory">{{ referenceCounts.memory }}</span></button>
      </fieldset>
    </div>
  </details>
</template>
