<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

export interface CategoryOption { id: number; name: string; entry_count: number }
type Result = boolean | void | Promise<boolean | void>

const props = withDefaults(defineProps<{
  categories: CategoryOption[]
  activeIds?: number[]
  disabled?: boolean
  label?: string
  align?: 'left' | 'right'
  direction?: 'down' | 'up'
  variant?: 'ghost' | 'outlined'
  onPick: (id: number) => Result
  onUnpick?: (id: number) => Result
  onCreate: (name: string) => Result
}>(), {
  activeIds: () => [],
  disabled: false,
  label: '加入分类',
  align: 'right',
  direction: 'down',
  variant: 'ghost',
})

const root = ref<HTMLElement | null>(null)
const open = ref(false)
const name = ref('')
const busy = ref(false)

function close() { open.value = false }
async function run(action: () => Result) {
  busy.value = true
  try { return (await action()) !== false } catch { return false }
  finally { busy.value = false }
}
async function pick(id: number, active: boolean) {
  if (active && !props.onUnpick) return
  const ok = await run(() => active ? props.onUnpick?.(id) : props.onPick(id))
  if (ok) close()
}
async function create() {
  const value = name.value.trim()
  if (!value || busy.value) return
  const ok = await run(() => props.onCreate(value))
  if (ok) { name.value = ''; close() }
}
function onDocumentPointerDown(event: PointerEvent) {
  if (root.value && event.target instanceof Node && !root.value.contains(event.target)) close()
}
watch(open, async value => {
  if (value) {
    await nextTick()
    if (!props.categories.length) root.value?.querySelector<HTMLInputElement>('input')?.focus()
  }
})
watch(() => props.disabled, disabled => { if (disabled) close() })
onMounted(() => document.addEventListener('pointerdown', onDocumentPointerDown, true))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocumentPointerDown, true))
</script>

<template>
  <div
    ref="root"
    class="category-menu"
    :class="`category-menu-${variant}`"
    @keydown.esc.stop.prevent="close"
  >
    <button
      type="button"
      class="category-menu-trigger"
      :class="{ 'is-open': open }"
      :disabled="disabled || busy"
      :aria-expanded="open"
      aria-haspopup="menu"
      :aria-label="label"
      @click="open = !open"
    >
      <span aria-hidden="true">＋</span>
      <span v-if="variant === 'outlined'">{{ label }}</span>
    </button>

    <div
      v-if="open"
      class="category-menu-panel"
      :class="[`category-menu-${direction}`, `category-menu-${align}`]"
      role="menu"
      :aria-label="label"
    >
      <div class="category-menu-list">
        <p v-if="!categories.length" class="category-menu-empty">暂无分类，在下方输入名称创建。</p>
        <button
          v-for="category in categories"
          :key="category.id"
          type="button"
          class="category-menu-item"
          role="menuitem"
          :disabled="busy"
          @click="pick(category.id, activeIds.includes(category.id))"
        >
          <span>{{ category.name }}</span>
          <strong v-if="activeIds.includes(category.id)" aria-label="已加入">✓</strong>
          <small v-else>{{ category.entry_count }}</small>
        </button>
      </div>
      <div class="category-menu-create">
        <input
          v-model="name"
          type="text"
          aria-label="新分类名称"
          placeholder="新分类…"
          :disabled="busy"
          @keydown.enter.prevent="create"
        >
        <button type="button" aria-label="创建并加入" :disabled="busy || !name.trim()" @click="create">＋</button>
      </div>
    </div>
  </div>
</template>
