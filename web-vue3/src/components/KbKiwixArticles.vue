<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { api, post } from '../api'
import LegacyIcon from './LegacyIcon.vue'
interface Article { title: string; article_path: string; excerpt: string }
const props = defineProps<{ kbName: string; title?: string; zimName?: string }>()
const router = useRouter()
const query = ref('')
const results = ref<Article[]>([])
const searched = ref(false)
const busy = ref(false)
const opening = ref('')
const error = ref('')
async function search() { if (!query.value.trim()) return; busy.value = true; error.value = ''; searched.value = false; try { results.value = (await api<{ articles: Article[] }>(`/api/knowledge-bases/kiwix-articles?kb_ref=${encodeURIComponent(props.kbName)}&q=${encodeURIComponent(query.value.trim())}`)).articles; searched.value = true } catch (cause) { error.value = cause instanceof Error ? cause.message : '文章搜索失败' } finally { busy.value = false } }
async function open(article: Article) { opening.value = article.article_path; try { const result = await post<{ workspace: { workspace_id: string } }>('/api/reading/library/import-zim-article', { kb_ref: props.kbName, article_path: article.article_path, title: article.title }); await router.push(`/learning/reading/${encodeURIComponent(result.workspace.workspace_id)}`) } catch (cause) { error.value = cause instanceof Error ? cause.message : '打开文章失败' } finally { opening.value = '' } }
</script>
<template><section class="kb-section"><header class="kb-section-heading"><div><h2>{{ title || 'Kiwix 档案' }}</h2><p>搜索 ZIM 中的文章。对话、书籍和引导学习可按需读取，无需导入整个档案。</p><small>{{ zimName }}</small></div></header><form class="kb-inline-form" @submit.prevent="search"><label class="sr-only" for="kiwix-query">搜索文章</label><input id="kiwix-query" v-model="query" placeholder="搜索文章"><button class="primary" :disabled="busy || !query.trim()"><LegacyIcon name="search" :size="14" />搜索</button></form><p v-if="error" class="error" role="alert">{{ error }}</p><p v-if="searched && !results.length" class="muted">没有找到可阅读的文章。</p><div class="kb-record-list"><article v-for="article in results" :key="article.article_path"><div><strong>{{ article.title }}</strong><p>{{ article.excerpt }}</p></div><button :disabled="Boolean(opening)" @click="open(article)"><LegacyIcon name="learning" :size="14" />{{ opening === article.article_path ? '正在打开…' : '阅读文章' }}</button></article></div></section></template>
