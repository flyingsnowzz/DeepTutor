<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { api } from '../api'
import LegacyIcon from '../components/LegacyIcon.vue'

const props = withDefaults(defineProps<{ personal?: boolean }>(), { personal: false })
interface Tile {
  title: string
  description: string
  href: string
  unit?: string
  endpoint?: string
  count?: (data: any) => number
  requiresCapability?: string
  icon: string
  tone: string
  credit?: string
}
const workspaceGroups: { title: string; items: Tile[] }[] = [
  { title: '对话与资料', items: [
    { title: '聊天历史', icon: 'history', tone: 'sky', description: '回顾并继续此前的对话。', href: '/space/chat-history', unit: '段对话', endpoint: '/api/sessions?limit=200&offset=0&force=true', count: data => (data.sessions || []).length },
    { title: '收藏夹', icon: 'bookmark', tone: 'amber', description: '收藏对话和资料的原文，随时引用到笔记本。', href: '/notebooks', unit: '个收藏夹', endpoint: '/api/notebooks', count: data => (data.notebooks || []).length },
    { title: '学习日志', icon: 'journal', tone: 'teal', description: '查看当前目标、上次会话交接和已确认的学习记录。', href: '/space/journal' },
    { title: '题库', icon: 'questions', tone: 'emerald', description: '跨会话回顾和整理测验题目。', href: '/space/questions', unit: '道题', endpoint: '/api/question-notebook/entries?limit=1', count: data => Number(data.total || 0) },
    { title: '知识中心', icon: 'knowledge', tone: 'blue', description: '管理知识库与检索引擎。', href: '/knowledge-bases', unit: '个知识库', endpoint: '/api/knowledge-bases/list', count: data => Array.isArray(data) ? data.length : (data.knowledge_bases || data.items || []).length },
  ] },
  { title: '更多项目', items: [
    { title: '密语', icon: 'chat', tone: 'fuchsia', description: '双席位咨询练习房间：督导只对受训者耳语。', href: '/whisper', requiresCapability: 'whisper_visitor' },
  ] },
]
const personalGroups: { title: string; items: Tile[] }[] = [
  { title: '个性化', items: [
    { title: '子智能体', icon: 'agents', tone: 'slate', description: '连接本机或远程的智能体，在对话中随时请教。', href: '/agents', unit: '个智能体', endpoint: '/api/subagents/connections', count: data => (data.connections || []).length },
    { title: 'Personas', icon: 'profile', tone: 'rose', description: '可在每轮对话中套用的行为预设。', href: '/space/personas', unit: '个预设', endpoint: '/api/personas', count: data => (data.personas || []).length },
    { title: '技能', icon: 'skills', tone: 'indigo', description: '模型按需读取的能力手册。', href: '/space/skills', unit: '个技能', endpoint: '/api/skills/list', count: data => (data.skills || []).length },
    { title: 'MCP 服务', icon: 'plug', tone: 'blue', description: '连接托管 MCP 服务，把它们的工具带进对话。', href: '/space/mcp', unit: '个服务', endpoint: '/api/space/mcp/servers', count: data => Object.keys(data.servers || {}).length },
    { title: 'CLI 应用', icon: 'terminal', tone: 'violet', description: '来自 CLI-Anything 目录的命令行工具，启用后对话可直接调用。', href: '/space/cli-apps', unit: '个应用', endpoint: '/api/space/cli-apps/apps', count: data => (data.apps || []).filter((item: { granted: boolean; enabled: boolean }) => item.granted && item.enabled).length },
    { title: '记忆', icon: 'memory', tone: 'rose', description: '查看与整理导师记住的偏好和学习经历。', href: '/memory' },
  ] },
]
const counts = ref<Record<string, number>>({})
const spaceMenuOpen = ref(false)
const capabilities = ref<Set<string>>(new Set())
const capabilityReady = ref(false)
let active = true
const requestedCounts = new Set<string>()

const visibleGroups = computed(() => {
  const source = props.personal ? personalGroups : workspaceGroups
  return source.map(group => ({
    ...group,
    items: group.items.filter(item => !item.requiresCapability || (capabilityReady.value && capabilities.value.has(item.requiresCapability))),
  })).filter(group => group.items.length > 0)
})

watch(visibleGroups, async groups => {
  // Each tile loads independently: a failed or slow endpoint never blanks the hub.
  await Promise.all(groups.flatMap(group => group.items).map(async item => {
    if (!item.endpoint || !item.count || requestedCounts.has(item.endpoint)) return
    requestedCounts.add(item.endpoint)
    try {
      const data = await api<any>(item.endpoint)
      if (active) counts.value[item.href] = item.count(data)
    } catch { /* Omit an unavailable count, while keeping its navigation usable. */ }
  }))
}, { immediate: true, deep: true })

onMounted(async () => {
  try {
    const payload = await api<any>('/api/capabilities/registered')
    const descriptors = Array.isArray(payload) ? payload : payload.capabilities || payload.registered || []
    capabilities.value = new Set(descriptors.filter((item: any) => item.available !== false).map((item: any) => String(item.id || item.name || '')))
  } catch { capabilities.value = new Set() }
  finally { capabilityReady.value = true }
})
onBeforeUnmount(() => { active = false })
</script>

<template>
  <main class="feature-page space-page" :class="{ 'is-personal': personal }">
    <nav class="space-page-bar" aria-label="位置"><div class="space-crumb-wrap"><button type="button" class="space-crumb" aria-haspopup="menu" :aria-expanded="spaceMenuOpen" @click.stop="spaceMenuOpen = !spaceMenuOpen" @keydown.esc="spaceMenuOpen = false"><span aria-hidden="true">▥</span>{{ personal ? '全部个性化' : '全部资料' }}</button><template v-if="spaceMenuOpen"><div class="space-menu-dismiss" @click="spaceMenuOpen = false"></div><div class="space-resource-menu" role="menu" :aria-label="personal ? '个性化' : '资料'"><p>{{ personal ? '个性化' : '资料' }}</p><template v-if="!personal"><RouterLink role="menuitem" class="is-active" to="/space" @click="spaceMenuOpen = false">全部资料</RouterLink><RouterLink role="menuitem" to="/space/chat-history" @click="spaceMenuOpen = false">聊天历史</RouterLink><RouterLink role="menuitem" to="/notebooks" @click="spaceMenuOpen = false">收藏夹</RouterLink><RouterLink role="menuitem" to="/space/journal" @click="spaceMenuOpen = false">学习日志</RouterLink><RouterLink role="menuitem" to="/space/questions" @click="spaceMenuOpen = false">题库</RouterLink><RouterLink role="menuitem" to="/knowledge-bases" @click="spaceMenuOpen = false">知识中心</RouterLink></template><template v-else><RouterLink role="menuitem" class="is-active" to="/personalization" @click="spaceMenuOpen = false">全部个性化</RouterLink><RouterLink role="menuitem" to="/agents" @click="spaceMenuOpen = false">子智能体</RouterLink><RouterLink role="menuitem" to="/space/personas" @click="spaceMenuOpen = false">Personas</RouterLink><RouterLink role="menuitem" to="/space/skills" @click="spaceMenuOpen = false">技能</RouterLink><RouterLink role="menuitem" to="/space/mcp" @click="spaceMenuOpen = false">MCP 服务</RouterLink><RouterLink role="menuitem" to="/space/cli-apps" @click="spaceMenuOpen = false">CLI 应用</RouterLink><RouterLink role="menuitem" to="/memory" @click="spaceMenuOpen = false">记忆</RouterLink></template></div></template></div></nav>
    <div class="space-page-content"><header class="feature-heading"><div><h1>{{ personal ? '个性化' : '资料' }}</h1><p>{{ personal ? '你的子智能体、回答风格、技能、连接器与记忆——跟随账号，在每个工作区通用。' : '你的对话、智能体、笔记与题目，集中在一处 —— 从这里进入。' }}</p></div></header>
    <section v-for="group in visibleGroups" :key="group.title">
      <h2>{{ group.title }}</h2>
      <div class="partner-grid">
        <RouterLink v-for="item in group.items" :key="item.href" :to="item.href" class="partner-card dashboard-card">
          <div class="dashboard-card-top"><span class="dashboard-card-icon" :class="`tone-${item.tone}`"><LegacyIcon :name="item.icon" :size="18" :stroke-width="1.7" /></span><div class="dashboard-card-heading"><h3>{{ item.title }}</h3><div v-if="item.unit" class="dashboard-card-count"><template v-if="counts[item.href] !== undefined"><strong>{{ counts[item.href].toLocaleString() }}</strong><span> {{ item.unit }}</span></template><i v-else /></div></div><span class="dashboard-card-arrow"><LegacyIcon name="arrowUpRight" :size="16" /></span></div>
          <p>{{ item.description }}</p><small v-if="item.credit" class="dashboard-card-credit"><LegacyIcon name="github" :size="11" />{{ item.credit }}</small>
        </RouterLink>
      </div>
    </section>
    </div>
  </main>
</template>
