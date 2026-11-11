<script setup lang="ts">
import { ref } from 'vue'
import { api, post } from '../api'
import { scopedUrl } from '../workspaceScope'

interface Preview { token: string | null; total: number; valid: number; errors: { row: number; message: string }[]; samples: { question: string; correct_answer: string; tags: string[] }[] }
const props = withDefaults(defineProps<{ initialTarget?: 'bank' | 'mistakes' }>(), { initialTarget: 'bank' })
const emit = defineEmits<{ close: []; imported: [message: string] }>()
const target = ref<'bank' | 'mistakes'>(props.initialTarget)
const preview = ref<Preview | null>(null)
const filename = ref('')
const busy = ref(false)
const error = ref('')
const root = '/api/question-notebook/practice'
async function select(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || busy.value) return
  busy.value = true; error.value = ''; preview.value = null; filename.value = file.name
  try { const data = new FormData(); data.append('file', file); data.append('target', target.value); preview.value = await api<Preview>(`${root}/import/preview`, { method: 'POST', body: data }) }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '预览失败' }
  finally { busy.value = false }
}
async function commit() {
  if (!preview.value?.token || busy.value) return
  busy.value = true; error.value = ''
  try { const result = await post<{ created: number; duplicates: number }>(`${root}/import/commit`, { token: preview.value.token }); emit('imported', `已导入 ${result.created} 道题，跳过 ${result.duplicates} 道重复题。`) }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '导入失败' }
  finally { busy.value = false }
}
async function download(format: 'csv' | 'xlsx') {
  try { const response = await fetch(scopedUrl(`${root}/import/template?format=${format}`), { credentials: 'include' }); if (!response.ok) throw new Error(`HTTP ${response.status}`); const url = URL.createObjectURL(await response.blob()); const link = document.createElement('a'); link.href = url; link.download = `practice-template.${format}`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000) }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '模板下载失败' }
}
</script>

<template>
  <section class="practice-import" aria-labelledby="practice-import-title">
    <div class="practice-import-header">
      <h2 id="practice-import-title"><span aria-hidden="true">▧</span>导入题目</h2>
      <button type="button" :disabled="busy" aria-label="关闭导入" @click="emit('close')">×</button>
    </div>
    <p class="practice-import-description">支持 XLSX、CSV、TSV 和 JSON；每个文件最多 500 道题、5 MB。XLSX 使用当前工作表，支持中英文列名。</p>
    <div class="practice-import-controls">
      <label>导入到 <select v-model="target" :disabled="busy" @change="preview = null; filename = ''"><option value="bank">题库</option><option value="mistakes">错题</option></select></label>
      <button type="button" @click="download('xlsx')"><span aria-hidden="true">↓</span>下载 XLSX 模板</button>
      <button type="button" @click="download('csv')"><span aria-hidden="true">↓</span>下载 CSV 模板</button>
    </div>
    <label class="practice-import-file">
      <strong>选择题目文件</strong>
      <input type="file" accept=".xlsx,.csv,.tsv,.json" :disabled="busy" @change="select" />
      <small>题目和答案为必填项。使用标签整理题目，确认预览后才会保存。</small>
    </label>
    <p v-if="busy" class="practice-import-status" role="status"><span aria-hidden="true">◌</span>正在处理…</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <div v-if="preview" class="practice-import-preview">
      <p class="practice-import-preview-file">{{ filename }} · {{ preview.valid }} / {{ preview.total }} 行有效</p>
      <div v-if="preview.errors.length" class="practice-import-errors error" role="alert">
        <p>尚未导入，请修正以下行并重新选择文件：</p>
        <p v-for="issue in preview.errors" :key="issue.row">第 {{ issue.row }} 行：{{ issue.message }}</p>
      </div>
      <ol>
        <li v-for="(sample, index) in preview.samples" :key="index"><strong>{{ sample.question }}</strong><small>答案：{{ sample.correct_answer }}{{ sample.tags.length ? ` · ${sample.tags.join(' / ')}` : '' }}</small></li>
      </ol>
      <p>已有题目会保留，重复题会跳过并合并标签。</p>
      <button type="button" class="primary" :disabled="busy || !preview.token" @click="commit">确认导入</button>
    </div>
  </section>
</template>
