<script setup lang="ts">
import { computed, ref } from 'vue'
import LegacyIcon from './LegacyIcon.vue'
import type { NoteSummary } from '../notes/noteTypes'

const props = defineProps<{
  pages: NoteSummary[]
  currentId: string
  busy: boolean
}>()
const emit = defineEmits<{ open: [id: string]; create: [parentId: string | null] }>()
const collapsed = ref(new Set<string>())

interface TreeRow { page: NoteSummary; depth: number; hasChildren: boolean }
const rows = computed(() => {
  const result: TreeRow[] = []
  const visit = (parentId: string | null, depth: number, ancestors: Set<string>) => {
    const children = props.pages
      .filter(item => item.parent_id === parentId && !ancestors.has(item.id))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned))
    for (const page of children) {
      const hasChildren = props.pages.some(item => item.parent_id === page.id)
      result.push({ page, depth, hasChildren })
      if (hasChildren && !collapsed.value.has(page.id)) {
        visit(page.id, depth + 1, new Set([...ancestors, page.id]))
      }
    }
  }
  visit(null, 0, new Set())
  return result
})

function toggle(pageId: string) {
  const next = new Set(collapsed.value)
  if (next.has(pageId)) next.delete(pageId)
  else next.add(pageId)
  collapsed.value = next
}
</script>

<template>
  <nav id="note-page-tree" class="dt-note-page-tree" aria-label="页面树">
    <div class="dt-note-tree-heading">
      <RouterLink to="/co-writer">笔记本</RouterLink>
      <button class="dt-note-icon-button" aria-label="新建页面" title="新建页面" :disabled="busy" @click="emit('create', null)">
        <LegacyIcon name="plus" :size="15" />
      </button>
    </div>
    <div class="dt-note-tree-scroll">
      <ul class="dt-note-tree-roots">
        <li v-for="row in rows" :key="row.page.id">
          <div class="dt-note-tree-row" :class="{ 'is-current': row.page.id === currentId }" :style="{ paddingLeft: `${row.depth * 14}px` }">
            <button
              v-if="row.hasChildren"
              class="dt-note-tree-toggle"
              :aria-label="`${collapsed.has(row.page.id) ? '展开' : '折叠'}${row.page.title || '未命名页面'}`"
              :aria-expanded="!collapsed.has(row.page.id)"
              @click="toggle(row.page.id)"
            >
              <LegacyIcon name="chevronRight" :size="13" :class="{ 'rotate-90': !collapsed.has(row.page.id) }" />
            </button>
            <span v-else class="dt-note-tree-toggle" />
            <RouterLink
              :to="`/co-writer/${row.page.id}`"
              :aria-current="row.page.id === currentId ? 'page' : undefined"
              @click.prevent="emit('open', row.page.id)"
            >
              <span class="dt-note-tree-icon" aria-hidden="true">
                <span v-if="row.page.icon">{{ row.page.icon }}</span>
                <LegacyIcon v-else name="document" :size="15" />
              </span>
              <span class="truncate">{{ row.page.title || '未命名页面' }}</span>
            </RouterLink>
            <button
              class="dt-note-tree-add"
              :aria-label="`在${row.page.title || '未命名页面'}内新建页面`"
              title="在页面内新建"
              :disabled="busy"
              @click="emit('create', row.page.id)"
            >
              <LegacyIcon name="plus" :size="14" />
            </button>
          </div>
        </li>
      </ul>
    </div>
  </nav>
</template>
