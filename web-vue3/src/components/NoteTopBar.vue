<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import LegacyIcon from './LegacyIcon.vue'
import type { NoteMetadataPatch, NotePage, NoteSummary } from '../notes/noteTypes'

const props = defineProps<{
  page: NotePage | null
  pages: NoteSummary[]
  invalidParents: Set<string>
  status: string
  busy: boolean
  treeOpen: boolean
  companionOpen: boolean
}>()
const emit = defineEmits<{
  toggleTree: []
  toggleCompanion: []
  open: [id: string]
  create: []
  metadata: [patch: NoteMetadataPatch]
  favorite: []
  export: [format: 'md' | 'docx']
}>()
const root = ref<HTMLElement | null>(null)
const switcherOpen = ref(false)
const menuOpen = ref(false)
const moving = ref(false)
const moveQuery = ref('')
const pageQuery = ref('')

const byId = computed(() => new Map(props.pages.map(item => [item.id, item])))
const ancestors = computed(() => {
  const result: NoteSummary[] = []
  const seen = new Set<string>()
  let parent = props.page?.parent_id ? byId.value.get(props.page.parent_id) : undefined
  while (parent && result.length < 12 && !seen.has(parent.id)) {
    result.unshift(parent)
    seen.add(parent.id)
    parent = parent.parent_id ? byId.value.get(parent.parent_id) : undefined
  }
  return result.length > 2 ? [result[0], null, result.at(-1)] as (NoteSummary | null)[] : result
})
const sortedPages = computed(() => [...props.pages].sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0)))
const filteredPages = computed(() => {
  const query = pageQuery.value.trim().toLowerCase()
  return sortedPages.value.filter(item => !query || item.title.toLowerCase().includes(query))
})
const moveTargets = computed(() => {
  const query = moveQuery.value.trim().toLowerCase()
  return props.pages.filter(item => item.id !== props.page?.id && !props.invalidParents.has(item.id) && item.title.toLowerCase().includes(query))
})

function closeMenus() {
  switcherOpen.value = false
  menuOpen.value = false
  moving.value = false
  moveQuery.value = ''
  pageQuery.value = ''
}
function outside(event: PointerEvent) {
  if (root.value && !root.value.contains(event.target as Node)) closeMenus()
}
function escape(event: KeyboardEvent) { if (event.key === 'Escape') closeMenus() }
onMounted(() => {
  document.addEventListener('pointerdown', outside)
  document.addEventListener('keydown', escape)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', outside)
  document.removeEventListener('keydown', escape)
})
function openPage(pageId: string) { closeMenus(); emit('open', pageId) }
function createPage() { closeMenus(); emit('create') }
function metadata(patch: NoteMetadataPatch) { closeMenus(); emit('metadata', patch) }
</script>

<template>
  <header ref="root" class="dt-note-topbar co-writer-document-bar">
    <button
      class="dt-note-icon-button"
      aria-label="页面树"
      :title="treeOpen ? '隐藏页面' : '显示页面'"
      :aria-expanded="treeOpen"
      aria-controls="note-page-tree"
      @click="emit('toggleTree')"
    >
      <LegacyIcon name="panelLeft" :size="16" />
    </button>
    <nav class="dt-note-breadcrumb" aria-label="面包屑">
      <span class="dt-note-feature">
        <RouterLink to="/co-writer" class="dt-crumb is-feature"><LegacyIcon name="edit" :size="16" /><span>笔记本</span></RouterLink>
      </span>
      <template v-for="(ancestor, index) in ancestors" :key="ancestor?.id || `gap-${index}`">
        <span aria-hidden="true" class="dt-crumb-sep">/</span>
        <span v-if="!ancestor" class="dt-note-crumb is-gap">…</span>
        <RouterLink v-else :to="`/co-writer/${ancestor.id}`" class="dt-note-crumb" @click.prevent="openPage(ancestor.id)">
          <span v-if="ancestor.icon" aria-hidden="true">{{ ancestor.icon }}</span>
          <span class="truncate">{{ ancestor.title || '未命名页面' }}</span>
        </RouterLink>
      </template>
      <span v-if="page" class="dt-note-current" aria-current="page">
        <span aria-hidden="true" class="dt-crumb-sep">/</span>
        <div class="relative min-w-0">
          <button class="dt-crumb is-instance" aria-haspopup="menu" :aria-expanded="switcherOpen" @click="switcherOpen = !switcherOpen; menuOpen = false">
            <span v-if="page.icon" aria-hidden="true">{{ page.icon }}</span>
            <span class="truncate">{{ page.title || '未命名页面' }}</span>
            <LegacyIcon name="chevronDown" :size="13" class="dt-crumb-caret" />
          </button>
          <div v-if="switcherOpen" role="menu" aria-label="笔记页面" class="dt-popover dt-crumb-panel is-instances">
            <label v-if="pages.length > 7" class="dt-crumb-search">
              <LegacyIcon name="search" :size="14" />
              <input v-model="pageQuery" aria-label="搜索页面" placeholder="搜索" autofocus>
            </label>
            <button role="menuitem" class="dt-menu-item" @click="createPage"><LegacyIcon name="plus" :size="16" /><span class="min-w-0 flex-1 truncate">新建页面</span></button>
            <div class="dt-menu-label">笔记页面</div>
            <div class="dt-crumb-rows">
              <button
                v-for="item in filteredPages"
                :key="item.id"
                role="menuitem"
                class="dt-menu-item"
                :aria-current="item.id === page.id ? 'page' : undefined"
                @click="openPage(item.id)"
              >
                <span v-if="item.icon" aria-hidden="true">{{ item.icon }}</span>
                <span class="min-w-0 flex-1 truncate">{{ item.title || '未命名页面' }}</span>
                <LegacyIcon v-if="item.id === page.id" name="check" :size="14" class="dt-crumb-check" />
              </button>
              <p v-if="!filteredPages.length" class="dt-crumb-empty">没有匹配页面</p>
            </div>
            <div class="dt-menu-divider" />
            <RouterLink role="menuitem" to="/co-writer" class="dt-menu-item is-quiet" @click="closeMenus"><span class="min-w-0 flex-1 truncate">全部页面</span></RouterLink>
          </div>
        </div>
        <LegacyIcon v-if="page.pinned" name="pin" :size="11" class="shrink-0 opacity-50" aria-label="已置顶页面" />
      </span>
    </nav>
    <span class="dt-note-status" :class="{ 'is-error': status === '保存失败', 'is-idle': status === '已保存' }" role="status">{{ status }}</span>
    <button class="dt-note-ask" :class="{ 'is-active': companionOpen }" aria-label="伴读助手" :aria-pressed="companionOpen" @click="emit('toggleCompanion')">
      <LegacyIcon name="sparkles" :size="14" />问 Dito
    </button>
    <div class="relative">
      <button class="dt-note-icon-button" aria-label="更多页面操作" aria-haspopup="menu" :aria-expanded="menuOpen" :disabled="!page" @click="menuOpen = !menuOpen; switcherOpen = false">
        <LegacyIcon name="more" :size="16" />
      </button>
      <div v-if="menuOpen && page" class="dt-popover dt-note-page-menu" role="menu">
        <template v-if="moving">
          <button role="menuitem" class="dt-menu-item is-quiet" @click="moving = false"><LegacyIcon name="arrowLeft" :size="14" />移动到</button>
          <input v-model="moveQuery" class="dt-note-menu-search" aria-label="搜索页面" placeholder="搜索页面…" autofocus>
          <div class="dt-note-move-list">
            <button v-if="!moveQuery.trim()" role="menuitem" class="dt-menu-item" :disabled="busy" @click="metadata({ parent_id: null })">
              <LegacyIcon name="document" :size="14" /><span class="flex-1 truncate">顶层页面</span><LegacyIcon v-if="!page.parent_id" name="check" :size="14" />
            </button>
            <button v-for="target in moveTargets" :key="target.id" role="menuitem" class="dt-menu-item" :disabled="busy" @click="metadata({ parent_id: target.id })">
              <span class="dt-note-menu-glyph" aria-hidden="true"><span v-if="target.icon">{{ target.icon }}</span><LegacyIcon v-else name="document" :size="14" /></span>
              <span class="flex-1 truncate">{{ target.title || '未命名页面' }}</span>
              <LegacyIcon v-if="page.parent_id === target.id" name="check" :size="14" />
            </button>
            <p v-if="!moveTargets.length && moveQuery.trim()" class="dt-note-menu-empty">没有匹配页面</p>
          </div>
        </template>
        <template v-else>
          <button role="menuitem" class="dt-menu-item" :disabled="busy" @click="metadata({ pinned: !page.pinned })">
            <LegacyIcon :name="page.pinned ? 'pinOff' : 'pin'" :size="14" />{{ page.pinned ? '取消置顶' : '置顶到顶部' }}
          </button>
          <button role="menuitem" class="dt-menu-item" :disabled="busy" @click="moving = true"><LegacyIcon name="cornerUpRight" :size="14" /><span class="flex-1">移动到</span><LegacyIcon name="chevronRight" :size="13" class="opacity-50" /></button>
          <button role="menuitem" class="dt-menu-item" @click="closeMenus(); emit('favorite')"><LegacyIcon name="bookmark" :size="14" />插入收藏</button>
          <div class="dt-menu-divider" />
          <button role="menuitem" class="dt-menu-item" @click="closeMenus(); emit('export', 'md')"><LegacyIcon name="fileDown" :size="14" />导出 Markdown</button>
          <button role="menuitem" class="dt-menu-item" @click="closeMenus(); emit('export', 'docx')"><LegacyIcon name="fileDown" :size="14" /><span class="flex-1">导出 Word</span></button>
          <p class="dt-note-menu-note">Word 导出保留文字和来源链接；交互块会转换为静态内容。</p>
        </template>
      </div>
    </div>
  </header>
</template>
