<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api, post } from '../api'
import LegacyIcon from './LegacyIcon.vue'

type PartnerLink = { key: string; channel: string; sender_id: string }
const props = defineProps<{ partnerId: string; partnerName: string }>()
const emit = defineEmits<{ close: [] }>()
const links = ref<PartnerLink[]>([])
const code = ref('')
const loading = ref(true)
const issuing = ref(false)
const copied = ref(false)
const error = ref('')
let copiedTimer: ReturnType<typeof setTimeout> | undefined

async function load() {
  loading.value = true
  try { links.value = await api<PartnerLink[]>(`/api/partners/${encodeURIComponent(props.partnerId)}/links`) }
  catch { links.value = [] }
  finally { loading.value = false }
}
async function issue() {
  issuing.value = true
  error.value = ''
  copied.value = false
  try { code.value = (await post<{ command: string }>(`/api/partners/${encodeURIComponent(props.partnerId)}/links/code`, {})).command }
  catch { error.value = '无法创建链接码，请重试。' }
  finally { issuing.value = false }
}
async function copy() {
  if (!code.value) return
  try {
    await navigator.clipboard.writeText(code.value)
    copied.value = true
    if (copiedTimer) clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => { copied.value = false }, 2000)
  } catch { error.value = '无法复制——请选中命令并手动复制。' }
}
async function unlink(key: string) {
  try { await api(`/api/partners/${encodeURIComponent(props.partnerId)}/links/${encodeURIComponent(key)}`, { method: 'DELETE' }); await load() }
  catch { error.value = '无法断开该账号，请重试。' }
}
onMounted(() => { void load() })
</script>

<template>
  <div class="partner-modal-overlay" @click.self="emit('close')">
    <section class="partner-link-modal" role="dialog" aria-modal="true" aria-label="链接聊天账号">
      <header><div><h2>链接聊天账号</h2><p>连接你联系 {{ partnerName }} 时使用的聊天账号，这样这些对话就归你所有，伙伴也能访问你的资料库和笔记。</p></div><button type="button" aria-label="关闭" @click="emit('close')"><LegacyIcon name="close" :size="17" /></button></header>
      <div v-if="code" class="partner-link-code-card">
        <p>请从你要连接的聊天账号，向 {{ partnerName }} 私聊发送以下命令：</p>
        <div><code>{{ code }}</code><button type="button" @click="copy"><LegacyIcon :name="copied ? 'check' : 'copy'" :size="14" />{{ copied ? '已复制' : '复制' }}</button></div>
        <p>15 分钟内有效，只能使用一次。</p>
      </div>
      <button v-else type="button" class="partner-link-issue" :disabled="issuing" @click="issue"><LegacyIcon name="link" :size="14" />{{ issuing ? '正在创建…' : '获取链接命令' }}</button>
      <p v-if="error" class="partner-link-error" role="alert">{{ error }}</p>
      <section class="partner-connected-accounts"><h3>已连接账号</h3>
        <p v-if="loading" class="muted">正在加载…</p>
        <p v-else-if="!links.length" class="muted">还没有已连接的聊天账号。</p>
        <ul v-else><li v-for="link in links" :key="link.key"><LegacyIcon name="plug" :size="13" /><span>{{ link.channel }} · {{ link.sender_id }}</span><button type="button" @click="unlink(link.key)">断开连接</button></li></ul>
      </section>
    </section>
  </div>
</template>
