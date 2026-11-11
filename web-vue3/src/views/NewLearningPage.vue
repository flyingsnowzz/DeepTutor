<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { api } from '../api'
import LegacyIcon from '../components/LegacyIcon.vue'
import LearningCustomizeDialog from '../components/LearningCustomizeDialog.vue'

interface Module { installed: boolean; enabled: boolean; navigation: string[] }
interface Auth { learning_policy?: { allowed_surfaces?: string[] } }
interface Customization { learning?: { hidden_features?: string[] } }
const modules = ref<Module[]>([])
const allowed = ref<string[] | null>(null)
const hidden = ref<string[]>([])
const customizeOpen = ref(false)
const loading = ref(true)
const busy = ref(false)
const error = ref('')
const inventoryFailed = ref(false)
const surfaces = [
  { kind: 'books', href: '/learning/books', title: '书籍', description: '生成、浏览并学习你的 AI 编写书籍。', icon: 'learning', tone: 'amber' },
  { kind: 'mastery', href: '/learning/mastery', title: '精通之路', description: '沿着持续完善的知识图谱，逐步掌握一个主题。', icon: 'resources', tone: 'emerald' },
  { kind: 'practice', href: '/learning/practice', title: '练习', description: '管理题库、整理错题，每天巩固所学。', icon: 'questions', tone: 'sky' },
  { kind: 'reading', href: '/learning/reading', title: '沉浸式阅读', description: '在导师陪伴下，深入阅读你的资料。', icon: 'journal', tone: 'sky' },
] as const
const available = computed(() => {
  // Module inventory fails closed: never offer a surface whose owner may be disabled.
  if (inventoryFailed.value) return []
  return surfaces.filter(item => {
    const owners = modules.value.filter(module => module.navigation.some(prefix => item.href === prefix || item.href.startsWith(`${prefix}/`)))
    return owners.every(module => module.installed && module.enabled) && (!allowed.value || allowed.value.includes(item.kind === 'mastery' || item.kind === 'practice' ? 'chat' : item.kind))
  })
})
const visible = computed(() => available.value.filter(item => !hidden.value.includes(item.kind)))
async function load() {
  loading.value = true
  error.value = ''
  inventoryFailed.value = false
  const [inventory, auth, prefs] = await Promise.all([
    api<{ modules: Module[] }>('/api/modules').then(result => ({ result })).catch(cause => ({ cause })),
    api<Auth>('/api/auth/status').catch(() => null),
    api<Customization>('/api/settings/page-customization').then(result => ({ result })).catch(cause => ({ cause })),
  ])
  if ('cause' in inventory) {
    inventoryFailed.value = true
    error.value = '学习模块清单加载失败，请刷新重试。'
  } else modules.value = inventory.result.modules
  if (auth?.learning_policy) {
    const surfaces = (auth.learning_policy.allowed_surfaces ?? ['chat', 'reading']).filter(item => item.trim())
    allowed.value = surfaces.length ? surfaces : ['chat', 'reading']
  } else allowed.value = null
  if ('cause' in prefs) {
    hidden.value = []
    error.value = '学习入口设置加载失败，请刷新重试。'
  } else hidden.value = prefs.result.learning?.hidden_features || []
  loading.value = false
}
onMounted(load)
async function toggle(kind: string) {
  busy.value = true
  error.value = ''
  const next = hidden.value.includes(kind) ? hidden.value.filter(item => item !== kind) : [...hidden.value, kind]
  try {
    const result = await api<Customization>('/api/settings/page-customization/learning', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hidden_features: next }),
    })
    hidden.value = result.learning?.hidden_features || next
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '保存入口设置失败' }
  finally { busy.value = false }
}
</script>

<template>
  <main class="feature-page new-learning-page">
    <header class="new-learning-page-bar"><span class="dt-crumb is-feature"><LegacyIcon name="plus" :size="15" />新建学习</span><button type="button" class="new-learning-customize-button" @click="customizeOpen = true"><LegacyIcon name="personalization" :size="14" />自定义页面</button></header>
    <p v-if="error" class="error" role="alert">{{ error }} <button type="button" @click="load">重试</button></p>
    <p v-if="loading" class="muted" role="status">加载中…</p>
    <div v-if="!loading && visible.length" class="new-learning-grid"><RouterLink v-for="item in visible" :key="item.kind" :to="`${item.href}?create=1`" class="new-learning-card"><span class="new-learning-card-top"><span class="learning-way-icon" :class="`tone-${item.tone}`"><LegacyIcon :name="item.icon" :size="23" /></span><span class="learning-way-arrow">↗</span></span><strong>{{ item.title }}</strong><span>{{ item.description }}</span></RouterLink></div>
    <div v-if="!loading && !visible.length && !inventoryFailed" class="learning-empty"><LegacyIcon name="settings" :size="28" /><h2>为下一次学习做好准备</h2><p>通过自定义页面添加学习方式。未安装或已禁用的模块可在设置 → 运行时中查看。</p><button class="primary" @click="customizeOpen = true">自定义页面</button></div>
    <p v-if="!loading" class="new-learning-footer">自定义设置会保存到你的账户；此处仅显示当前环境中可用的学习方式。</p>
    <LearningCustomizeDialog v-if="customizeOpen" :surfaces="available" @close="customizeOpen = false" @saved="hidden = $event.learning.hidden_features; customizeOpen = false" />
  </main>
</template>
