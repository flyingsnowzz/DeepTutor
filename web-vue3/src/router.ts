import { createRouter, createWebHistory } from 'vue-router'
import { authStatus } from './api'
import AuthPage from './views/AuthPage.vue'
import ChatPage from './views/ChatPage.vue'
import AppLayout from './views/AppLayout.vue'
import AdminPage from './views/AdminPage.vue'
const KanbanPage = () => import('./views/KanbanPage.vue')
const NotebooksPage = () => import('./views/NotebooksPage.vue')
const KnowledgeBasesPage = () => import('./views/KnowledgeBasesPage.vue')
const ProfilePage = () => import('./views/ProfilePage.vue')
const MemoryPage = () => import('./views/MemoryPage.vue')
const MemoryGraphPage = () => import('./views/MemoryGraphPage.vue')
const MemoryResolvePage = () => import('./views/MemoryResolvePage.vue')
const ChatHistoryPage = () => import('./views/ChatHistoryPage.vue')
const SettingsPage = () => import('./views/SettingsPage.vue')
const PartnersPage = () => import('./views/PartnersPage.vue')
const PartnerCreatePage = () => import('./views/PartnerCreatePage.vue')
const PartnerDetailPage = () => import('./views/PartnerDetailPage.vue')
const BooksPage = () => import('./views/BooksPage.vue')
const LearningHomePage = () => import('./views/LearningHomePage.vue')
const MasteryPage = () => import('./views/MasteryPage.vue')
const ReadingPage = () => import('./views/ReadingPage.vue')
const ReadingStudyPage = () => import('./views/ReadingStudyPage.vue')
const CalendarPage = () => import('./views/CalendarPage.vue')
const SpacePage = () => import('./views/SpacePage.vue')
const CliAppsPage = () => import('./views/CliAppsPage.vue')
const McpPage = () => import('./views/McpPage.vue')
const PersonasPage = () => import('./views/PersonasPage.vue')
const SkillsPage = () => import('./views/SkillsPage.vue')
const JournalPage = () => import('./views/JournalPage.vue')
const QuestionBankPage = () => import('./views/QuestionBankPage.vue')
const AgentsPage = () => import('./views/AgentsPage.vue')
const SessionHandoffPage = () => import('./views/SessionHandoffPage.vue')
const HandoffPage = () => import('./views/HandoffPage.vue')
const NewLearningPage = () => import('./views/NewLearningPage.vue')
const LegacyWatchingPage = () => import('./views/LegacyWatchingPage.vue')
const AvatarPreviewPage = () => import('./views/AvatarPreviewPage.vue')
const PracticePage = () => import('./views/PracticePage.vue')
const CoWriterHomePage = () => import('./views/CoWriterHomePage.vue')
const CoWriterDocumentPage = () => import('./views/CoWriterDocumentPage.vue')
const WhisperPage = () => import('./views/WhisperPage.vue')

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/chat' },
    { path: '/login', component: AuthPage, props: { mode: 'login' } },
    { path: '/register', component: AuthPage, props: { mode: 'register' } },
    { path: '/admin/login', component: AuthPage, props: { mode: 'admin' } },
    { path: '/handoff', component: HandoffPage },
    { path: '/session-handoff', component: SessionHandoffPage, meta: { protected: true } },
    { path: '/admin/accounts', component: AdminPage, props: { mode: 'accounts' }, meta: { protected: true, admin: true } },
    { path: '/admin/users', component: AdminPage, props: { mode: 'users' }, meta: { protected: true, admin: true } },
    {
      path: '/', component: AppLayout, meta: { protected: true }, children: [
        { path: 'chat', component: ChatPage },
        { path: 'chat/:sessionId', component: ChatPage },
        { path: 'kanban', component: KanbanPage },
        { path: 'calendar', component: CalendarPage },
        { path: 'agents', component: AgentsPage },
        { path: 'avatar-preview', component: AvatarPreviewPage },
        { path: 'co-writer', component: CoWriterHomePage },
        { path: 'co-writer/:docId', component: CoWriterDocumentPage },
        { path: 'whisper', component: WhisperPage },
        { path: 'notebooks', component: NotebooksPage },
        { path: 'notebooks/:notebookId', component: NotebooksPage },
        { path: 'knowledge-bases', component: KnowledgeBasesPage },
        { path: 'knowledge-bases/:kbName', component: KnowledgeBasesPage },
        { path: 'profile', component: ProfilePage },
        { path: 'memory', component: MemoryPage },
        { path: 'memory/graph', component: MemoryGraphPage },
        { path: 'memory/resolve', component: MemoryResolvePage },
        { path: 'memory/l1', component: MemoryPage },
        { path: 'memory/l2', component: MemoryPage },
        { path: 'memory/l2/:surface', component: MemoryPage },
        { path: 'memory/l3', component: MemoryPage },
        { path: 'memory/l3/:slot', component: MemoryPage },
        { path: 'space', component: SpacePage },
        { path: 'personalization', component: SpacePage, props: { personal: true } },
        { path: 'space/cli-apps', component: CliAppsPage },
        { path: 'space/mcp', component: McpPage },
        { path: 'space/personas', component: PersonasPage },
        { path: 'space/skills', component: SkillsPage },
        { path: 'space/journal', component: JournalPage },
        { path: 'space/questions', component: QuestionBankPage },
        { path: 'space/chat-history', component: ChatHistoryPage },
        { path: 'settings', component: SettingsPage },
        { path: 'settings/:section', component: SettingsPage },
        { path: 'partners', component: PartnersPage },
        { path: 'partners/new', component: PartnerCreatePage, props: { kind: 'partner' } },
        { path: 'partners/groups/new', component: PartnerCreatePage, props: { kind: 'group' } },
        { path: 'partners/groups/:groupId', component: PartnerDetailPage, props: { kind: 'group' } },
        { path: 'partners/:partnerId', component: PartnerDetailPage, props: { kind: 'partner' } },
        { path: 'learning/books', component: BooksPage },
        { path: 'learning/books/:bookId', component: BooksPage },
        { path: 'learning/books/:bookId/pages/:pageId', component: BooksPage },
        { path: 'learning', component: LearningHomePage },
        { path: 'learning/new', component: NewLearningPage },
        { path: 'learning/practice', component: PracticePage },
        { path: 'learning/watching', redirect: to => ({ path: '/learning/reading', query: to.query, hash: to.hash }) },
        { path: 'learning/watching/:sessionId', component: LegacyWatchingPage },
        { path: 'learning/mastery', component: MasteryPage },
        { path: 'learning/mastery/:pathId', component: MasteryPage },
        { path: 'learning/mastery/:pathId/sessions', component: ChatPage, props: { mastery: true } },
        { path: 'learning/mastery/:pathId/sessions/:sessionId', component: ChatPage, props: { mastery: true } },
        { path: 'learning/reading', component: ReadingPage },
        { path: 'learning/reading/materials', component: ReadingPage },
        { path: 'learning/reading/folders/:folderId', component: ReadingPage },
        { path: 'learning/reading/:workspaceId', component: ReadingPage },
        { path: 'learning/reading/:workspaceId/sessions', component: ReadingStudyPage },
        { path: 'learning/reading/:workspaceId/sessions/:sessionId', component: ReadingStudyPage },
      ],
    },
  ],
})

router.beforeEach(async to => {
  const SETTINGS_RETURN_KEY = 'deeptutor:settings-return'
  if (!to.path.startsWith('/settings') && !to.path.startsWith('/login') && !to.path.startsWith('/register')) {
    try {
      const url = new URL(to.fullPath, window.location.origin)
      url.searchParams.delete('dt_workspace')
      url.searchParams.delete('workspace')
      sessionStorage.setItem(SETTINGS_RETURN_KEY, url.pathname + url.search + url.hash)
    } catch {
      /* Return-to-app falls back to /chat when storage is unavailable. */
    }
  }
  if (!to.matched.some(route => route.meta.protected)) return true
  try {
    const status = await authStatus()
    if (!status.enabled) return true
    if (status.authenticated) {
      if (to.matched.some(route => route.meta.admin) && !status.is_admin) return '/chat'
      if (status.is_admin && !to.matched.some(route => route.meta.admin)) return '/admin/users'
      return true
    }
    const login = to.matched.some(route => route.meta.admin) ? '/admin/login' : '/login'
    return { path: login, query: { next: to.fullPath } }
  } catch {
    return true // The page renders a connection error when the API is unavailable.
  }
})
