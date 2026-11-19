<script setup lang="ts">
import { ref, watch } from 'vue'
import { api } from '../api'

type Usage = { profile_id: string; model_id: string; name: string; workspace_name?: string }
const props = defineProps<{ profileId: string; modelId: string; language?: string }>()
const usage = ref<Usage[] | null>(null)
const error = ref(false)
const attempt = ref(0)
const tr = (zh: string, en: string) => (props.language || 'zh').toLowerCase().startsWith('zh') ? zh : en

watch(() => [props.profileId, props.modelId, attempt.value], (_value, _old, onCleanup) => {
  let cancelled = false
  onCleanup(() => { cancelled = true })
  usage.value = null
  error.value = false
  void api<{ knowledge_bases: Usage[] }>('/api/knowledge-bases/embedding-usage')
    .then(payload => {
      if (!cancelled) usage.value = (payload.knowledge_bases || []).filter(row => row.profile_id === props.profileId && row.model_id === props.modelId)
    })
    .catch(() => { if (!cancelled) error.value = true })
}, { immediate: true })
</script>

<template>
  <section class="embedding-model-usage" :aria-label="tr('使用此模型的知识库', 'Knowledge bases using this model')">
    <h3>{{ tr('使用此模型的知识库', 'Knowledge bases using this model') }}<template v-if="usage"> ({{ usage.length }})</template></h3>
    <template v-if="error">
      <p role="alert">{{ tr('加载嵌入模型使用情况失败', 'Failed to load embedding model usage') }}</p>
      <p class="muted">{{ tr('此列表显示知识库引用，而非模型连接状态。', 'This list shows knowledge base references, not the model connection status.') }}</p>
      <button type="button" @click="attempt++">{{ tr('重试', 'Retry') }}</button>
    </template>
    <p v-else-if="!usage">{{ tr('加载中…', 'Loading...') }}</p>
    <p v-else-if="usage.length === 0" class="muted">{{ tr('没有知识库使用此模型。', 'No knowledge bases use this model.') }}</p>
    <template v-else>
      <ul><li v-for="(row, index) in usage" :key="`${row.workspace_name}:${row.name}:${index}`">{{ row.name }}<template v-if="row.workspace_name"> · {{ row.workspace_name }}</template></li></ul>
      <p class="warning">{{ tr('可以删除此模型，但这些知识库需要更换嵌入模型后才能再次使用；文档和索引会保留。', 'Deleting this model is allowed. These knowledge bases will need another embedding model before they can be used again. Their documents and indexes will be preserved.') }}</p>
    </template>
  </section>
</template>

<style scoped>
.embedding-model-usage { border: 1px solid var(--border); border-radius: 8px; padding: 12px; font-size: 12px; display: grid; gap: 8px; }
h3 { margin: 0; font-weight: 600; }
p, ul { margin: 0; }
ul { padding-left: 18px; }
.muted { color: var(--muted-foreground); }
.warning { color: #a16207; }
button { justify-self: start; border: 1px solid var(--border); border-radius: 6px; padding: 6px 12px; }
</style>
