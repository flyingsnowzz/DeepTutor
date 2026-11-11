<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '../api'
import { sessionNavigationPath } from '../sessionNavigation'
import LegacyIcon from '../components/LegacyIcon.vue'

interface Session {
  id: string; session_id?: string; title: string; updated_at?: string | number; capability?: string
  content_workspace_id?: string; preferences?: Record<string, unknown>; status?: string
}
interface ArchiveRow { session: Session; container: string }
interface ArchiveGroup { id: string; label: string; icon: string; rows: ArchiveRow[] }
interface TaskBoard {
  cards: Array<{ id: string; status: 'todo' | 'doing' | 'done'; archived: boolean }>
  colors: Record<'todo' | 'doing' | 'done', string>
  session_links: Array<{ workspace_id: string; session_id: string; task_ids: string[]; status_link_enabled: boolean }>
}
const route = useRoute()
const router = useRouter()
const sessions = ref<Session[]>([])
const results = ref<Session[]>([])
const taskBoard = ref<TaskBoard | null>(null)
const masteryTopics = ref<Array<{ path_id: string; name: string }>>([])
const readingCollections = ref<Array<{ workspace_id: string; title: string }>>([])
const query = ref('')
const searchVersion = ref(0)
const archive = ref<'active' | 'archived' | 'all'>(route.query.archive === 'archived' ? 'archived' : route.query.archive === 'all' ? 'all' : 'active')
const kind = ref<'all' | 'chat' | 'selection_tutor'>('all')
const loading = ref(false)
const searching = ref(false)
const busyId = ref('')
const editingSession = ref('')
const draftTitle = ref('')
const error = ref('')
const historyMenuOpen = ref(false)
const openActions = ref('')
interface MenuPosition { left: number; top: number; maxHeight: number; openUpward: boolean }
const menuPosition = ref<MenuPosition | null>(null)
let searchTimer: ReturnType<typeof setTimeout> | undefined
let generation = 0
const visible = computed(() => (query.value.trim() ? results.value : sessions.value).filter(session => {
  const prefs = session.preferences ?? {}
  if (archive.value !== 'all' && Boolean(prefs.archived) !== (archive.value === 'archived')) return false
  if (kind.value !== 'all' && (prefs.session_kind === 'selection_tutor' ? 'selection_tutor' : 'chat') !== kind.value) return false
  return true
}).sort((a, b) => Number(Boolean(b.preferences?.pinned)) - Number(Boolean(a.preferences?.pinned)) || timeValue(b.updated_at) - timeValue(a.updated_at)))
function idOf(session: Session) { return session.session_id || session.id }
function isPlaceholderTitle(title?: string) { const value = (title || '').trim(); return !value || value === 'New conversation' }
function displayTitle(title?: string) { return isPlaceholderTitle(title) ? '新对话' : (title || '').trim() }
function workspaceOf(session: Session) { return session.content_workspace_id || String(session.preferences?.workspace_id || '') }
function markColor(session: Session) {
  const color = taskColor(session)
  if (color) return color
  return session.status === 'failed' || session.status === 'rejected' ? '#f59e0b' : ''
}
function taskColor(session: Session) {
  const board = taskBoard.value
  if (!board) return ''
  const workspace = workspaceOf(session)
  const link = board.session_links?.find(row => row.session_id === idOf(session) && row.workspace_id === workspace)
  if (!link?.status_link_enabled) return ''
  const card = board.cards?.find(row => row.id === link.task_ids?.at(-1))
  return card ? board.colors?.[card.status] || '' : ''
}
function timeValue(value?: string | number) {
  if (value === undefined) return 0
  const numeric = typeof value === 'number' ? (value < 1e12 ? value * 1000 : value) : Date.parse(value)
  return Number.isNaN(numeric) ? 0 : numeric
}
function timeLabel(value?: string | number) {
  if (value === undefined || value === null) return ''
  const date = new Date(typeof value === 'number' ? (value < 1e12 ? value * 1000 : value) : value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' })
}
function relativeTime(value?: string | number) {
  if (value === undefined || value === null) return ''
  const timestamp = timeValue(value) / 1000
  if (!timestamp) return ''
  const diffSeconds = Math.round(timestamp - Date.now() / 1000)
  const formatter = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' })
  const abs = Math.abs(diffSeconds)
  if (abs < 60) return formatter.format(diffSeconds, 'second')
  if (abs < 3600) return formatter.format(Math.round(diffSeconds / 60), 'minute')
  if (abs < 86400) return formatter.format(Math.round(diffSeconds / 3600), 'hour')
  if (abs < 604800) return formatter.format(Math.round(diffSeconds / 86400), 'day')
  if (abs < 2592000) return formatter.format(Math.round(diffSeconds / 604800), 'week')
  if (abs < 31536000) return formatter.format(Math.round(diffSeconds / 2592000), 'month')
  return formatter.format(Math.round(diffSeconds / 31536000), 'year')
}
function archiveMeta(row: ArchiveRow) {
  return [row.container, relativeTime(row.session.updated_at)].filter(Boolean).join(' · ')
}
const archiveGroups = computed<ArchiveGroup[]>(() => {
  const groups: ArchiveGroup[] = [
    { id: 'chat', label: '聊天', icon: 'chat', rows: [] },
    { id: 'mastery', label: '精通之路', icon: 'route', rows: [] },
    { id: 'reading', label: '沉浸式阅读', icon: 'bookText', rows: [] },
  ]
  const archivedIds = new Set(visible.value.filter(session => Boolean(session.preferences?.archived)).map(idOf))
  for (const session of visible.value) {
    if (!session.preferences?.archived) continue
    const parentId = String(session.preferences.parent_session_id || '')
    if (parentId && archivedIds.has(parentId)) continue
    const preferences = session.preferences
    if (preferences.workspace_mode === 'mastery_path') {
      const pathId = String(preferences.mastery_path_id || '')
      if (pathId) {
        groups[1].rows.push({ session, container: masteryTopics.value.find(topic => topic.path_id === pathId)?.name || '' })
        continue
      }
    }
    if (preferences.workspace_mode === 'immersive_reading') {
      const workspaceId = String(preferences.reading_workspace_id || '')
      if (workspaceId) {
        groups[2].rows.push({ session, container: readingCollections.value.find(collection => collection.workspace_id === workspaceId)?.title || '' })
        continue
      }
    }
    groups[0].rows.push({ session, container: '' })
  }
  for (const group of groups) group.rows.sort((a, b) => timeValue(b.session.updated_at) - timeValue(a.session.updated_at))
  return groups.filter(group => group.rows.length)
})
function scopedPath(session: Session, suffix = '') {
  const path = `/api/sessions/${encodeURIComponent(idOf(session))}${suffix}`
  const workspace = session.content_workspace_id || String(session.preferences?.workspace_id || '')
  return workspace ? `${path}?dt_workspace=${encodeURIComponent(workspace)}` : path
}
async function list(quiet = false) {
  if (!quiet) loading.value = true; error.value = ''
  try {
    const next: Session[] = []
    const seen = new Set<string>()
    for (let offset = 0; ; offset += 200) {
      const page = await api<{ sessions: Session[] }>(`/api/sessions?limit=200&offset=${offset}&all_workspaces=true`)
      for (const session of page.sessions || []) {
        const key = `${session.content_workspace_id || ''}:${idOf(session)}`
        if (!seen.has(key)) { seen.add(key); next.push(session) }
      }
      if ((page.sessions || []).length < 200) break
    }
    sessions.value = next
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '会话加载失败' }
  finally { if (!quiet) loading.value = false }
}
async function loadArchiveLabels() {
  const [topics, collections] = await Promise.all([
    api<{ topics?: Array<{ path_id: string; name: string }> }>('/api/mastery-paths/topics/index').catch(() => ({ topics: [] })),
    api<{ collections?: Array<{ workspace_id: string; title: string }> }>('/api/reading/workspaces/index').catch(() => ({ collections: [] })),
  ])
  masteryTopics.value = topics.topics || []
  readingCollections.value = collections.collections || []
}
onMounted(() => { document.addEventListener('click', closeActions); window.addEventListener('resize', closeActions); window.addEventListener('scroll', closeActions, true); void list(); void loadArchiveLabels(); void api<TaskBoard>('/api/task-board').then(board => { taskBoard.value = board }).catch(() => {}) })
onUnmounted(() => { if (searchTimer) clearTimeout(searchTimer); generation++; document.removeEventListener('click', closeActions); window.removeEventListener('resize', closeActions); window.removeEventListener('scroll', closeActions, true) })
function closeActions() { openActions.value = ''; menuPosition.value = null; historyMenuOpen.value = false }
function toggleActions(session: Session, event: MouseEvent) {
  const anchor = (event.currentTarget as HTMLElement).getBoundingClientRect()
  if (openActions.value === idOf(session)) { closeActions(); return }
  const menuWidth = 240; const menuGap = 8; const viewportMargin = 12
  const preferredHeight = Math.min(380, window.innerHeight - viewportMargin * 2)
  const roomBelow = window.innerHeight - anchor.bottom - menuGap - viewportMargin
  const roomAbove = anchor.top - menuGap - viewportMargin
  const openUpward = roomBelow < preferredHeight && roomAbove > roomBelow
  const maxHeight = Math.max(140, Math.min(preferredHeight, openUpward ? roomAbove : roomBelow))
  const roomRight = window.innerWidth - anchor.right - menuGap - viewportMargin
  const roomLeft = anchor.left - menuGap - viewportMargin
  const preferredLeft = roomRight >= menuWidth || roomRight >= roomLeft ? anchor.right + menuGap : anchor.left - menuWidth - menuGap
  menuPosition.value = {
    left: Math.max(viewportMargin, Math.min(preferredLeft, window.innerWidth - menuWidth - viewportMargin)),
    top: openUpward ? anchor.top - menuGap : anchor.bottom + menuGap,
    maxHeight,
    openUpward,
  }
  openActions.value = idOf(session)
}
watch([query, searchVersion], ([value]) => {
  if (searchTimer) clearTimeout(searchTimer)
  const current = ++generation
  results.value = []
  if (!value.trim()) { searching.value = false; return }
  searching.value = true
  searchTimer = setTimeout(async () => {
    try {
      const next: Session[] = []
      for (let offset = 0; ; offset += 100) {
        const params = new URLSearchParams({ q: value.trim(), limit: '100', offset: String(offset) })
        const page = await api<{ sessions: Session[]; total: number }>(`/api/sessions/search?${params}`)
        next.push(...(page.sessions || []))
        if (next.length >= page.total || page.sessions.length < 100) break
      }
      if (current === generation) results.value = next
    } catch (cause) { if (current === generation) error.value = cause instanceof Error ? cause.message : '搜索失败' }
    finally { if (current === generation) searching.value = false }
  }, 300)
})
async function patch(session: Session, payload: Record<string, unknown>, suffix = '/organization', quiet = false) {
  busyId.value = idOf(session); error.value = ''
  try {
    await api(scopedPath(session, suffix), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    await list(quiet)
    if (query.value.trim()) searchVersion.value++
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '更新失败' }
  finally { busyId.value = '' }
}
function startRename(session: Session) { editingSession.value = idOf(session); draftTitle.value = session.title }
function cancelRename() {
  editingSession.value = "";
  draftTitle.value = "";
}
async function rename(session: Session) {
  if (editingSession.value !== idOf(session)) return;
  const title = draftTitle.value.trim();
  editingSession.value = "";
  if (title && title !== session.title) await patch(session, { title }, "");
}
async function remove(session: Session) {
  if (!confirm('永久删除此对话及其导师子对话？此操作无法撤销。')) return
  busyId.value = idOf(session); error.value = ''
  try { await api(scopedPath(session), { method: 'DELETE' }); sessions.value = sessions.value.filter(item => idOf(item) !== idOf(session)); results.value = results.value.filter(item => idOf(item) !== idOf(session)) }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '删除失败' }
  finally { busyId.value = '' }
}
function destination(session: Session) {
  return sessionNavigationPath({ id: idOf(session), content_workspace_id: session.content_workspace_id, preferences: session.preferences as any })
}
</script>

<template>
  <main class="feature-page history-page"><nav class="history-page-bar" aria-label="位置"><div class="history-crumb-wrap"><button type="button" class="history-crumb" aria-haspopup="menu" :aria-expanded="historyMenuOpen" @click.stop="historyMenuOpen = !historyMenuOpen" @keydown.esc="historyMenuOpen = false"><span aria-hidden="true">↺</span>聊天历史</button><template v-if="historyMenuOpen"><div class="history-menu-dismiss" @click="historyMenuOpen = false"></div><div class="history-resource-menu" role="menu" aria-label="资料"><p>资料</p><RouterLink role="menuitem" to="/space" @click="historyMenuOpen = false">全部资料</RouterLink><RouterLink role="menuitem" class="is-active" to="/space/chat-history" @click="historyMenuOpen = false">聊天历史</RouterLink><RouterLink role="menuitem" to="/notebooks" @click="historyMenuOpen = false">收藏夹</RouterLink><RouterLink role="menuitem" to="/space/journal" @click="historyMenuOpen = false">学习日志</RouterLink><RouterLink role="menuitem" to="/space/questions" @click="historyMenuOpen = false">题库</RouterLink><RouterLink role="menuitem" to="/knowledge-bases" @click="historyMenuOpen = false">知识中心</RouterLink></div></template></div><span>{{ sessions.length }} 个对话</span><button :disabled="loading || searching" @click="list()">↻ 刷新</button></nav><div class="history-page-content"><header class="history-header"><div><h1>聊天历史</h1><p>浏览、重命名、删除并重新打开学习空间中的对话。</p></div><span>{{ sessions.length }} 段对话</span><button :disabled="loading || searching" @click="list()">↻ 刷新</button></header><section class="history-panel"><div class="history-controls"><label><LegacyIcon name="search" :size="14" /><input v-model="query" type="search" placeholder="搜索历史对话..." aria-label="搜索对话"></label><div><select v-model="kind" id="history-kind-filter" aria-label="按聊天类型筛选"><option value="all">全部聊天类型</option><option value="chat">主聊天</option><option value="selection_tutor">小老师追问</option></select><select v-model="archive" id="history-archive-filter" aria-label="按归档状态筛选"><option value="active">已激活</option><option value="archived">已归档</option><option value="all">进行中与已归档</option></select></div></div><div class="history-content"><p v-if="error" class="error" role="alert">{{ error }}</p><div v-if="loading || searching" class="history-skeleton"><i v-for="index in 4" :key="index"></i></div><template v-else-if="archive === 'archived'"><div class="history-archive-view"><p class="history-archive-intro">归档只是把对话从侧栏收起，内容一条没删。在这里恢复，它就回到原来的位置。</p><p v-if="!archiveGroups.length" class="history-archive-empty">还没有归档任何对话。</p><section v-for="group in archiveGroups" :key="group.id" class="history-archive-group"><h2><LegacyIcon :name="group.icon" :size="13" :stroke-width="1.8" /><span>{{ group.label }}</span><small>{{ group.rows.length }}</small></h2><div class="history-archive-partition"><article v-for="row in group.rows" :key="idOf(row.session)" class="history-archive-row"><button class="history-archive-open" @click="router.push(destination(row.session))"><span class="history-archive-title" :class="{ 'is-placeholder': isPlaceholderTitle(row.session.title) }">{{ displayTitle(row.session.title) }}</span><small class="history-archive-meta">{{ archiveMeta(row) }}</small></button><button class="history-archive-restore" :disabled="busyId === idOf(row.session)" @click="patch(row.session, { archived: false }, '/organization', true)"><LegacyIcon :name="busyId === idOf(row.session) ? 'loader' : 'archiveRestore'" :size="13" :stroke-width="1.8" :class="{ 'history-spinner': busyId === idOf(row.session) }" /><span>取消归档</span></button></article></div></section></div></template><template v-else><p v-if="!visible.length" class="history-empty">没有匹配的会话</p><div v-else class="history-list"><article v-for="session in visible" :key="`${session.content_workspace_id || ''}:${idOf(session)}`" class="history-row" :class="{ 'is-placeholder': isPlaceholderTitle(session.title) }" role="button" tabindex="0" @click="router.push(destination(session))" @keydown.enter.prevent="router.push(destination(session))" @keydown.space.prevent="router.push(destination(session))"><span class="history-mark" :class="{ 'has-mark-color': Boolean(markColor(session)) }" :style="markColor(session) ? { color: markColor(session) } : undefined" aria-hidden="true"></span><input v-if="editingSession === idOf(session)" v-model="draftTitle" class="history-rename-input" aria-label="会话标题" autofocus @click.stop @keydown.stop @keydown.enter.prevent="rename(session)" @keydown.esc.prevent="cancelRename" @blur="rename(session)"><span v-else class="history-title"><strong>{{ displayTitle(session.title) }}</strong><small>{{ timeLabel(session.updated_at) }} · {{ session.capability || 'chat' }}</small></span><LegacyIcon v-if="session.preferences?.pinned" class="history-pin" name="pin" :size="10" /><div class="history-actions" @click.stop @keydown.stop><button class="history-actions-trigger" type="button" aria-label="聊天操作" aria-haspopup="menu" :aria-expanded="openActions === idOf(session)" :disabled="busyId === idOf(session)" @click.stop="toggleActions(session, $event)"><LegacyIcon name="more" :size="13" /></button><div v-if="openActions === idOf(session) && menuPosition" class="history-actions-menu" role="menu" :style="{ left: `${menuPosition.left}px`, top: `${menuPosition.top}px`, maxHeight: `${menuPosition.maxHeight}px`, transform: menuPosition.openUpward ? 'translateY(-100%)' : undefined, transformOrigin: menuPosition.openUpward ? 'bottom' : 'top' }" @click.stop><button role="menuitem" @click="openActions = ''; startRename(session)"><LegacyIcon name="edit" :size="13" /><span>重命名对话</span></button><button role="menuitem" :disabled="busyId === idOf(session)" @click="openActions = ''; patch(session, { pinned: !session.preferences?.pinned })"><LegacyIcon :name="session.preferences?.pinned ? 'pinOff' : 'pin'" :size="13" /><span>{{ session.preferences?.pinned ? '取消置顶' : '置顶' }}</span></button><button role="menuitem" :disabled="busyId === idOf(session)" @click="openActions = ''; patch(session, { archived: !session.preferences?.archived })"><LegacyIcon :name="session.preferences?.archived ? 'undo' : 'archive'" :size="13" /><span>{{ session.preferences?.archived ? '从归档恢复' : '归档' }}</span></button><div class="history-actions-divider" aria-hidden="true"></div><button role="menuitem" class="legacy-danger" @click="openActions = ''; remove(session)"><LegacyIcon name="trash" :size="13" /><span>删除对话</span></button></div></div></article></div></template></div></section></div></main>
</template>
