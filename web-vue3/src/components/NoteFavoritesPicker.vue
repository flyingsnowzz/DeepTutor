<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { api } from '../api'
import LegacyIcon from './LegacyIcon.vue'
import MarkdownView from './MarkdownView.vue'
import type { FavoriteItem } from '../notes/noteTypes'

interface Notebook { id: string; name: string; color?: string; unreadable?: boolean }
interface RecordItem { id: string; type: string; title: string; summary?: string; output?: string; created_at?: number; metadata?: Record<string, unknown> }
const emit = defineEmits<{
  close: []
  insert: [items: FavoriteItem[]]
  synthesize: [sources: string]
}>()
const dialog = ref<HTMLElement | null>(null)
const searchInput = ref<HTMLInputElement | null>(null)
const collections = ref<Notebook[]>([])
const items = ref<FavoriteItem[]>([])
const collection = ref('')
const kind = ref('')
const query = ref('')
const picked = ref<string[]>([])
const preview = ref('')
const loading = ref(true)
const error = ref('')
let previousFocus: HTMLElement | null = null
let previousOverflow = ''
const keyOf = (item: FavoriteItem) => `${item.collection.id}/${item.id}`
const counts = computed(() => new Map(collections.value.map(item => [item.id, items.value.filter(record => record.collection.id === item.id).length])))
const scoped = computed(() => collection.value ? items.value.filter(item => item.collection.id === collection.value) : [...items.value].sort((a, b) => (b.created_at || 0) - (a.created_at || 0)))
const kinds = computed(() => [...new Set(scoped.value.map(item => item.type))])
const visible = computed(() => {
  const needle = query.value.trim().toLowerCase()
  return scoped.value.filter(item => (!kind.value || item.type === kind.value) && (!needle || `${item.title} ${item.summary || ''} ${item.output || ''}`.toLowerCase().includes(needle)))
})
const chosen = computed(() => picked.value.flatMap(key => {
  const item = items.value.find(candidate => keyOf(candidate) === key)
  return item ? [item] : []
}))
function toggle(item: FavoriteItem) {
  const key = keyOf(item)
  picked.value = picked.value.includes(key) ? picked.value.filter(value => value !== key) : [...picked.value, key]
}
function insert() { if (chosen.value.length) emit('insert', chosen.value) }
function synthesize() {
  if (!chosen.value.length) return
  emit('synthesize', chosen.value.map(item => `## ${item.title}\n\n${item.output || ''}\n\n[${item.title}](/notebooks/${encodeURIComponent(item.collection.id)}?record=${encodeURIComponent(item.id)})`).join('\n\n'))
}
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); emit('close'); return }
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.isComposing) { event.preventDefault(); insert(); return }
  if (event.key !== 'Tab' || !dialog.value) return
  const focusable = [...dialog.value.querySelectorAll<HTMLElement>('a[href], input:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])')]
  const first = focusable[0]
  const last = focusable.at(-1)
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
}
onMounted(async () => {
  previousFocus = document.activeElement as HTMLElement | null
  previousOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  document.addEventListener('keydown', onKeydown)
  void nextTick(() => searchInput.value?.focus())
  try {
    const list = (await api<{ notebooks: Notebook[] }>('/api/notebooks')).notebooks.filter(item => !item.unreadable)
    collections.value = list
    const details = await Promise.all(list.map(async notebook => {
      try { return (await api<{ records: RecordItem[] }>(`/api/notebooks/${encodeURIComponent(notebook.id)}`)).records.map(record => ({ ...record, collection: notebook })) }
      catch { return [] }
    }))
    items.value = details.flat()
  } catch { error.value = '收藏内容加载失败。' }
  finally { loading.value = false }
})
onBeforeUnmount(() => {
  document.body.style.overflow = previousOverflow
  document.removeEventListener('keydown', onKeydown)
  previousFocus?.focus()
})
</script>

<template>
  <Teleport to="body">
    <div class="dt-picker-backdrop" @mousedown.self="emit('close')">
      <div class="dt-picker-scrim" aria-hidden="true" />
      <section ref="dialog" class="relative dt-picker-dialog" role="dialog" aria-modal="true" aria-labelledby="dt-fav-picker-title" @mousedown.stop>
        <div class="dt-fav-picker">
          <header class="dt-fav-picker-head">
            <h2 id="dt-fav-picker-title">插入收藏</h2>
            <label class="dt-fav-search"><LegacyIcon name="search" :size="15" /><input ref="searchInput" v-model="query" :placeholder="collection ? `在“${collections.find(item => item.id === collection)?.name}”中搜索` : '搜索全部收藏'" aria-label="搜索收藏"><button v-if="query" aria-label="清除搜索" @click="query = ''; searchInput?.focus()"><LegacyIcon name="close" :size="13" /></button></label>
            <button class="dt-fav-icon-button" aria-label="关闭" @click="emit('close')"><LegacyIcon name="close" :size="16" /></button>
          </header>
          <div class="dt-fav-picker-body">
            <nav class="dt-fav-collections" aria-label="收藏夹">
              <button :aria-pressed="!collection" @click="collection = ''; kind = ''"><LegacyIcon name="resources" :size="15" class="dt-fav-collection-icon" /><span class="truncate">全部收藏</span><span class="dt-fav-count">{{ items.length || '' }}</span></button>
              <p v-if="collections.length" class="dt-fav-rail-label">文件夹</p>
              <button v-for="item in collections" :key="item.id" :aria-pressed="collection === item.id" @click="collection = item.id; kind = ''"><span class="dt-fav-dot" :style="{ background: item.color || 'var(--folder-default)' }" /><span class="truncate">{{ item.name }}</span><span class="dt-fav-count">{{ counts.get(item.id) || 0 }}</span></button>
            </nav>
            <section class="dt-fav-records" :aria-busy="loading">
              <div v-if="kinds.length > 1" class="dt-fav-chips" role="group" aria-label="类型"><button :aria-pressed="!kind" @click="kind = ''">全部</button><button v-for="value in kinds" :key="value" :aria-pressed="kind === value" @click="kind = kind === value ? '' : value">{{ value }}</button></div>
              <div v-if="loading" class="dt-fav-skeleton" role="status" aria-label="加载中"><span v-for="index in 4" :key="index" /></div>
              <p v-else-if="error" role="alert" class="dt-fav-empty is-error">{{ error }}</p>
              <p v-else-if="!visible.length" class="dt-fav-empty">{{ query ? '没有匹配的收藏内容。' : '这个收藏夹还没有内容。' }}</p>
              <ul class="dt-fav-list">
                <li v-for="item in visible" :key="keyOf(item)" :class="{ 'is-picked': picked.includes(keyOf(item)) }">
                  <div class="dt-fav-row">
                    <label class="dt-fav-row-main"><input class="legacy-sr-only" type="checkbox" :checked="picked.includes(keyOf(item))" :aria-label="`选择 ${item.title}`" @change="toggle(item)"><span class="dt-fav-check"><span v-if="picked.includes(keyOf(item))">{{ picked.indexOf(keyOf(item)) + 1 }}</span></span><span class="dt-fav-kind" :data-kind="item.type"><LegacyIcon name="bookmark" :size="16" /></span><span class="min-w-0 flex-1"><span class="dt-fav-title">{{ item.title || '收藏内容' }}</span><span v-if="item.summary" class="dt-fav-summary">{{ item.summary }}</span><span class="dt-fav-meta">{{ item.type }}<template v-if="!collection"> · {{ item.collection.name }}</template></span></span></label>
                    <button class="dt-fav-preview-toggle" :aria-expanded="preview === keyOf(item)" @click="preview = preview === keyOf(item) ? '' : keyOf(item)">{{ preview === keyOf(item) ? '收起' : '预览' }}<LegacyIcon name="chevronDown" :size="13" :class="{ 'rotate-180': preview === keyOf(item) }" /></button>
                  </div>
                  <div v-if="preview === keyOf(item)" class="dt-fav-preview"><MarkdownView :content="item.output || ''" /></div>
                </li>
              </ul>
            </section>
          </div>
          <footer class="dt-fav-picker-foot">
            <span class="dt-fav-selection" aria-live="polite"><template v-if="chosen.length">已选择 {{ chosen.length }} 项<span v-if="chosen.length > 1" class="dt-fav-hint"> · 按选择顺序插入</span><button @click="picked = []">清空</button></template><span v-else class="dt-fav-hint">选择一条或多条收藏，放到当前页面。</span></span>
            <button class="dt-fav-button" @click="emit('close')">取消</button>
            <button class="dt-fav-button" :disabled="loading || !chosen.length" @click="synthesize"><LegacyIcon name="sparkles" :size="14" />整理成笔记</button>
            <button class="dt-fav-button is-primary" :disabled="loading || !chosen.length" @click="insert">{{ chosen.length > 1 ? `插入 ${chosen.length} 项` : '插入' }}</button>
          </footer>
        </div>
      </section>
    </div>
  </Teleport>
</template>
