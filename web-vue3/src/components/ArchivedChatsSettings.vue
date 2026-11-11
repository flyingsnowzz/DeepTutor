<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { api } from '../api'
import LegacyIcon from './LegacyIcon.vue'
import {
  archiveCount,
  collectArchivedConversations,
  type ArchiveBuckets,
  type ArchiveKind,
  type ArchivedConversation,
  type LabeledItem,
  type SessionSummary,
} from '../sessionArchive'

type KindFilter = ArchiveKind | 'all'

const sessions = ref<SessionSummary[]>([])
const topics = ref<LabeledItem[]>([])
const collections = ref<LabeledItem[]>([])
const loading = ref(true)
const error = ref('')
const busy = ref<string | null>(null)
const query = ref('')
const kind = ref<KindFilter>('all')

const KIND_LABELS: Record<ArchiveKind, string> = {
  chat: '对话',
  mastery: '精通之路',
  reading: '沉浸阅读',
}

const buckets = computed<ArchiveBuckets>(() =>
  collectArchivedConversations({
    sessions: sessions.value,
    masteryTopics: topics.value,
    readingCollections: collections.value,
  }),
)

const visible = computed<ArchiveBuckets>(() => {
  const needle = query.value.trim().toLocaleLowerCase()
  const result: ArchiveBuckets = { chat: [], mastery: [], reading: [] }
  ;(['chat', 'mastery', 'reading'] as const).forEach(key => {
    if (kind.value !== 'all' && kind.value !== key) return
    result[key] = buckets.value[key].filter(({ session, container }) =>
      [session.title, (session as { last_message?: string }).last_message, container]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase()
        .includes(needle),
    )
  })
  return result
})

const total = computed(() => archiveCount(buckets.value))
const visibleCount = computed(() => archiveCount(visible.value))
const visibleRows = computed<ArchivedConversation[]>(() => [
  ...visible.value.chat,
  ...visible.value.mastery,
  ...visible.value.reading,
])

async function load() {
  const [sessionResult, topicResult, collectionResult] = await Promise.all([
    api<{ sessions: SessionSummary[] }>('/api/sessions?all_workspaces=true&limit=200'),
    api<{ topics?: LabeledItem[] }>('/api/mastery-paths/topics/index').catch(
      () => ({}) as { topics?: LabeledItem[] },
    ),
    api<{ collections?: LabeledItem[] }>('/api/reading/workspaces/index').catch(
      () => ({}) as { collections?: LabeledItem[] },
    ),
  ])
  sessions.value = sessionResult.sessions || []
  topics.value = (topicResult.topics || []).map(item => { const row = item as unknown as Record<string, unknown>; return { id: String(item.id || row.path_id || ''), name: item.name } })
  collections.value = (collectionResult.collections || []).map(item => { const row = item as unknown as Record<string, unknown>; return { id: String(item.id || row.workspace_id || ''), title: item.title } })
}

async function refresh() {
  loading.value = true
  error.value = ''
  try {
    await load()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '无法加载已归档对话，请重试。'
  } finally {
    loading.value = false
  }
}

async function mutate(id: string, operation: () => Promise<void>) {
  if (busy.value) return
  busy.value = id
  error.value = ''
  try {
    await operation()
    await load()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '部分操作未完成，请刷新后重试。'
  } finally {
    busy.value = null
  }
}

function restore(row: ArchivedConversation) {
  return mutate(`restore:${row.session.session_id}`, () =>
    api(`/api/sessions/${encodeURIComponent(row.session.session_id)}/organization`, {
      method: 'PATCH',
      body: JSON.stringify({ archived: false }),
    }),
  )
}

function remove(row: ArchivedConversation) {
  if (!window.confirm('永久删除此对话及其辅导线程？此操作无法撤销。')) return
  return mutate(`delete:${row.session.session_id}`, () =>
    api(`/api/sessions/${encodeURIComponent(row.session.session_id)}`, { method: 'DELETE' }),
  )
}

function deleteAll() {
  const ids = [...buckets.value.chat, ...buckets.value.mastery, ...buckets.value.reading].map(
    row => row.session.session_id,
  )
  if (!window.confirm(`永久删除全部 ${ids.length} 个已归档对话及其辅导线程？此操作无法撤销。`)) return
  return mutate('all', async () => {
    for (const id of ids) {
      await api(`/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' })
    }
  })
}

onMounted(refresh)
</script>

<template>
  <div class="archived-chats">
    <header class="archived-chats-head">
      <div>
        <h1>已归档的聊天</h1>
        <p>搜索、取消归档或永久删除已归档的对话。</p>
      </div>
      <button type="button" class="archived-delete-all" :disabled="loading || Boolean(busy) || !total" @click="deleteAll">
        <LegacyIcon name="trash" :size="15" />删除全部（{{ total }}）
      </button>
    </header>

    <div class="archived-filters">
      <label class="archived-search">
        <LegacyIcon name="search" :size="16" />
        <input v-model="query" type="search" aria-label="搜索已归档对话" placeholder="搜索已归档对话" />
      </label>
      <select v-model="kind" aria-label="按对话类型筛选" class="archived-kind">
        <option value="all">全部类型</option>
        <option value="chat">对话</option>
        <option value="mastery">精通之路</option>
        <option value="reading">沉浸阅读</option>
      </select>
      <button type="button" class="archived-refresh" :disabled="loading || Boolean(busy)" aria-label="刷新" @click="refresh">
        <LegacyIcon name="history" :size="16" />
      </button>
    </div>

    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="loading" class="archived-loading">加载中…</p>
    <p v-else-if="total > 0 && visibleCount === 0" class="archived-empty">没有匹配搜索条件的已归档对话。</p>

    <ul v-else-if="visibleRows.length" class="archived-list">
      <li v-for="row in visibleRows" :key="row.session.session_id" class="archived-row">
        <div class="archived-row-main">
          <span class="archived-row-kind">{{ KIND_LABELS[row.kind] }}</span>
          <strong>{{ row.session.title || '未命名对话' }}</strong>
          <small v-if="row.container" class="archived-container">{{ row.container }}</small>
        </div>
        <div class="archived-row-actions">
          <button type="button" :disabled="busy === `restore:${row.session.session_id}`" @click="restore(row)">
            <LegacyIcon name="history" :size="14" />取消归档
          </button>
          <button type="button" class="archived-danger" :disabled="busy === `delete:${row.session.session_id}`" @click="remove(row)">
            <LegacyIcon name="trash" :size="14" />删除
          </button>
        </div>
      </li>
    </ul>
  </div>
</template>
