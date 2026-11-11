<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, authStatus, type AuthStatus } from '../api'
import LegacyIcon from './LegacyIcon.vue'
import PartnerAvatar from './PartnerAvatar.vue'
import { allLearningActivity, type LearningActivity, type LearningKind, type LearningSources } from '../learningActivity'
import { sessionNavigationPath } from '../sessionNavigation'
import { scopedUrl } from '../workspaceScope'

type Category = 'home' | 'learning' | 'resources' | 'partners' | 'personalization'
type SessionRow = { id: string; session_id?: string; title: string; updated_at?: string | number; created_at?: string | number; content_workspace_id?: string; preferences?: Record<string, unknown>; status?: string }
type NavItem = { label: string; href: string; icon: string; requires?: string }
type PartnerNav = { partner_id: string; name: string; emoji?: string; color?: string; avatar?: string }
type GroupNav = { group_id: string; name: string; emoji?: string; color?: string }
type PartnerSession = { session_key: string; title?: string; updated_at?: string; owner_id: string; owner_name: string; kind: 'partner' | 'group' }
type LearningNavRow =
  | { kind: 'record'; key: string; record: LearningActivity; sessions: SessionRow[]; time: number }
  | { kind: 'session'; key: string; session: SessionRow; time: number }
type WorkspaceRow = { workspace_id: string; kind: 'system' | 'general' | 'workspace'; display_name: string; archived: boolean; status: 'ready' | 'invalid'; follows_root?: boolean; path?: string; created_at?: string }
const categories: Array<{ id: Category; label: string; icon: string; href: string; account?: boolean }> = [
  { id: 'home', label: '主页', icon: 'homeShelf', href: '/chat' },
  { id: 'learning', label: '学习', icon: 'learningShelf', href: '/learning' },
  { id: 'resources', label: '资料', icon: 'resourcesShelf', href: '/space' },
  { id: 'partners', label: '伙伴', icon: 'partnersShelf', href: '/partners', account: true },
  { id: 'personalization', label: '个性化', icon: 'personalizationShelf', href: '/personalization', account: true },
]
const resourceGroups: Array<{ label: string; items: NavItem[] }> = [
  { label: '对话与资料', items: [
    { label: '聊天历史', href: '/space/chat-history', icon: 'history' }, { label: '收藏夹', href: '/notebooks', icon: 'bookmark' },
    { label: '学习日志', href: '/space/journal', icon: 'journal' }, { label: '题库', href: '/space/questions', icon: 'questions' },
    { label: '知识中心', href: '/knowledge-bases', icon: 'knowledge' },
  ] },
  { label: '更多项目', items: [{ label: '密语', href: '/whisper', icon: 'chat', requires: 'whisper_visitor' }] },
]
const visibleResourceGroups = computed(() => resourceGroups.map(group => ({ ...group, items: group.items.filter(item => !item.requires || registeredCapabilities.value?.has(item.requires)) })).filter(group => group.items.length))
const personalItems: NavItem[] = [
  { label: '子智能体', href: '/agents', icon: 'agents' }, { label: 'Personas', href: '/space/personas', icon: 'profile' },
  { label: '技能', href: '/space/skills', icon: 'skills' }, { label: 'MCP 服务', href: '/space/mcp', icon: 'plug' },
  { label: 'CLI 应用', href: '/space/cli-apps', icon: 'terminal' }, { label: '记忆', href: '/memory', icon: 'memory' },
]
const learningItems: NavItem[] = [
  { label: '掌握路径', href: '/learning/mastery', icon: 'learning' }, { label: '沉浸阅读', href: '/learning/reading', icon: 'resources' },
  { label: '书籍', href: '/learning/books', icon: 'journal' }, { label: '练习', href: '/learning/practice', icon: 'edit' },
]
const route = useRoute(); const router = useRouter(); const root = ref<HTMLElement | null>(null)
const user = ref<AuthStatus | null>(null); const sessions = ref<SessionRow[]>([]); const partnerRoster = ref<PartnerNav[]>([]); const partnerGroups = ref<GroupNav[]>([]); const partnerSessions = ref<PartnerSession[]>([]); const registeredCapabilities = ref<Set<string> | null>(null)
const category = ref<Category>('home'); const collapsed = ref(false); const drawerOpen = ref(false); const accountPeek = ref(false)
const width = ref(272); const workspaceOpen = ref(false); const paletteOpen = ref(false); const paletteQuery = ref('')
const recordQuery = ref(''); const recordSearchOpen = ref(false); const sortOpen = ref(false); const sort = ref<'updatedAt' | 'createdAt'>('updatedAt'); const sessionLimit = ref(30); const learningSort = ref<'updatedAt' | 'createdAt'>('updatedAt'); const learningLimit = ref(30); const learningOpen = ref<Record<string, boolean>>({}); const learningLoading = ref(true); const learningFailed = ref(false)
const sessionMenu = ref(''); const renameId = ref(''); const renameValue = ref(''); const workspaces = ref<WorkspaceRow[]>([]); const sessionActionBusy = ref(false)
interface SessionMenuPosition { left: number; top: number; maxHeight: number; openUpward: boolean }
const sessionMenuPosition = ref<SessionMenuPosition | null>(null)
const paletteInput = ref<HTMLInputElement | null>(null); const resizing = ref(false); const paletteIndex = ref(0); const isMobile = ref(false)
let mediaQuery: MediaQueryList | undefined
const workspaceCategories = computed(() => categories.filter(item => !item.account)); const accountCategories = computed(() => categories.filter(item => item.account)); const accountTucked = computed(() => !['partners', 'personalization'].includes(category.value) && !accountPeek.value)
function handleCategoryKeydown(event: KeyboardEvent, navigate = false) {
  if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('[role="tab"]')
  const current = target?.dataset.category as Category | undefined
  if (!current) return
  event.preventDefault()
  const index = categories.findIndex(item => item.id === current)
  const nextIndex = event.key === 'Home'
    ? 0
    : event.key === 'End'
      ? categories.length - 1
      : (index + (event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1) + categories.length) % categories.length
  const next = categories[nextIndex]
  if (!next) return
  selectCategory(next.id, navigate)
  void nextTick(() => root.value?.querySelector<HTMLElement>(`[role="tab"][data-category="${next.id}"]`)?.focus())
}
const learningSources = ref<LearningSources>({ books: [], mastery: [], reading: [], watching: [], practice: [] })
const learningRecords = computed(() => allLearningActivity(learningSources.value))
function learningRecordKeyOf(row: SessionRow): string | null {
  const preferences = row.preferences || {}
  const workspace = workspaceOf(row)
  const masteryPath = preferences.workspace_mode === 'mastery_path' ? String(preferences.mastery_path_id || '') : ''
  if (masteryPath) return `topic:${workspace}:${masteryPath}`
  const readingWorkspace = preferences.workspace_mode === 'immersive_reading' ? String(preferences.reading_workspace_id || '') : ''
  if (readingWorkspace) return `reading:${workspace}:${readingWorkspace}`
  const bookId = String(preferences.book_id || '')
  if (bookId) return `book:${workspace}:${bookId}`
  return null
}
const learningRows = computed<LearningNavRow[]>(() => {
  const records = learningRecords.value
  const keys = new Set(records.map(record => record.key))
  const children = new Map<string, SessionRow[]>()
  const loose: SessionRow[] = []
  for (const row of sessions.value) {
    if (row.preferences?.archived || row.preferences?.parent_session_id || row.preferences?.note_document_id || !isLearningRow(row)) continue
    if (keys.has(`session:${workspaceOf(row)}:${sessionIdOf(row)}`)) continue
    const key = learningRecordKeyOf(row)
    if (key && keys.has(key)) children.set(key, [...(children.get(key) || []), row])
    else loose.push(row)
  }
  const rows: LearningNavRow[] = records.map(record => {
    const recordSessions = children.get(record.key) || []
    const time = learningSort.value === 'createdAt'
      ? record.createdAt
      : Math.max(record.updatedAt, ...recordSessions.map(session => sessionTime(session) / 1000))
    return { kind: 'record', key: record.key, record, sessions: recordSessions, time }
  })
  rows.push(...loose.map(session => ({ kind: 'session' as const, key: sessionIdOf(session), session, time: sessionTime(session, learningSort.value) / 1000 })))
  return rows.sort((left, right) => right.time - left.time || left.key.localeCompare(right.key))
})
const filteredLearningRows = computed(() => {
  const query = recordQuery.value.trim().toLocaleLowerCase()
  return learningRows.value.filter(row => {
    if (!query) return true
    if (row.kind === 'session') return displaySessionTitle(row.session).toLocaleLowerCase().includes(query)
    return row.record.title.toLocaleLowerCase().includes(query) || row.sessions.some(session => displaySessionTitle(session).toLocaleLowerCase().includes(query))
  }).slice(0, learningLimit.value)
})
const learningGroups = computed(() => {
  const buckets = new Map<string, LearningNavRow[]>()
  for (const row of filteredLearningRows.value) {
    const key = dayGroupKey(row.time * 1000)
    buckets.set(key, [...(buckets.get(key) || []), row])
  }
  const labels: Record<string, string> = { today: '今天', week: '一周内', earlier: '更早' }
  return ['today', 'week', 'earlier'].filter(key => buckets.has(key)).map(key => ({ key, label: labels[key], rows: buckets.get(key)! }))
})
const hasMoreLearningRows = computed(() => learningRows.value.filter(row => {
  const query = recordQuery.value.trim().toLocaleLowerCase()
  if (!query) return true
  return row.kind === 'session'
    ? displaySessionTitle(row.session).toLocaleLowerCase().includes(query)
    : row.record.title.toLocaleLowerCase().includes(query) || row.sessions.some(session => displaySessionTitle(session).toLocaleLowerCase().includes(query))
}).length > learningLimit.value)
function learningRecordOpen(row: Extract<LearningNavRow, { kind: 'record' }>) {
  const query = recordQuery.value.trim().toLocaleLowerCase()
  return (query && row.sessions.some(session => displaySessionTitle(session).toLocaleLowerCase().includes(query))) ||
    (learningOpen.value[row.key] ?? row.sessions.some(session => sessionIdOf(session) === String(route.params.sessionId || '')))
}
function toggleLearningRecord(row: Extract<LearningNavRow, { kind: 'record' }>) {
  const value = { ...learningOpen.value, [row.key]: !learningRecordOpen(row) }
  learningOpen.value = value
  localStorage.setItem('deeptutor.navigation.learning.open', JSON.stringify(value))
}
function learningIcon(kind: LearningKind) {
  return ({ books: 'bookOpen', mastery: 'route', reading: 'bookText', watching: 'bookText', practice: 'tasks' } as Record<LearningKind, string>)[kind]
}
function isLearningRecordActive(href: string) {
  const target = new URL(href, window.location.origin)
  return route.path === target.pathname
}
function setLearningSort(value: 'updatedAt' | 'createdAt') {
  learningSort.value = value
  learningLimit.value = 30
  sortOpen.value = false
  localStorage.setItem('deeptutor.navigation.learning.sort', value)
}
const filteredPartnerSessions = computed(() => { const query = recordQuery.value.trim().toLocaleLowerCase(); return partnerSessions.value.filter(row => !query || `${row.title || ''} ${row.owner_name}`.toLocaleLowerCase().includes(query)).sort((a, b) => Date.parse(b.updated_at || '') - Date.parse(a.updated_at || '')) })
function sessionTime(row: SessionRow, field: 'updatedAt' | 'createdAt' = 'updatedAt') {
  const value = field === 'updatedAt' ? (row.updated_at ?? row.created_at) : (row.created_at ?? row.updated_at)
  if (typeof value === 'number') return value < 1e12 ? value * 1000 : value
  const parsed = Date.parse(value || '')
  return Number.isFinite(parsed) ? parsed : 0
}
function isLearningRow(row: SessionRow) {
  return sessionNavigationPath({ id: row.session_id || row.id, content_workspace_id: row.content_workspace_id, preferences: row.preferences as any }).startsWith('/learning')
}
function sessionHref(row: SessionRow) {
  return sessionNavigationPath({ id: row.session_id || row.id, content_workspace_id: row.content_workspace_id, preferences: row.preferences as any })
}
function displaySessionTitle(row: SessionRow) {
  const title = (row.title || '').trim()
  return !title || title === 'New conversation' ? '新对话' : title
}
function sessionMark(row: SessionRow) {
  if (row.status === 'failed' || row.status === 'rejected') return 'failed'
  if (row.status === 'running') return 'running'
  return 'idle'
}
const homeSessions = computed(() => sessions.value.filter(row => !row.preferences?.archived && !row.preferences?.parent_session_id && !isLearningRow(row)))
const filteredSessions = computed(() => {
  const query = recordQuery.value.trim().toLocaleLowerCase()
  return homeSessions.value
    .filter(row => !query || displaySessionTitle(row).toLocaleLowerCase().includes(query))
    .sort((a, b) => sort.value === 'createdAt' ? sessionTime(b, 'createdAt') - sessionTime(a, 'createdAt') : sessionTime(b) - sessionTime(a))
})
function dayGroupKey(timestamp: number) {
  const now = new Date()
  const date = new Date(timestamp)
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  const item = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  const days = Math.floor((today - item) / 86400000)
  return days <= 0 ? 'today' : days < 7 ? 'week' : 'earlier'
}
const sessionGroups = computed(() => {
  const pinned = filteredSessions.value.filter(row => Boolean(row.preferences?.pinned))
  const rest = filteredSessions.value.filter(row => !row.preferences?.pinned).slice(0, sessionLimit.value)
  const buckets = new Map<string, SessionRow[]>()
  for (const row of rest) {
    const key = dayGroupKey(sessionTime(row))
    const rows = buckets.get(key) || []
    rows.push(row)
    buckets.set(key, rows)
  }
  const labels: Record<string, string> = { today: '今天', week: '一周内', earlier: '更早' }
  return [
    ...(pinned.length ? [{ key: 'pinned', label: '已置顶', rows: pinned }] : []),
    ...['today', 'week', 'earlier'].filter(key => buckets.has(key)).map(key => ({ key, label: labels[key], rows: buckets.get(key)! })),
  ]
})
const hasMoreSessions = computed(() => filteredSessions.value.filter(row => !row.preferences?.pinned).length > sessionLimit.value)
const allPaletteItems = computed(() => [
  { label: '新对话', href: '/chat', icon: 'edit', group: '快捷操作' }, { label: '日历', href: '/calendar', icon: 'calendar', group: '工作台' }, { label: '任务看板', href: '/kanban', icon: 'kanban', group: '工作台' }, { label: '笔记本', href: '/co-writer', icon: 'note', group: '工作台' },
  ...visibleResourceGroups.value.flatMap(group => group.items.map(item => ({ ...item, group: group.label }))),
  ...personalItems.map(item => ({ ...item, group: '个性化' })),
  { label: '设置', href: '/settings', icon: 'settings', group: '账户' }, { label: '个人资料', href: '/profile', icon: 'profile', group: '账户' },
])
const paletteResults = computed(() => { const q = paletteQuery.value.trim().toLocaleLowerCase(); return allPaletteItems.value.filter(item => !q || item.label.toLocaleLowerCase().includes(q)) })
const paletteGroups = computed(() => { const groups: Array<{ label: string; items: typeof paletteResults.value }> = []; for (const item of paletteResults.value) { let group = groups.find(entry => entry.label === item.group); if (!group) { group = { label: item.group, items: [] }; groups.push(group) } group.items.push(item) } return groups })
function categoryForPath(path: string): Category {
  if (path.startsWith('/learning') || path === '/settings/progress') return 'learning'
  if (path.startsWith('/partners')) return 'partners'
  if (['/agents', '/personalization', '/memory', '/space/personas', '/space/skills', '/space/mcp', '/space/cli-apps', '/settings', '/profile'].some(prefix => path.startsWith(prefix))) return 'personalization'
  if (['/space', '/notebooks', '/knowledge-bases', '/whisper'].some(prefix => path.startsWith(prefix))) return 'resources'
  return 'home'
}
function isActive(href: string) { return route.path === href || (href !== '/chat' && route.path.startsWith(`${href}/`)) }
function selectCategory(next: Category, navigate = false) { category.value = next; if (navigate) { const target = categories.find(item => item.id === next); if (target) void router.push(target.href); drawerOpen.value = false } }
function openDrawer() { drawerOpen.value = true }
function syncMedia() { isMobile.value = mediaQuery?.matches ?? false; if (!isMobile.value) drawerOpen.value = false }
function movePalette(delta: number) { if (!paletteResults.value.length) return; paletteIndex.value = (paletteIndex.value + delta + paletteResults.value.length) % paletteResults.value.length; document.querySelectorAll('.dt-palette-item')[paletteIndex.value]?.scrollIntoView({ block: 'nearest' }) }
function choosePalette() { const item = paletteResults.value[paletteIndex.value] || paletteResults.value[0]; if (item) goPalette(item.href) }
function closeOverlays() { workspaceOpen.value = false; sortOpen.value = false; sessionMenu.value = ''; sessionMenuPosition.value = null }
async function loadLearningRecords() { learningLoading.value = true; learningFailed.value = false; try { const result = await api<{ sources: LearningSources }>('/api/dashboard/learning-index'); learningSources.value = result.sources || { books: [], mastery: [], reading: [], watching: [], practice: [] } } catch { learningFailed.value = true } finally { learningLoading.value = false } }
async function loadPartnerNavigation() {
  const [roster, groups] = await Promise.all([api<PartnerNav[]>('/api/partners').catch(() => []), api<GroupNav[]>('/api/partner-groups').catch(() => [])])
  partnerRoster.value = roster; partnerGroups.value = groups
  const rows = await Promise.all([
    ...roster.map(async partner => (await api<Array<{ session_key: string; title?: string; updated_at?: string }>>(`/api/partners/${encodeURIComponent(partner.partner_id)}/sessions`).catch(() => [])).map(row => ({ ...row, owner_id: partner.partner_id, owner_name: partner.name, kind: 'partner' as const }))),
    ...groups.map(async group => (await api<Array<{ session_key: string; title?: string; updated_at?: string }>>(`/api/partner-groups/${encodeURIComponent(group.group_id)}/sessions`).catch(() => [])).map(row => ({ ...row, owner_id: group.group_id, owner_name: group.name, kind: 'group' as const }))),
  ])
  partnerSessions.value = rows.flat()
}
function partnerSessionHref(row: PartnerSession) { return `${row.kind === 'group' ? '/partners/groups/' : '/partners/'}${encodeURIComponent(row.owner_id)}?session=${encodeURIComponent(row.session_key)}` }
async function loadSessions() { try { const result = await api<{ sessions: SessionRow[] }>('/api/sessions?limit=200'); sessions.value = result.sessions || [] } catch { sessions.value = [] } }
async function loadWorkspaces() { try { const result = await api<{ workspaces: WorkspaceRow[] }>('/api/settings/workspace/registrations'); workspaces.value = result.workspaces || [] } catch { workspaces.value = [] } }
async function openPalette() { paletteOpen.value = true; paletteQuery.value = ''; paletteIndex.value = 0; await nextTick(); paletteInput.value?.focus() }
function goPalette(href: string) { paletteOpen.value = false; void router.push(href); drawerOpen.value = false }
function relativeTimeSeconds(timestamp: number) {
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
function relativeTime(row: SessionRow) { return relativeTimeSeconds(sessionTime(row) / 1000) }
function workspaceOf(row: SessionRow) { return String(row.content_workspace_id ?? row.preferences?.workspace_id ?? '') }
function sessionIdOf(row: SessionRow) { return row.session_id || row.id }
function sessionApiPath(row: SessionRow, suffix = '') { return scopedUrl(`/api/sessions/${encodeURIComponent(sessionIdOf(row))}${suffix}`, workspaceOf(row)) }
function openSessionMenu(row: SessionRow, event: MouseEvent) {
  const id = sessionIdOf(row)
  if (sessionMenu.value === id) { closeOverlays(); return }
  const anchor = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const width = 240; const gap = 8; const margin = 12
  const preferredHeight = Math.min(380, window.innerHeight - margin * 2)
  const below = window.innerHeight - anchor.bottom - gap - margin
  const above = anchor.top - gap - margin
  const openUpward = below < preferredHeight && above > below
  const roomRight = window.innerWidth - anchor.right - gap - margin
  const roomLeft = anchor.left - gap - margin
  const preferredLeft = roomRight >= width || roomRight >= roomLeft ? anchor.right + gap : anchor.left - width - gap
  sessionMenuPosition.value = {
    left: Math.max(margin, Math.min(preferredLeft, window.innerWidth - width - margin)),
    top: openUpward ? anchor.top - gap : anchor.bottom + gap,
    maxHeight: Math.max(140, Math.min(preferredHeight, openUpward ? above : below)),
    openUpward,
  }
  sessionMenu.value = id
}
function menuWorkspaces(row: SessionRow) {
  const current = workspaceOf(row)
  return workspaces.value.filter(workspace => workspace.kind === 'workspace' && (!workspace.archived || workspace.workspace_id === current))
}
function showWorkspaceMove(row: SessionRow) {
  return Boolean(workspaceOf(row)) || workspaces.value.some(workspace => workspace.kind === 'workspace' && !workspace.archived)
}
async function organizeSession(row: SessionRow, patch: Record<string, unknown>) {
  if (sessionActionBusy.value) return
  sessionActionBusy.value = true
  sessionMenu.value = ''
  sessionMenuPosition.value = null
  try {
    await api(sessionApiPath(row, '/organization'), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })
    await loadSessions()
  } finally { sessionActionBusy.value = false }
}
async function moveSession(row: SessionRow, workspaceId: string | null) {
  await organizeSession(row, { workspace_id: workspaceId })
}
function startRename(row: SessionRow) { renameId.value = sessionIdOf(row); renameValue.value = displaySessionTitle(row); sessionMenu.value = ''; sessionMenuPosition.value = null }
function cancelRename() { renameId.value = ''; renameValue.value = '' }
async function saveRename() { const id = renameId.value; if (!id) return; const row = sessions.value.find(item => sessionIdOf(item) === id); const title = renameValue.value.trim(); renameId.value = ''; renameValue.value = ''; if (!row || !title || title === displaySessionTitle(row)) return; await api(sessionApiPath(row), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) }); await loadSessions() }
async function removeSession(row: SessionRow) { if (!window.confirm('永久删除此对话及其导师子对话？此操作无法撤销。')) return; await api(sessionApiPath(row), { method: 'DELETE' }); sessionMenu.value = ''; if (route.params.sessionId === sessionIdOf(row)) void router.push('/chat'); await loadSessions() }
function startResize(event: PointerEvent) { if (collapsed.value) return; resizing.value = true; event.preventDefault(); const startX = event.clientX; const startWidth = width.value; const move = (moveEvent: PointerEvent) => { width.value = Math.min(420, Math.max(220, startWidth + moveEvent.clientX - startX)) }; const up = () => { resizing.value = false; window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); localStorage.setItem('deeptutor.sidebar.width', String(width.value)) }; window.addEventListener('pointermove', move); window.addEventListener('pointerup', up) }
function onDocumentClick(event: MouseEvent) { if (root.value && !root.value.contains(event.target as Node)) closeOverlays() }
function onKeydown(event: KeyboardEvent) { if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 'k') { event.preventDefault(); void openPalette() } if (event.key === 'Escape') { paletteOpen.value = false; drawerOpen.value = false; closeOverlays() } }
async function logout() { await api('/api/auth/logout', { method: 'POST' }).catch(() => null); await router.replace('/login') }
watch(paletteQuery, () => { paletteIndex.value = 0 })
watch([recordQuery, sort], () => { sessionLimit.value = 30 })
watch(() => route.path, path => { category.value = categoryForPath(path); drawerOpen.value = false; closeOverlays(); void loadSessions() })
watch(category, value => { recordQuery.value = ''; recordSearchOpen.value = false; if (value === 'partners') void loadPartnerNavigation() })
watch(collapsed, value => localStorage.setItem('deeptutor.sidebar.collapsed', String(value)))
onMounted(async () => { if (localStorage.getItem('deeptutor.navigation.learning.sort') === 'createdAt') learningSort.value = 'createdAt'; try { learningOpen.value = JSON.parse(localStorage.getItem('deeptutor.navigation.learning.open') || '{}') } catch { learningOpen.value = {} }; window.addEventListener('resize', closeOverlays); window.addEventListener('scroll', closeOverlays, true); void api<Array<{ id: string; available?: boolean }> | { capabilities?: Array<{ id: string; available?: boolean }>; registered?: Array<{ id: string; available?: boolean }> }>('/api/capabilities/registered').then(payload => { const rows = Array.isArray(payload) ? payload : payload.capabilities || payload.registered || []; registeredCapabilities.value = new Set(rows.filter(item => item.available !== false).map(item => item.id)) }).catch(() => { registeredCapabilities.value = new Set() }); collapsed.value = localStorage.getItem('deeptutor.sidebar.collapsed') === 'true'; width.value = Math.min(420, Math.max(220, Number(localStorage.getItem('deeptutor.sidebar.width')) || 272)); category.value = categoryForPath(route.path); document.addEventListener('click', onDocumentClick); document.addEventListener('keydown', onKeydown); mediaQuery = window.matchMedia('(max-width: 767px)'); syncMedia(); mediaQuery.addEventListener('change', syncMedia); [user.value] = await Promise.all([authStatus().catch(() => null), loadSessions(), loadWorkspaces(), loadLearningRecords(), category.value === 'partners' ? loadPartnerNavigation() : Promise.resolve()]) })
onUnmounted(() => { document.removeEventListener('click', onDocumentClick); document.removeEventListener('keydown', onKeydown); window.removeEventListener('resize', closeOverlays); window.removeEventListener('scroll', closeOverlays, true); mediaQuery?.removeEventListener('change', syncMedia) })
defineExpose({ openDrawer })
</script>

<template>
  <div ref="root" class="legacy-sidebar-root">
    <button v-if="drawerOpen" class="legacy-drawer-scrim" aria-label="关闭导航" @click="drawerOpen = false" />
    <aside v-if="collapsed" class="dt-product-sidebar dt-rail" aria-label="折叠导航">
      <button class="dt-rail-brand" title="通用工作区" @click="workspaceOpen = !workspaceOpen"><img src="/brand/color-logo.png" alt="DeepTutor"></button><div v-if="workspaceOpen" class="dt-popover dt-workspace-panel dt-rail-workspace-panel" @click.stop><RouterLink class="dt-menu-item" to="/settings" @click="workspaceOpen = false"><LegacyIcon name="settings" />设置</RouterLink><RouterLink class="dt-menu-item" to="/profile" @click="workspaceOpen = false"><LegacyIcon name="profile" />个人资料</RouterLink><button class="dt-menu-item" @click="logout"><LegacyIcon name="logout" />退出登录</button></div>
      <button class="dt-nav-icon" title="展开侧边栏" @click="collapsed = false"><LegacyIcon name="expand" /></button><div class="dt-rail-divider" /><button class="dt-nav-icon" title="搜索" aria-label="搜索" aria-haspopup="dialog" @click="openPalette"><LegacyIcon name="search" :size="17" /></button>
      <button class="dt-nav-icon" title="搜索 ⌘K" @click="openPalette"><LegacyIcon name="search" /></button>
      <div class="dt-category-bar is-collapsed"><div role="tablist" aria-label="主要栏目" @keydown="handleCategoryKeydown($event, true)"><button v-for="item in categories" :key="item.id" role="tab" :aria-label="item.label" :title="item.label" :data-category="item.id" :aria-selected="category === item.id" :class="{ 'is-active': category === item.id }" @click="selectCategory(item.id, true)"><LegacyIcon :name="item.icon" :size="20" /></button></div></div>
      <div class="dt-rail-foot"><RouterLink to="/chat" class="dt-nav-icon" title="新对话"><LegacyIcon name="edit" /></RouterLink></div>
    </aside>
    <aside v-else class="dt-product-sidebar dt-sidebar-expanded" :inert="isMobile && !drawerOpen" :class="{ 'is-drawer-open': drawerOpen, 'is-resizing': resizing }" :style="{ '--sidebar-width': `${width}px` }" aria-label="主导航">
      <header class="dt-sidebar-header">
        <div class="dt-workspace-menu">
          <button class="dt-workspace-trigger" aria-haspopup="menu" :aria-expanded="workspaceOpen" @click.stop="workspaceOpen = !workspaceOpen"><img src="/brand/color-logo.png" alt=""><span>通用工作区</span><LegacyIcon name="chevronDown" :size="14" /></button>
          <div v-if="workspaceOpen" class="dt-popover dt-workspace-panel" role="menu" @click.stop>
            <div class="dt-menu-label">工作区</div><button class="dt-menu-item" role="menuitem" @click="workspaceOpen = false"><LegacyIcon name="resources" /><span class="dt-menu-grow">通用工作区</span><span>✓</span></button><div class="dt-menu-divider" />
            <RouterLink class="dt-menu-item" role="menuitem" to="/settings" @click="workspaceOpen = false"><LegacyIcon name="settings" /><span>设置</span></RouterLink>
            <RouterLink class="dt-menu-item" role="menuitem" to="/profile" @click="workspaceOpen = false"><LegacyIcon name="profile" /><span>个人资料</span><small>{{ user?.username || '访客' }}</small></RouterLink>
            <button class="dt-menu-item" role="menuitem" @click="logout"><LegacyIcon name="logout" /><span>退出登录</span></button><div class="dt-menu-divider" /><div class="dt-menu-footer"><span>DeepTutor</span><span>v1.7.0</span></div>
          </div>
        </div>
        <button class="dt-nav-icon dt-sidebar-search" title="搜索 ⌘K" @click="openPalette"><LegacyIcon name="search" /></button>
        <button class="dt-nav-icon legacy-collapse-button" title="收起侧边栏" @click="collapsed = true"><LegacyIcon name="collapse" :size="15" /></button>
      </header>
      <div class="dt-category-bar"><div role="tablist" aria-label="工作区栏目" @keydown="handleCategoryKeydown"><button v-for="item in workspaceCategories" :key="item.id" role="tab" :aria-label="item.label" :title="item.label" :data-category="item.id" :aria-selected="category === item.id" :class="{ 'is-active': category === item.id }" @click="selectCategory(item.id)"><span v-if="category === item.id" class="dt-category-pill" /><LegacyIcon :name="item.icon" :size="20" /><span>{{ item.label }}</span></button><span aria-hidden class="dt-category-divider" /><div class="dt-account-tabs" :class="{ 'is-tucked': accountTucked }" @pointerenter="accountPeek = true" @pointerleave="accountPeek = false" @focusin="accountPeek = true" @focusout="accountPeek = false"><button v-for="item in accountCategories" :key="item.id" role="tab" :aria-label="item.label" :title="item.label" :data-category="item.id" :aria-selected="category === item.id" :class="{ 'is-active': category === item.id }" @click="selectCategory(item.id)"><span v-if="category === item.id" class="dt-category-pill" /><LegacyIcon :name="item.icon" :size="20" /><span>{{ item.label }}</span></button></div></div></div>
      <div class="dt-category-content">
        <template v-if="category === 'home'">
          <div class="dt-overview-row"><RouterLink to="/chat"><LegacyIcon name="chat" /><span>聊天</span></RouterLink></div>
          <section class="dt-navigation-section"><div class="dt-navigation-heading"><span>工作台</span></div><RouterLink class="dt-navigation-row" :class="{ 'is-active': isActive('/calendar') }" to="/calendar"><LegacyIcon name="calendar" /><span>日历</span></RouterLink><RouterLink class="dt-navigation-row" :class="{ 'is-active': isActive('/kanban') }" to="/kanban"><LegacyIcon name="kanban" /><span>任务看板</span></RouterLink><RouterLink class="dt-navigation-row" :class="{ 'is-active': isActive('/co-writer') }" to="/co-writer"><LegacyIcon name="edit" /><span>笔记本</span></RouterLink></section>
          <section class="dt-navigation-section dt-session-section"><div class="dt-record-header"><div class="dt-navigation-heading"><h2>对话记录 <span class="dt-navigation-count">{{ homeSessions.length }}</span></h2><div class="dt-navigation-actions"><div class="dt-record-sort"><button class="dt-nav-icon" title="排序方式" aria-label="排序方式" aria-haspopup="menu" :aria-expanded="sortOpen" @click.stop="sortOpen = !sortOpen"><LegacyIcon name="arrowDownUp" :size="14" /></button><div v-if="sortOpen" class="dt-popover dt-record-sort-menu" role="menu" aria-label="排序方式" @click.stop><button class="dt-menu-item" role="menuitemradio" :aria-checked="sort === 'updatedAt'" @click="sort = 'updatedAt'; sortOpen = false">最后一次活跃 <LegacyIcon v-if="sort === 'updatedAt'" name="check" :size="14" /></button><button class="dt-menu-item" role="menuitemradio" :aria-checked="sort === 'createdAt'" @click="sort = 'createdAt'; sortOpen = false">创建时间 <LegacyIcon v-if="sort === 'createdAt'" name="check" :size="14" /></button></div></div><button class="dt-nav-icon" title="搜索对话" aria-label="搜索对话" :aria-expanded="recordSearchOpen" @click="recordSearchOpen = !recordSearchOpen"><LegacyIcon name="search" :size="14" /></button></div></div><div v-if="recordSearchOpen" class="dt-record-search"><LegacyIcon name="search" :size="13" /><input v-model="recordQuery" type="search" aria-label="搜索对话" placeholder="搜索对话"><button aria-label="清除搜索" @click="recordSearchOpen = false; recordQuery = ''"><LegacyIcon name="close" :size="13" /></button></div></div><section v-for="group in sessionGroups" :key="group.key" class="dt-record-group"><h2>{{ group.label }}</h2><div v-for="row in group.rows" :key="row.session_id || row.id" class="dt-record-node-row" :class="{ 'is-active': route.params.sessionId === (row.session_id || row.id), 'is-editing': renameId === sessionIdOf(row) }"><template v-if="renameId === sessionIdOf(row)"><div class="dt-record-node-link dt-record-rename-wrap"><span class="dt-session-mark" :class="`is-${sessionMark(row)}`" aria-hidden="true" /><input v-model="renameValue" class="dt-record-rename" maxlength="100" aria-label="对话标题" autofocus @click.stop @keydown.stop @keydown.enter.prevent="saveRename" @keydown.esc.prevent="cancelRename" @blur="saveRename"></div></template><RouterLink v-else class="dt-record-node-link" :to="sessionHref(row)"><span class="dt-session-mark" :class="`is-${sessionMark(row)}`" aria-hidden="true" /><span class="dt-record-title">{{ displaySessionTitle(row) }}</span><span class="dt-record-time">{{ relativeTime(row) }}</span></RouterLink><div class="dt-session-actions"><button class="dt-nav-icon" title="聊天操作" aria-label="聊天操作" aria-haspopup="menu" :aria-expanded="sessionMenu === sessionIdOf(row)" @click.stop="openSessionMenu(row, $event)"><LegacyIcon name="more" :size="14" /></button><div v-if="sessionMenu === sessionIdOf(row) && sessionMenuPosition" class="dt-popover dt-session-menu" role="menu" :style="{ left: `${sessionMenuPosition.left}px`, top: `${sessionMenuPosition.top}px`, maxHeight: `${sessionMenuPosition.maxHeight}px`, transform: sessionMenuPosition.openUpward ? 'translateY(-100%)' : undefined, transformOrigin: sessionMenuPosition.openUpward ? 'bottom' : 'top' }" @click.stop><button class="dt-menu-item" role="menuitem" @click="startRename(row)"><LegacyIcon name="edit" :size="13" :stroke-width="1.7" /><span>重命名对话</span></button><button class="dt-menu-item" role="menuitem" @click="organizeSession(row, { pinned: !row.preferences?.pinned })"><LegacyIcon :name="row.preferences?.pinned ? 'pinOff' : 'pin'" :size="13" :stroke-width="1.7" /><span>{{ row.preferences?.pinned ? '取消置顶' : '置顶' }}</span></button><button class="dt-menu-item" role="menuitem" @click="organizeSession(row, { archived: !row.preferences?.archived })"><LegacyIcon :name="row.preferences?.archived ? 'archiveRestore' : 'archive'" :size="13" :stroke-width="1.7" /><span>{{ row.preferences?.archived ? '从归档恢复' : '归档' }}</span></button><template v-if="showWorkspaceMove(row)"><div class="dt-session-menu-divider" aria-hidden="true"></div><div class="dt-session-menu-caption">移动到工作区</div><button class="dt-menu-item" role="menuitem" :disabled="sessionActionBusy || row.status === 'running'" @click="moveSession(row, null)"><LegacyIcon name="folderOpen" :size="13" :stroke-width="1.7" /><span>通用工作区</span><LegacyIcon v-if="!workspaceOf(row)" name="check" :size="12" /></button><button v-for="workspace in menuWorkspaces(row)" :key="workspace.workspace_id" class="dt-menu-item" role="menuitem" :disabled="sessionActionBusy || workspace.archived || workspace.status !== 'ready' || row.status === 'running'" @click="moveSession(row, workspace.workspace_id)"><LegacyIcon name="folder" :size="13" :stroke-width="1.7" /><span>{{ workspace.display_name }}</span><LegacyIcon v-if="workspaceOf(row) === workspace.workspace_id" name="check" :size="12" /></button></template><div class="dt-session-menu-divider" aria-hidden="true"></div><button class="dt-menu-item legacy-danger" role="menuitem" @click="removeSession(row)"><LegacyIcon name="trash" :size="13" :stroke-width="1.7" /><span>删除对话</span></button></div></div></div></section><p v-if="!filteredSessions.length" class="dt-navigation-empty">{{ recordQuery ? '没有匹配的记录' : '开始对话后，会话会保留在这里。' }}</p><button v-if="hasMoreSessions" class="dt-navigation-row dt-record-more" @click="sessionLimit += 30"><LegacyIcon name="chevronDown" :size="15" />展开显示</button></section>
        </template>
        <template v-else-if="category === 'learning'"><div class="dt-learning-navigation"><div class="dt-overview-row" :class="{ 'is-active': route.path === '/learning/new' }"><RouterLink to="/learning/new"><LegacyIcon name="plus" /><span>新建学习</span></RouterLink></div><div class="dt-overview-row" :class="{ 'is-active': route.path === '/learning' }"><RouterLink to="/learning"><LegacyIcon name="resources" /><span>全部学习</span></RouterLink></div><div class="dt-record-header"><div class="dt-navigation-heading"><h2>学习记录 <span class="dt-navigation-count">{{ learningRows.length }}</span></h2><div class="dt-navigation-actions"><div class="dt-record-sort"><button class="dt-nav-icon" title="排序方式" aria-label="排序方式" aria-haspopup="menu" :aria-expanded="sortOpen" @click.stop="sortOpen = !sortOpen"><LegacyIcon name="arrowDownUp" :size="14" /></button><div v-if="sortOpen" class="dt-popover dt-record-sort-menu" role="menu" aria-label="排序方式" @click.stop><div class="dt-menu-label">排序方式</div><button class="dt-menu-item" role="menuitemradio" :aria-checked="learningSort === 'updatedAt'" @click="setLearningSort('updatedAt')">最后一次活跃 <LegacyIcon v-if="learningSort === 'updatedAt'" name="check" :size="14" /></button><button class="dt-menu-item" role="menuitemradio" :aria-checked="learningSort === 'createdAt'" @click="setLearningSort('createdAt')">创建时间 <LegacyIcon v-if="learningSort === 'createdAt'" name="check" :size="14" /></button></div></div><button class="dt-nav-icon" title="搜索学习记录" aria-label="搜索学习记录" :aria-expanded="recordSearchOpen" @click="recordSearchOpen = !recordSearchOpen"><LegacyIcon name="search" :size="14" /></button></div></div><div v-if="recordSearchOpen" class="dt-record-search"><LegacyIcon name="search" :size="13" /><input v-model="recordQuery" type="search" aria-label="搜索学习记录" placeholder="搜索学习记录"><button aria-label="清除搜索" @click="recordSearchOpen = false; recordQuery = ''"><LegacyIcon name="close" :size="12" /></button></div></div><div class="dt-learning-record-list" role="region" aria-label="学习记录" tabindex="0"><div v-if="learningLoading" class="dt-learning-loading" aria-busy="true"><i /><i /><i /></div><p v-else-if="learningFailed" class="dt-navigation-empty" role="status">学习记录加载失败。<button @click="loadLearningRecords">重试</button></p><template v-else><section v-for="group in learningGroups" :key="group.key" class="dt-record-group"><h2>{{ group.label }}</h2><template v-for="row in group.rows" :key="row.key"><div v-if="row.kind === 'record'" class="dt-record-node"><div class="dt-record-node-row" :class="{ 'is-active': isLearningRecordActive(row.record.href), 'is-open': learningRecordOpen(row) }"><button v-if="row.sessions.length" type="button" class="dt-record-toggle" :aria-expanded="learningRecordOpen(row)" :aria-label="`${learningRecordOpen(row) ? '收起' : '展开'} ${row.sessions.length} 个对话`" @click="toggleLearningRecord(row)"><LegacyIcon class="dt-record-glyph" :name="learningIcon(row.record.kind)" :size="16" :stroke-width="1.6" /><LegacyIcon class="dt-record-caret" name="chevronRight" :size="14" :stroke-width="2" /></button><span v-else class="dt-record-toggle is-static" aria-hidden="true"><LegacyIcon class="dt-record-glyph" :name="learningIcon(row.record.kind)" :size="16" :stroke-width="1.6" /></span><RouterLink class="dt-record-node-link" :to="row.record.href"><span class="dt-record-title">{{ row.record.title }}</span><span v-if="row.sessions.length && !learningRecordOpen(row)" class="dt-record-chat-count" :title="`${row.sessions.length} 个对话`"><LegacyIcon name="chat" :size="11" :stroke-width="1.8" />{{ row.sessions.length }}</span><time class="dt-record-time" :datetime="new Date(row.time * 1000).toISOString()" :title="new Date(row.time * 1000).toLocaleString('zh-CN')">{{ relativeTimeSeconds(row.time) }}</time></RouterLink></div><div v-if="row.sessions.length && learningRecordOpen(row)" class="dt-record-children"><div v-for="session in row.sessions" :key="sessionIdOf(session)" class="dt-record-node-row dt-learning-session-row" :class="{ 'is-active': route.params.sessionId === sessionIdOf(session) }"><RouterLink class="dt-record-node-link" :to="sessionHref(session)"><span class="dt-session-mark" :class="`is-${sessionMark(session)}`" aria-hidden="true" /><span class="dt-record-title">{{ displaySessionTitle(session) }}</span><time class="dt-record-time" :datetime="new Date(sessionTime(session)).toISOString()" :title="new Date(sessionTime(session)).toLocaleString('zh-CN')">{{ relativeTime(session) }}</time></RouterLink><div class="dt-session-actions"><button class="dt-nav-icon" title="聊天操作" aria-label="聊天操作" aria-haspopup="menu" :aria-expanded="sessionMenu === sessionIdOf(session)" @click.stop="openSessionMenu(session, $event)"><LegacyIcon name="more" :size="14" /></button></div></div></div></div><div v-else class="dt-record-loose"><RouterLink class="dt-record-node-link dt-learning-session-row" :to="sessionHref(row.session)"><span class="dt-session-mark" :class="`is-${sessionMark(row.session)}`" aria-hidden="true" /><span class="dt-record-title">{{ displaySessionTitle(row.session) }}</span><time class="dt-record-time" :datetime="new Date(row.time * 1000).toISOString()" :title="new Date(row.time * 1000).toLocaleString('zh-CN')">{{ relativeTimeSeconds(row.time) }}</time></RouterLink></div></template></section><p v-if="!filteredLearningRows.length" class="dt-navigation-empty">{{ recordQuery ? '没有匹配结果' : '新建一项学习，从这里开始。' }}</p><button v-if="hasMoreLearningRows" class="dt-navigation-row dt-record-more" @click="learningLimit += 30"><LegacyIcon name="chevronDown" :size="15" />展开显示</button></template></div></div></template>
        <template v-else-if="category === 'resources'"><div class="dt-overview-row"><RouterLink to="/space"><LegacyIcon name="resources" /><span>全部资料</span></RouterLink></div><section v-for="group in visibleResourceGroups" :key="group.label" class="dt-navigation-section"><div class="dt-navigation-heading"><span>{{ group.label }}</span></div><template v-for="item in group.items" :key="item.href"><button v-if="item.href === '/space/journal'" class="dt-navigation-row" :class="{ 'is-active': isActive(item.href) }" @click="router.push(item.href)"><LegacyIcon :name="item.icon" /><span>{{ item.label }}</span></button><RouterLink v-else class="dt-navigation-row" :class="{ 'is-active': isActive(item.href) }" :to="item.href"><LegacyIcon :name="item.icon" /><span>{{ item.label }}</span></RouterLink></template></section></template>
        <template v-else-if="category === 'partners'"><div class="dt-partner-navigation"><section class="dt-partner-preview" aria-labelledby="partner-preview-title"><div class="dt-navigation-heading"><h2 id="partner-preview-title">伙伴 <span class="dt-navigation-count">{{ partnerRoster.length }}</span></h2><div class="dt-navigation-actions"><RouterLink to="/partners#partners" aria-label="全部伙伴" class="dt-navigation-view-all">全部 <LegacyIcon name="chevronRight" :size="12" /></RouterLink><RouterLink to="/partners/new" aria-label="新建伙伴" class="dt-nav-icon"><LegacyIcon name="plus" :size="15" /></RouterLink></div></div><div v-if="partnerRoster.length" class="dt-partner-roster"><RouterLink v-for="partner in partnerRoster" :key="partner.partner_id" :to="`/partners/${encodeURIComponent(partner.partner_id)}`" class="dt-partner-roster-item"><PartnerAvatar :name="partner.name" :emoji="partner.emoji" :color="partner.color" :image="partner.avatar" :size="32" /><span>{{ partner.name }}</span></RouterLink></div><p v-else class="dt-navigation-empty">还没有伙伴</p></section><section class="dt-partner-preview" aria-labelledby="group-preview-title"><div class="dt-navigation-heading"><h2 id="group-preview-title">群组 <span class="dt-navigation-count">{{ partnerGroups.length }}</span></h2><div class="dt-navigation-actions"><RouterLink to="/partners#groups" aria-label="全部群组" class="dt-navigation-view-all">全部 <LegacyIcon name="chevronRight" :size="12" /></RouterLink><RouterLink v-if="partnerRoster.length >= 2" to="/partners/groups/new" aria-label="新建群组" class="dt-nav-icon"><LegacyIcon name="plus" :size="15" /></RouterLink></div></div><RouterLink v-for="group in partnerGroups.slice(0, 2)" :key="group.group_id" class="dt-navigation-row" :to="`/partners/groups/${encodeURIComponent(group.group_id)}`"><LegacyIcon name="partners" /><span>{{ group.name }}</span></RouterLink><p v-if="!partnerGroups.length" class="dt-navigation-empty">把两位或更多伙伴组成一个群组。</p></section><section class="dt-partner-sessions" aria-label="会话记录"><div class="dt-record-header"><div class="dt-navigation-heading"><span>会话记录 <span class="dt-navigation-count">{{ filteredPartnerSessions.length }}</span></span><div class="dt-navigation-actions"><button class="dt-nav-icon" aria-label="搜索伙伴会话" :aria-expanded="recordSearchOpen" @click="recordSearchOpen = !recordSearchOpen"><LegacyIcon name="search" :size="14" /></button></div></div></div><div v-if="recordSearchOpen" class="dt-record-search"><LegacyIcon name="search" :size="13" /><input v-model="recordQuery" type="search" aria-label="搜索伙伴会话" placeholder="搜索伙伴会话"><button v-if="recordQuery" aria-label="清除搜索" @click="recordQuery = ''"><LegacyIcon name="close" :size="12" /></button></div><div class="dt-partner-session-list" role="region" aria-label="会话记录"><RouterLink v-for="row in filteredPartnerSessions" :key="`${row.kind}:${row.owner_id}:${row.session_key}`" class="dt-navigation-row" :to="partnerSessionHref(row)"><LegacyIcon :name="row.kind === 'group' ? 'partners' : 'chat'" /><span class="dt-record-title">{{ row.title || '新对话' }}</span><small>{{ row.owner_name }}</small></RouterLink><p v-if="!filteredPartnerSessions.length" class="dt-navigation-empty">{{ recordQuery ? '没有匹配结果' : '开始对话后，会话会保留在这里。' }}</p></div></section></div></template>
        <template v-else><div class="dt-overview-row"><RouterLink to="/personalization"><LegacyIcon name="personalization" /><span>全部个性化</span></RouterLink></div><section class="dt-navigation-section"><RouterLink v-for="item in personalItems" :key="item.href" class="dt-navigation-row" :class="{ 'is-active': isActive(item.href) }" :to="item.href"><LegacyIcon :name="item.icon" /><span>{{ item.label }}</span></RouterLink></section></template>
      </div>
      <footer class="dt-sidebar-footer"><RouterLink class="dt-new-conversation" to="/chat"><LegacyIcon name="edit" /><span>新对话</span></RouterLink></footer><div class="dt-sidebar-resizer" role="separator" aria-label="调整侧边栏宽度" :aria-valuenow="width" @pointerdown="startResize" />
    </aside>
    <Teleport to="body"><div v-if="paletteOpen" class="dt-palette-backdrop" @click.self="paletteOpen = false"><section class="dt-palette" role="dialog" aria-modal="true" aria-label="搜索"><div class="dt-palette-field"><LegacyIcon name="search" :size="18" /><input ref="paletteInput" v-model="paletteQuery" placeholder="搜索页面、资料和设置…" @keydown.down.prevent="movePalette(1)" @keydown.up.prevent="movePalette(-1)" @keydown.enter.prevent="choosePalette"><kbd>esc</kbd></div><div class="dt-palette-results"><template v-for="group in paletteGroups" :key="group.label"><div class="dt-palette-group">{{ group.label }}</div><div v-for="item in group.items" :key="item.href" class="dt-palette-item" :aria-selected="paletteResults[paletteIndex] === item" role="option" @mousemove="paletteIndex = paletteResults.indexOf(item)" @click="goPalette(item.href)"><span class="dt-palette-icon"><LegacyIcon :name="item.icon" /></span><span>{{ item.label }}</span><span class="dt-palette-detail">{{ item.group }}</span></div></template><p v-if="!paletteResults.length" class="dt-palette-empty">没有匹配结果</p></div><div class="dt-palette-hints"><span><kbd>↑</kbd><kbd>↓</kbd> 浏览</span><span><kbd>↵</kbd> 打开</span></div></section></div></Teleport>
    
  </div>
</template>
