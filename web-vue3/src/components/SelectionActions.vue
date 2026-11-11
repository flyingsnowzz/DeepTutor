<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import AgentGlyph from './AgentGlyph.vue'
import PartnerAvatar from './PartnerAvatar.vue'
import LegacyIcon from './LegacyIcon.vue'
import { DITO, type SideChatResponder } from '../sideChat'

const props = defineProps<{
  anchor: { left: number; right: number; top: number; bottom: number }
  agents?: Array<{ name: string; kind?: string }>
  partners?: Array<{ partner_id: string; name: string; emoji?: string; color?: string; avatar?: string }>
  groups?: Array<{ group_id: string; name: string; emoji?: string }>
}>()
const emit = defineEmits<{
  add: []
  ask: [responder: SideChatResponder]
  dismiss: []
}>()
const menuOpen = ref(false)
const BAR_WIDTH = 232
const BAR_HEIGHT = 36
const MENU_MAX_HEIGHT = 320
const position = computed(() => {
  if (typeof window === 'undefined') return { left: 12, top: 12, menuAbove: false }
  const left = Math.max(12, Math.min(props.anchor.right - BAR_WIDTH, window.innerWidth - BAR_WIDTH - 12))
  const below = props.anchor.bottom + 8
  const fitsBelow = below + BAR_HEIGHT + MENU_MAX_HEIGHT <= window.innerHeight - 12
  return {
    left,
    top: fitsBelow ? below : Math.max(12, props.anchor.top - BAR_HEIGHT - 8),
    menuAbove: !fitsBelow,
  }
})

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  event.stopPropagation()
  if (menuOpen.value) menuOpen.value = false
  else emit('dismiss')
}
onMounted(() => document.addEventListener('keydown', onKeydown, true))
onUnmounted(() => document.removeEventListener('keydown', onKeydown, true))
</script>

<template>
  <div
    class="selection-actions"
    role="toolbar"
    aria-label="所选文字"
    :style="{ left: `${position.left}px`, top: `${position.top}px`, width: `${BAR_WIDTH}px` }"
    @pointerdown.prevent
  >
    <div class="selection-actions-bar">
      <button type="button" @click="emit('add')">
        <span class="selection-quote-glyph" aria-hidden="true">“</span>加入聊天
      </button>
      <i aria-hidden="true" />
      <button type="button" class="selection-ask-dito" @click="emit('ask', DITO)">
        <LegacyIcon name="chat" :size="14" />询问 Dito
      </button>
      <button
        type="button"
        class="selection-ask-more"
        aria-label="询问其他人"
        aria-haspopup="menu"
        :aria-expanded="menuOpen"
        @click="menuOpen = !menuOpen"
      >
        <LegacyIcon name="chevronDown" :size="14" />
      </button>
    </div>
    <div
      v-if="menuOpen"
      class="selection-responder-menu"
      :class="{ above: position.menuAbove }"
      role="menu"
    >
      <p>询问其他人</p>
      <button v-for="agent in agents" :key="`agent-${agent.name}`" type="button" role="menuitem" @click="emit('ask', { kind: 'subagent', id: agent.name, name: agent.name }); menuOpen = false">
        <AgentGlyph :kind="agent.kind" :size="15" />
        <span><strong>{{ agent.name }}</strong><small>{{ agent.kind || '子智能体' }}</small></span>
      </button>
      <button v-for="group in groups" :key="`group-${group.group_id}`" type="button" role="menuitem" @click="emit('ask', { kind: 'partner_group', id: group.group_id, name: group.name }); menuOpen = false">
        <span class="selection-emoji">{{ group.emoji || '👥' }}</span>
        <span><strong>{{ group.name }}</strong><small>伙伴群组</small></span>
      </button>
      <button v-for="partner in partners" :key="`partner-${partner.partner_id}`" type="button" role="menuitem" @click="emit('ask', { kind: 'partner', id: partner.partner_id, name: partner.name }); menuOpen = false">
        <PartnerAvatar :name="partner.name" :emoji="partner.emoji" :color="partner.color" :image="partner.avatar" :size="20" />
        <span><strong>{{ partner.name }}</strong><small>伙伴</small></span>
      </button>
      <p v-if="!(agents?.length || groups?.length || partners?.length)">还没有可用的伙伴或子智能体。</p>
    </div>
  </div>
</template>
