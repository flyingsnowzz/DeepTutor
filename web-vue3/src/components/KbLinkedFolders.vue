<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api, post } from '../api'
import LegacyIcon from './LegacyIcon.vue'
interface Folder { id: string; path: string; added_at: string; file_count: number; last_sync: string | null }
const props = defineProps<{ kbName: string; readOnly?: boolean }>()
const folders = ref<Folder[]>([])
const folderPath = ref('')
const loading = ref(true)
const busy = ref('')
const error = ref('')
const notice = ref('')
async function load() { loading.value = true; error.value = ''; try { folders.value = await api<Folder[]>(`/api/knowledge-bases/${encodeURIComponent(props.kbName)}/linked-folders`) } catch (cause) { error.value = cause instanceof Error ? cause.message : '关联文件夹加载失败' } finally { loading.value = false } }
onMounted(load)
async function link() { if (!folderPath.value.trim()) return; busy.value = 'link'; error.value = ''; try { await post(`/api/knowledge-bases/${encodeURIComponent(props.kbName)}/link-folder`, { folder_path: folderPath.value.trim() }); folderPath.value = ''; notice.value = '文件夹已关联'; await load() } catch (cause) { error.value = cause instanceof Error ? cause.message : '关联失败' } finally { busy.value = '' } }
async function sync(folder: Folder) { busy.value = folder.id; error.value = ''; try { const result = await post<{ new_files: number; modified_files: number; file_count: number }>(`/api/knowledge-bases/${encodeURIComponent(props.kbName)}/sync-folder/${encodeURIComponent(folder.id)}`, {}); notice.value = `同步完成：新增 ${result.new_files}，更新 ${result.modified_files}，共 ${result.file_count} 个文件`; await load() } catch (cause) { error.value = cause instanceof Error ? cause.message : '同步失败' } finally { busy.value = '' } }
async function unlink(folder: Folder) { if (!confirm(`取消关联“${folder.path}”？不会删除本地文件。`)) return; busy.value = folder.id; try { await api(`/api/knowledge-bases/${encodeURIComponent(props.kbName)}/linked-folders/${encodeURIComponent(folder.id)}`, { method: 'DELETE' }); notice.value = '已取消关联'; await load() } catch (cause) { error.value = cause instanceof Error ? cause.message : '取消关联失败' } finally { busy.value = '' } }
</script>
<template><section class="kb-section"><header class="kb-section-heading"><div><h2>关联文件夹</h2><p>持续同步服务器上的文档目录，无需重复上传。</p></div></header><p v-if="error" class="error" role="alert">{{ error }}</p><p v-if="notice" class="notice" role="status">{{ notice }}</p><form v-if="!readOnly" class="kb-inline-form" @submit.prevent="link"><label>文件夹路径<input v-model="folderPath" required placeholder="/Users/you/Documents/knowledge"></label><button class="primary" :disabled="busy === 'link' || !folderPath.trim()"><LegacyIcon name="plus" :size="14" />关联文件夹</button></form><p v-if="loading" class="muted">加载中…</p><div v-else-if="!folders.length" class="kb-empty">尚未关联文件夹。</div><div v-else class="kb-record-list"><article v-for="folder in folders" :key="folder.id"><div><strong>{{ folder.path }}</strong><p>{{ folder.file_count }} 个文件<template v-if="folder.last_sync"> · 上次同步 {{ new Date(folder.last_sync).toLocaleString('zh-CN') }}</template></p></div><div v-if="!readOnly"><button :disabled="busy === folder.id" @click="sync(folder)"><LegacyIcon name="history" :size="14" />同步</button><button class="danger" :disabled="busy === folder.id" @click="unlink(folder)">取消关联</button></div></article></div></section></template>
