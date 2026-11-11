<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../api'
import NoteReview from '../components/NoteReview.vue'
import NotePageCard from '../components/NotePageCard.vue'
import LegacyIcon from '../components/LegacyIcon.vue'

interface Note { id: string; title: string; preview: string; updated_at: number; parent_id: string | null; pinned: boolean; revision: number; icon: string; cover?: string }
const router = useRouter()
const pages = ref<Note[]>([])
const loading = ref(true)
const busy = ref(false)
const busyId = ref('')
const query = ref('')
const error = ref('')
const importInput = ref<HTMLInputElement | null>(null)
const byId = computed(() => new Map(pages.value.map(page => [page.id, page])))
const childCounts = computed(() => { const result = new Map<string, number>(); for (const page of pages.value) if (page.parent_id) result.set(page.parent_id, (result.get(page.parent_id) || 0) + 1); return result })
const visible = computed(() => { const needle = query.value.trim().toLocaleLowerCase(); return needle ? pages.value.filter(page => `${page.title} ${page.preview}`.toLocaleLowerCase().includes(needle)) : pages.value.filter(page => !page.parent_id || !byId.value.has(page.parent_id)) })
const pinned = computed(() => visible.value.filter(page => page.pinned))
const rest = computed(() => visible.value.filter(page => !page.pinned))
const groups = computed(() => [{ title: '置顶页面', items: pinned.value }, { title: pinned.value.length || query.value ? '最近编辑' : '页面', items: rest.value }])
function parentLabel(page: Note) { return page.parent_id ? `${byId.value.get(page.parent_id)?.title || '未命名页面'}` : '' }
function childLabel(page: Note) { const count = childCounts.value.get(page.id); return count ? ` · ${count} 个子页面` : '' }
async function load() { error.value = ''; try { pages.value = (await api<{ documents: Note[] }>('/api/documents')).documents } catch (cause) { error.value = cause instanceof Error ? cause.message : '页面加载失败' } finally { loading.value = false } }
onMounted(load)
async function create() { if (busy.value) return; busy.value = true; error.value = ''; try { const page = await api<Note>('/api/documents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: '', parent_id: null, content: '', blocks: [] }) }); await router.push(`/co-writer/${page.id}`) } catch (cause) { error.value = cause instanceof Error ? cause.message : '新建失败' } finally { busy.value = false } }
async function importDocx(event: Event) { const input = event.target as HTMLInputElement; const file = input.files?.[0]; input.value = ''; if (!file || busy.value) return; busy.value = true; error.value = ''; try { const data = new FormData(); data.append('file', file); const page = await api<Note>('/api/documents/import/docx', { method: 'POST', body: data }); await router.push(`/co-writer/${page.id}`) } catch (cause) { error.value = cause instanceof Error ? cause.message : '导入失败' } finally { busy.value = false } }
async function pin(page: Note) { busyId.value = page.id; error.value = ''; try { await api(`/api/documents/${encodeURIComponent(page.id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pinned: !page.pinned, expected_revision: page.revision }) }); await load() } catch (cause) { error.value = cause instanceof Error ? cause.message : '置顶失败' } finally { busyId.value = '' } }
async function remove(page: Note) { busyId.value = page.id; error.value = ''; try { await api(`/api/documents/${encodeURIComponent(page.id)}`, { method: 'DELETE' }); await load() } catch (cause) { error.value = cause instanceof Error ? cause.message : '删除失败' } finally { busyId.value = '' } }
function date(value: number) { const seconds = Math.round((value * 1000 - Date.now()) / 1000); const formatter = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' }); if (Math.abs(seconds) < 60) return formatter.format(seconds, 'second'); const minutes = Math.round(seconds / 60); if (Math.abs(minutes) < 60) return formatter.format(minutes, 'minute'); const hours = Math.round(minutes / 60); if (Math.abs(hours) < 24) return formatter.format(hours, 'hour'); return formatter.format(Math.round(hours / 24), 'day') }
</script>

<template>
  <main class="feature-page co-writer-page"><header class="co-writer-header"><div><h1><LegacyIcon name="edit" :size="14" />笔记本</h1><p>为正在学的东西建一页：书写、互相链接，再和 Dito 一起把它学透。</p></div><div><NoteReview /><input ref="importInput" type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden @change="importDocx" /><button class="secondary" :disabled="busy" @click="importInput?.click()"><LegacyIcon name="upload" :size="14" />导入 Word</button><button class="primary" :disabled="busy" @click="create"><LegacyIcon name="plus" :size="14" />新建页面</button></div></header>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <div v-if="loading" class="dt-notes-skeleton" aria-busy="true" aria-label="正在加载页面…"><div v-for="index in 6" :key="index" /></div>
    <div v-else-if="!pages.length" class="co-writer-empty"><span>📓</span><h2>笔记本还是空的</h2><p>为一个主题、一节课或一篇论文开一页。Dito 可以帮你写，也能把它变成练习。</p><div><button class="primary" :disabled="busy" @click="create"><LegacyIcon name="plus" :size="14" />新建页面</button><button class="secondary" :disabled="busy" @click="importInput?.click()"><LegacyIcon name="upload" :size="14" />导入 Word</button></div></div>
    <template v-else>
      <div class="co-writer-toolbar"><label class="dt-notes-search"><LegacyIcon name="search" :size="14" /><input v-model="query" type="search" placeholder="搜索页面…" aria-label="搜索页面"></label><span>{{ pages.length }} 页</span></div>
      <p v-if="!visible.length">没有匹配“{{ query.trim() }}”的页面。</p>
      <section v-for="group in groups" :key="group.title" class="co-writer-section"><template v-if="group.items.length"><h2 v-if="group.title === '置顶页面' || pinned.length || query">{{ group.title }}</h2><div class="co-writer-grid"><NotePageCard v-for="page in group.items" :key="page.id" :page="page" :parent-title="query ? parentLabel(page) : ''" :child-count="childCounts.get(page.id) || 0" :date-label="date(page.updated_at)" :busy="busyId === page.id" @pin="pin(page)" @delete="remove(page)" /></div></template></section>
    </template>
  </main>
</template>
