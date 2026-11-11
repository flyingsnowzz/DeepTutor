<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { api } from '../api'
import PartnerAvatar from '../components/PartnerAvatar.vue'
import LegacyIcon from '../components/LegacyIcon.vue'

interface Partner { partner_id: string; name: string; description?: string; emoji?: string; color?: string; avatar?: string; running?: boolean; can_manage?: boolean; channels?: string[] }
interface Group { group_id: string; name: string; description?: string; emoji?: string; color?: string; members?: Partner[]; member_ids?: string[]; discussion_mode?: string; updated_at?: string }
const partners = ref<Partner[]>([])
const groups = ref<Group[]>([])
const loading = ref(true)
const error = ref('')
const partnerMenuOpen = ref(false)
const anyAssigned = computed(() => partners.value.some(partner => partner.can_manage === false))
const canFormGroup = computed(() => partners.value.length >= 2)
let mounted = true

function channels(partner: Partner) {
  return (partner.channels || []).filter(name => name !== 'send_progress' && name !== 'send_tool_hints')
}
function discussionMode(name?: string) {
  return ({ panel_parallel: '并行回答', sequential: '依次回答', debate: '交叉质询' } as Record<string, string>)[name || ''] || name || ''
}
function relativeTime(value?: string) {
  if (!value) return ''
  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) return ''
  const seconds = Math.round((timestamp - Date.now()) / 1000)
  const formatter = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' })
  if (Math.abs(seconds) < 60) return formatter.format(seconds, 'second')
  const minutes = Math.round(seconds / 60)
  if (Math.abs(minutes) < 60) return formatter.format(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24) return formatter.format(hours, 'hour')
  return formatter.format(Math.round(hours / 24), 'day')
}
async function load() {
  loading.value = true
  error.value = ''
  const results = await Promise.all([
    api<Partner[]>('/api/partners').catch(cause => ({ failed: cause } as const)),
    api<Group[]>('/api/partner-groups').catch(cause => ({ failed: cause } as const)),
  ])
  if (!mounted) return
  partners.value = 'failed' in results[0] ? [] : results[0]
  groups.value = 'failed' in results[1] ? [] : results[1]
  const failed = results.find(result => 'failed' in result) as { failed: unknown } | undefined
  if (failed) error.value = failed.failed instanceof Error ? failed.failed.message : '部分伙伴资料加载失败'
  loading.value = false
}
function revealDirectorySection() {
  const section = window.location.hash.slice(1)
  if (!loading.value && (section === 'groups' || section === 'partners')) {
    document.getElementById(section)?.scrollIntoView({ block: 'start' })
  }
}
watch(loading, () => { if (!loading.value) void Promise.resolve().then(revealDirectorySection) })
onMounted(() => { mounted = true; window.addEventListener('hashchange', revealDirectorySection); void load() })
onUnmounted(() => { mounted = false; window.removeEventListener('hashchange', revealDirectorySection) })
</script>

<template>
  <main class="feature-page partner-page">
    <nav class="partner-page-bar" aria-label="位置"><div class="partner-crumb-wrap"><button type="button" class="partner-crumb" aria-haspopup="menu" :aria-expanded="partnerMenuOpen" @click.stop="partnerMenuOpen = !partnerMenuOpen" @keydown.esc="partnerMenuOpen = false"><span aria-hidden="true">◌</span>伙伴</button><template v-if="partnerMenuOpen"><div class="partner-menu-dismiss" @click="partnerMenuOpen = false"></div><div class="partner-resource-menu" role="menu" aria-label="伙伴"><p>伙伴</p><RouterLink role="menuitem" class="is-active" to="/partners" @click="partnerMenuOpen = false">伙伴</RouterLink></div></template></div><RouterLink class="partner-bar-action" to="/partners/new"><LegacyIcon name="plus" :size="14" />新建伙伴</RouterLink></nav>
    <div class="partner-page-content"><header class="feature-heading"><div><h1 id="partners">伙伴</h1><p>{{ anyAssigned ? '你的伙伴，以及他人分配给你的伙伴，各有独立人格、知识库和频道。' : '每个伙伴都有自己的灵魂、资料库和频道——可以直接在飞书、Telegram 等 IM 里对话。' }}</p></div><RouterLink class="primary" to="/partners/new"><LegacyIcon name="plus" :size="14" />新建伙伴</RouterLink></header>
    <p v-if="error" class="error" role="alert">{{ error }} <button type="button" @click="load">重试</button></p>
    <div v-if="loading" class="partner-loading" role="status"><span aria-hidden="true">◌</span><span class="legacy-sr-only">加载中…</span></div>
    <section v-else-if="!partners.length" class="empty-state">
      <span aria-hidden="true"><svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19.414 14.414C21 12.828 22 11.5 22 9.5a5.5 5.5 0 0 0-9.591-3.676.6.6 0 0 1-.818.001A5.5 5.5 0 0 0 2 9.5c0 2.3 1.5 4 3 5.5l5.535 5.362a2 2 0 0 0 2.879.052 2.12 2.12 0 0 0-.004-3 2.124 2.124 0 1 0 3-3 2.124 2.124 0 0 0 3.004 0 2 2 0 0 0 0-2.828l-1.881-1.882a2.41 2.41 0 0 0-3.409 0l-1.71 1.71a2 2 0 0 1-2.828 0 2 2 0 0 1 0-2.828l2.823-2.762" /></svg></span><h2>还没有伙伴</h2>
      <p>创建一个伙伴，赋予它灵魂和一部分资料库，然后在这里或飞书、Telegram、Slack 等 IM 中与它对话。</p>
      <RouterLink class="primary" to="/partners/new"><LegacyIcon name="plus" :size="14" />创建第一个伙伴</RouterLink>
    </section>
    <section v-else>
      <div class="partner-grid">
        <RouterLink v-for="partner in partners" :key="partner.partner_id" :to="`/partners/${encodeURIComponent(partner.partner_id)}`" class="partner-card partner-directory-card">
          <PartnerAvatar :name="partner.name" :emoji="partner.emoji" :color="partner.color" :image="partner.avatar" :size="42" />
          <div><div class="partner-title"><strong>{{ partner.name }}</strong><small><span :class="['status-dot', { running: partner.running }]" />{{ partner.running ? '运行中' : '已停止' }}</small><small v-if="partner.can_manage === false" class="channel-tag">共享给你</small></div>
            <p>{{ partner.description }}</p>
            <div class="channel-list"><span v-for="channel in channels(partner)" :key="channel" class="channel-tag">{{ channel }}</span><small v-if="!channels(partner).length">未连接频道</small></div>
          </div>
        </RouterLink>
      </div>
      <section id="groups" class="partner-groups">
        <div class="feature-heading"><div><h2>群组</h2><p>同时邀请多位伙伴，比较他们不同的观点。</p></div><RouterLink v-if="canFormGroup" to="/partners/groups/new" class="partner-group-action"><LegacyIcon name="plus" :size="14" />新建群组</RouterLink></div>
        <div v-if="!groups.length" class="empty-state compact"><p>{{ canFormGroup ? '将两位或更多伙伴聚在一起，他们共享对话但独立思考。' : '再创建一位伙伴，即可创建第一个分组。' }}</p></div>
        <div v-else class="partner-grid"><RouterLink v-for="group in groups" :key="group.group_id" :to="`/partners/groups/${encodeURIComponent(group.group_id)}`" class="partner-card partner-directory-card">
          <PartnerAvatar :name="group.name" :emoji="group.emoji || '👥'" :color="group.color" :size="42" />
          <div><strong>{{ group.name }}</strong><p>{{ group.description }}</p><div class="group-meta"><div class="avatar-stack"><PartnerAvatar v-for="member in (group.members || []).slice(0, 5)" :key="member.partner_id" :name="member.name" :emoji="member.emoji" :color="member.color" :image="member.avatar" :size="20" /></div><small>{{ group.member_ids?.length ?? group.members?.length ?? 0 }} 位伙伴 · {{ discussionMode(group.discussion_mode) }}<template v-if="relativeTime(group.updated_at)"> · {{ relativeTime(group.updated_at) }}</template></small></div></div>
        </RouterLink></div>
      </section>
    </section>
    </div>
  </main>
</template>
