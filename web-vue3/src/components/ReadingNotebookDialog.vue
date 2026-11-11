<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api, post } from '../api'

interface Notebook { id: string; name: string; record_count?: number; unreadable?: boolean }
const props = defineProps<{ workspaceId: string }>()
const emit = defineEmits<{ close: []; saved: [] }>()
const notebooks = ref<Notebook[]>([])
const selected = ref<string[]>([])
const loading = ref(true)
const saving = ref(false)
const error = ref('')
onMounted(async () => {
  try { notebooks.value = (await api<{ notebooks: Notebook[] }>('/api/notebooks')).notebooks.filter(item => !item.unreadable) }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '收藏夹加载失败' }
  finally { loading.value = false }
})
function toggle(id: string) { selected.value = selected.value.includes(id) ? selected.value.filter(item => item !== id) : [...selected.value, id] }
async function save() {
  if (!selected.value.length || saving.value) return
  saving.value = true
  error.value = ''
  try { await post(`/api/reading/workspaces/${encodeURIComponent(props.workspaceId)}/notebook`, { notebook_ids: selected.value, material_ids: [] }); emit('saved') }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '保存失败' }
  finally { saving.value = false }
}
</script>

<template>
  <div class="reading-dialog-overlay" @mousedown.self="!saving && emit('close')"><section class="reading-notebook-dialog" role="dialog" aria-modal="true" aria-label="发送阅读笔记到收藏夹"><header><h2>发送阅读笔记到收藏夹</h2><button aria-label="关闭" :disabled="saving" @click="emit('close')">×</button></header><p>高亮和笔记会按来源与页码整理后复制，原始资料仍只保留在当前阅读集合中。</p><div class="reading-notebook-list"><p v-if="loading" role="status">正在加载收藏夹…</p><template v-else><button v-for="notebook in notebooks" :key="notebook.id" type="button" :aria-pressed="selected.includes(notebook.id)" @click="toggle(notebook.id)"><span>{{ selected.includes(notebook.id) ? '✓' : '' }}</span><strong>{{ notebook.name }}</strong><small>{{ notebook.record_count || 0 }}</small></button><p v-if="!notebooks.length" class="muted">请先创建一个收藏夹。</p></template></div><p v-if="error" class="error" role="alert">{{ error }}</p><footer><button :disabled="saving" @click="emit('close')">取消</button><button class="primary" :disabled="!selected.length || saving" @click="save">{{ saving ? '发送中…' : '发送到收藏夹' }}</button></footer></section></div>
</template>
