<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api, authStatus } from '../api'
import { scopedUrl } from '../workspaceScope'
import { AVATAR_COLOR_NAMES, AVATAR_COLORS, AVATAR_ICON_NAMES, fallbackAvatarFor, parseAvatarMarker } from '../avatar'
import { cropAvatarToSquare } from '../avatarImage'
import UserAvatar from '../components/UserAvatar.vue'
import AvatarIcon from '../components/AvatarIcon.vue'
import LegacyIcon from '../components/LegacyIcon.vue'

interface Profile { id: string; username: string; role: string; created_at: string; avatar?: string }
const router = useRouter()
const profile = ref<Profile | null>(null)
const loading = ref(true)
const error = ref('')
const notice = ref('')
const busy = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
const descriptor = computed(() => parseAvatarMarker(profile.value?.avatar))
const hasImage = computed(() => descriptor.value.kind === 'image')
const fallback = computed(() => fallbackAvatarFor(profile.value?.username || ''))
const selectedIcon = computed(() => descriptor.value.kind === 'icon' ? descriptor.value.icon : hasImage.value ? null : fallback.value.icon)
const selectedColor = computed(() => descriptor.value.kind === 'icon' ? descriptor.value.color : hasImage.value ? null : fallback.value.color)

async function load() {
  loading.value = true
  const status = await authStatus().catch(() => null)
  if (!status?.enabled) { await router.replace('/'); return }
  if (!status.authenticated) { await router.replace('/login'); return }
  try { profile.value = await api<Profile>('/api/auth/profile') }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '资料加载失败' }
  finally { loading.value = false }
}
onMounted(load)
async function applyMarker(marker: string) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    const result = await api<{ avatar?: string }>('/api/auth/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ avatar: marker }) })
    if (profile.value) profile.value.avatar = result.avatar ?? marker
    notice.value = '头像已更新'
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '保存头像失败' }
  finally { busy.value = false }
}
async function uploadAvatar(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file || busy.value) return
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    const blob = await cropAvatarToSquare(file)
    const form = new FormData()
    form.append('file', blob, 'avatar')
    const response = await fetch(scopedUrl('/api/auth/profile/avatar'), { method: 'PUT', credentials: 'include', body: form })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.detail || `HTTP ${response.status}`)
    if (profile.value) profile.value.avatar = String(data.avatar || '')
    notice.value = '照片已更新'
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '上传失败' }
  finally { busy.value = false; input.value = '' }
}
async function removeAvatar() {
  busy.value = true
  error.value = ''
  try {
    await api('/api/auth/profile/avatar', { method: 'DELETE' })
    if (profile.value) profile.value.avatar = ''
    notice.value = '照片已移除'
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '移除照片失败' }
  finally { busy.value = false }
}
async function signOut() {
  await api('/api/auth/logout', { method: 'POST' }).catch(() => null)
  await router.replace('/login')
}
</script>

<template>
  <main class="feature-page profile-page">
    <RouterLink to="/chat" class="profile-back"><LegacyIcon name="chevronLeft" :size="16" />上一步</RouterLink>
    <header class="profile-heading"><h1>个人资料</h1><p>查看账户信息并个性化你的头像</p></header>
    <p v-if="error" class="error" role="alert">{{ error }}</p><p v-if="notice" class="notice" role="status">{{ notice }}</p>
    <div v-if="loading" class="profile-loading" role="status">加载中…</div>
    <template v-else-if="profile">
      <section class="profile-card profile-account"><div class="profile-account-main"><UserAvatar :username="profile.username" :user-id="profile.id" :avatar="profile.avatar" :role="profile.role" :size="72" /><div><h2>{{ profile.username }} <small :class="{ admin: profile.role === 'admin' }">{{ profile.role === 'admin' ? '管理员' : profile.role === 'learner' ? '学生' : '用户' }}</small></h2><p v-if="profile.created_at">注册时间：{{ new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(profile.created_at)) }}</p></div></div><RouterLink to="/session-handoff" class="profile-action"><LegacyIcon name="key" :size="14" />公共设备登录</RouterLink></section>
      <section class="profile-card profile-avatar-card"><h2>头像</h2><p>上传图片或选择图标</p><div class="profile-avatar-actions"><button type="button" :disabled="busy" @click="fileInput?.click()"><LegacyIcon name="image" :size="14" />上传图片</button><button v-if="hasImage" type="button" :disabled="busy" @click="removeAvatar"><LegacyIcon name="close" :size="14" />移除照片</button><input ref="fileInput" class="visually-hidden" type="file" accept="image/png,image/jpeg,image/webp" :disabled="busy" @change="uploadAvatar"></div>
        <div class="profile-avatar-picker"><p>或选择图标</p><div class="avatar-options"><button v-for="icon in AVATAR_ICON_NAMES" :key="icon" type="button" :aria-label="icon" :aria-pressed="!hasImage && icon === selectedIcon" :disabled="busy" :style="{ background: AVATAR_COLORS[selectedColor || fallback.color] }" @click="applyMarker(`icon:${icon}:${selectedColor || fallback.color}`)"><AvatarIcon :name="icon" :size="18" :stroke-width="1.8" /></button></div>
        <p>颜色</p><div class="avatar-colors"><button v-for="color in AVATAR_COLOR_NAMES" :key="color" type="button" :aria-label="color" :aria-pressed="!hasImage && color === selectedColor" :disabled="busy" :style="{ background: AVATAR_COLORS[color] }" @click="applyMarker(`icon:${selectedIcon || fallback.icon}:${color}`)" /></div></div>
      </section>
      <section class="profile-card profile-signout"><div><h2>退出登录</h2><p>结束此设备上的会话</p></div><button type="button" @click="signOut"><LegacyIcon name="logout" :size="14" />退出登录</button></section>
    </template>
  </main>
</template>
