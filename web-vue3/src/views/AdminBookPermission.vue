<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { api } from '../api'

type Level = 'none' | 'read' | 'edit'
type Permission = { create: boolean; default: 'none' | 'read'; books: Record<string, Level> }
type Book = { book_id: string; title?: string }
const props = defineProps<{ userId: string }>()
const books = ref<Book[]>([])
const permission = ref<Permission>({ create: true, default: 'none', books: {} })
const saved = ref('')
const loading = ref(false)
const saving = ref(false)
const feedback = ref('')
const dirty = computed(() => Boolean(saved.value) && saved.value !== JSON.stringify(permission.value))

async function load() {
  loading.value = true
  feedback.value = ''
  try {
    const [catalog, response] = await Promise.all([
      api<{ books: Book[] }>('/api/multi-user/admin/books'),
      api<{ permission: Permission }>(`/api/multi-user/users/${encodeURIComponent(props.userId)}/book-permission`),
    ])
    books.value = catalog.books
    permission.value = response.permission
    saved.value = JSON.stringify(response.permission)
  } catch (cause) { feedback.value = cause instanceof Error ? cause.message : '书籍权限加载失败' }
  finally { loading.value = false }
}
onMounted(() => { void load() })
watch(() => props.userId, () => { void load() })
function setLevel(bookId: string, level: Level) {
  const overrides = { ...permission.value.books }
  if (level === permission.value.default) delete overrides[bookId]
  else overrides[bookId] = level
  permission.value = { ...permission.value, books: overrides }
}
async function save() {
  saving.value = true
  feedback.value = ''
  try {
    const result = await api<{ permission: Permission }>(`/api/multi-user/users/${encodeURIComponent(props.userId)}/book-permission`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(permission.value),
    })
    permission.value = result.permission
    saved.value = JSON.stringify(result.permission)
    feedback.value = '已保存'
  } catch (cause) { feedback.value = cause instanceof Error ? cause.message : '保存失败' }
  finally { saving.value = false }
}
</script>

<template>
  <section class="admin-assignment admin-book-editor">
    <header><div><h3>书籍访问</h3><p>共享书籍不会授予删除权限；阅读进度和笔记按用户隔离。</p></div><button type="button" class="admin-ghost-save" :disabled="loading || saving || !dirty" @click="save">{{ saving ? '保存中…' : '保存' }}</button></header>
    <div class="admin-profile-fields">
      <label><span>可以创建个人书籍</span><input v-model="permission.create" type="checkbox" /></label>
      <label>新共享书籍默认权限
        <select v-model="permission.default"><option value="none">无权限</option><option value="read">只读</option></select>
      </label>
    </div>
    <div class="admin-book-list">
      <p v-if="!loading && books.length === 0" class="admin-empty-card">暂无可用共享书籍。</p>
      <label v-for="book in books" :key="book.book_id">
        <span>{{ book.title || book.book_id }}</span>
        <select :value="permission.books[book.book_id] ?? permission.default" :aria-label="`${book.title || book.book_id} 权限`" @change="setLevel(book.book_id, ($event.target as HTMLSelectElement).value as Level)">
          <option value="none">无权限</option><option value="read">只读</option><option value="edit">协作编辑</option>
        </select>
      </label>
    </div>
    <p class="admin-editor-status" :class="{ ok: feedback === '已保存' }" role="status">{{ feedback || (dirty ? '有未保存的书籍权限更改' : '就绪') }}</p>
  </section>
</template>
