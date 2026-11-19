<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../api'
import { sessionNavigationPath } from '../sessionNavigation'
import { scopedUrl } from '../workspaceScope'
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
const router = useRouter()

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
const groups = computed(() => (['chat', 'mastery', 'reading'] as const).map(key => ({ key, label: KIND_LABELS[key], rows: visible.value[key] })).filter(group => group.rows.length))
function sessionWorkspace(row: SessionSummary) { return String(row.content_workspace_id ?? row.preferences?.workspace_id ?? '') }
function sessionUrl(id: string, row: SessionSummary, suffix = '') { return scopedUrl(`/api/sessions/${encodeURIComponent(id)}${suffix}`, sessionWorkspace(row)) }
async function listAllSessions() {
  const result: SessionSummary[] = []
  const seen = new Set<string>()
  for (let offset = 0; ; offset += 200) {
    const response = await api<{ sessions: SessionSummary[] }>(`/api/sessions?all_workspaces=true&limit=200&offset=${offset}`)
    const page = response.sessions || []
    for (const session of page) {
      const key = `${sessionWorkspace(session)}:${session.session_id}`
      if (!seen.has(key)) { seen.add(key); result.push(session) }
    }
    if (page.length < 200) return result
  }
}

async function load() {
  const [sessionResult, topicResult, collectionResult] = await Promise.all([
    listAllSessions(),
    api<{ topics?: LabeledItem[] }>('/api/mastery-paths/topics/index').catch(
      () => ({}) as { topics?: LabeledItem[] },
    ),
    api<{ collections?: LabeledItem[] }>('/api/reading/workspaces/index').catch(
      () => ({}) as { collections?: LabeledItem[] },
    ),
  ])
  sessions.value = sessionResult
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
    api(sessionUrl(row.session.session_id, row.session, '/organization'), {
      method: 'PATCH',
      body: JSON.stringify({ archived: false }),
    }),
  )
}

function remove(row: ArchivedConversation) {
  if (!window.confirm('永久删除此对话及其辅导线程？此操作无法撤销。')) return
  return mutate(`delete:${row.session.session_id}`, () =>
    api(sessionUrl(row.session.session_id, row.session), { method: 'DELETE' }),
  )
}

function deleteAll() {
  const rows = [...buckets.value.chat, ...buckets.value.mastery, ...buckets.value.reading]
  if (!window.confirm(`永久删除全部 ${rows.length} 个已归档对话及其辅导线程？此操作无法撤销。`)) return
  return mutate('all', async () => {
    for (const row of rows) {
      await api(sessionUrl(row.session.session_id, row.session), { method: 'DELETE' })
    }
  })
}
function open(row: ArchivedConversation) { void router.push(sessionNavigationPath({ id: row.session.session_id, content_workspace_id: sessionWorkspace(row.session), preferences: row.session.preferences })) }

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

    <div v-else class="archived-groups">
      <p class="archived-intro">归档只会将对话从侧栏移除，不会删除内容。取消归档后，对话会回到原来的位置。</p>
      <section v-for="group in groups" :key="group.key" class="archived-group">
        <h2><LegacyIcon :name="group.key === 'chat' ? 'chat' : group.key === 'mastery' ? 'route' : 'book'" :size="13" />{{ group.label }} <span>{{ group.rows.length }}</span></h2>
        <ul class="archived-list">
          <li v-for="row in group.rows" :key="row.session.session_id" class="archived-row">
            <button type="button" class="archived-row-main" :disabled="Boolean(busy)" @click="open(row)"><strong>{{ row.session.title || '新对话' }}</strong><small>{{ row.container }}</small></button>
            <div class="archived-row-actions">
              <button type="button" class="archived-danger" :disabled="Boolean(busy)" aria-label="永久删除" @click="remove(row)"><LegacyIcon name="trash" :size="15" /></button>
              <button type="button" :disabled="Boolean(busy)" @click="restore(row)"><LegacyIcon name="history" :size="13" />取消归档</button>
            </div>
          </li>
        </ul>
      </section>
      <p v-if="!total && !error" class="archived-empty">还没有归档对话。</p>
    </div>
  </div>
</template>
