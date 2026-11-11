<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { AVATAR_COLORS, fallbackAvatarFor, parseAvatarMarker } from '../avatar'
import AvatarIcon from './AvatarIcon.vue'
import LegacyIcon from './LegacyIcon.vue'
import { scopedUrl } from '../workspaceScope'

const props = withDefaults(defineProps<{ username: string; userId?: string; avatar?: string; role?: string; size?: number }>(), { size: 40, avatar: '', role: '' })
const broken = ref(false)
watch(() => `${props.userId}:${props.avatar}`, () => { broken.value = false })
const descriptor = computed(() => parseAvatarMarker(props.avatar))
const fallback = computed(() => fallbackAvatarFor(props.username))
const imageUrl = computed(() => descriptor.value.kind === 'image' && props.userId && !broken.value
  ? scopedUrl(`/api/auth/avatar/${encodeURIComponent(props.userId)}?v=${encodeURIComponent(descriptor.value.version)}`) : '')
const selection = computed(() => descriptor.value.kind === 'icon' ? descriptor.value : fallback.value)
</script>

<template>
  <span class="user-avatar" :style="{ width: `${size}px`, height: `${size}px`, outline: role === 'admin' ? `${Math.max(1.5, size / 18)}px solid #e0a83c` : undefined, outlineOffset: role === 'admin' ? '2px' : undefined }" :title="role === 'admin' ? `${username}（管理员）` : username">
    <img v-if="imageUrl" :src="imageUrl" alt="" :width="size" :height="size" @error="broken = true">
    <span v-else :style="{ background: AVATAR_COLORS[selection.color] }" aria-hidden="true"><AvatarIcon :name="selection.icon" :size="Math.round(size * 0.55)" :stroke-width="1.8" /></span>
    <span v-if="role === 'admin' && size >= 40" class="user-avatar-admin-badge" :style="{ right: `${-size / 14}px`, bottom: `${-size / 14}px`, width: `${Math.round(size * 0.38)}px`, height: `${Math.round(size * 0.38)}px` }"><LegacyIcon name="shieldCheck" :size="Math.round(size * 0.2)" :stroke-width="2.2" /></span>
  </span>
</template>
