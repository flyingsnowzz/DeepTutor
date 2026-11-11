<script setup lang="ts">
import { computed, ref } from 'vue'
import type { SideChatResponder } from '../sideChat'
import { DITO, sameResponder } from '../sideChat'
import AgentGlyph from './AgentGlyph.vue'
import PartnerAvatar from './PartnerAvatar.vue'
import LegacyIcon from './LegacyIcon.vue'

const props = defineProps<{
  value: SideChatResponder
  agents: Array<{ name: string; kind?: string }>
  partners: Array<{ partner_id: string; name: string; emoji?: string; color?: string; avatar?: string; description?: string }>
  groups: Array<{ group_id: string; name: string; emoji?: string; description?: string }>
  aboutConversation?: boolean
}>()
const emit = defineEmits<{ change: [responder: SideChatResponder] }>()
const open = ref(false)

const activeName = computed(() =>
  props.value.kind === 'dito'
    ? 'Dito'
    : 'name' in props.value ? props.value.name : 'Dito',
)

function responderId(value: SideChatResponder) {
  return 'id' in value ? value.id : ''
}

function choose(responder: SideChatResponder) {
  if (!sameResponder(responder, props.value)) emit('change', responder)
  open.value = false
}
</script>

<template>
  <div class="side-responder-menu">
    <button type="button" class="side-responder-trigger" :aria-expanded="open" aria-haspopup="menu" @click="open = !open">
      <AgentGlyph v-if="value.kind === 'subagent'" :kind="agents.find(agent => agent.name === responderId(value))?.kind" :size="14" />
      <PartnerAvatar
        v-else-if="value.kind === 'partner'"
        :name="activeName"
        :emoji="partners.find(partner => partner.partner_id === responderId(value))?.emoji"
        :color="partners.find(partner => partner.partner_id === responderId(value))?.color"
        :image="partners.find(partner => partner.partner_id === responderId(value))?.avatar"
        :size="16"
      />
      <LegacyIcon v-else name="plain-voice" :size="14" />
      <span>由谁回答</span>
      <strong>{{ activeName }}</strong>
      <LegacyIcon name="chevronDown" :size="11" />
    </button>
    <div v-if="open" class="side-responder-popover" role="menu">
      <button type="button" role="menuitem" :class="{ active: sameResponder(value, DITO) }" @click="choose(DITO)">
        <LegacyIcon name="plain-voice" :size="15" />
        <span><strong>Dito</strong><small v-if="aboutConversation">已阅读这段对话</small></span>
        <LegacyIcon v-if="sameResponder(value, DITO)" name="check" :size="13" />
      </button>
      <template v-if="agents.length">
        <p>子智能体</p>
        <button v-for="agent in agents" :key="`agent-${agent.name}`" type="button" role="menuitem" :class="{ active: sameResponder(value, { kind: 'subagent', id: agent.name, name: agent.name }) }" @click="choose({ kind: 'subagent', id: agent.name, name: agent.name })">
          <AgentGlyph :kind="agent.kind" :size="15" />
          <span><strong>{{ agent.name }}</strong><small>{{ agent.kind || 'Agent' }}</small></span>
          <LegacyIcon v-if="value.kind === 'subagent' && responderId(value) === agent.name" name="check" :size="13" />
        </button>
      </template>
      <template v-if="groups.length">
        <p>伙伴群组</p>
        <button v-for="group in groups" :key="`group-${group.group_id}`" type="button" role="menuitem" :class="{ active: sameResponder(value, { kind: 'partner_group', id: group.group_id, name: group.name }) }" @click="choose({ kind: 'partner_group', id: group.group_id, name: group.name })">
          <span class="side-responder-emoji">{{ group.emoji || '👥' }}</span>
          <span><strong>{{ group.name }}</strong><small>{{ group.description || 'Dito 组织群组讨论并带回结论' }}</small></span>
          <LegacyIcon v-if="value.kind === 'partner_group' && responderId(value) === group.group_id" name="check" :size="13" />
        </button>
      </template>
      <template v-if="partners.length">
        <p>伙伴</p>
        <button v-for="partner in partners" :key="`partner-${partner.partner_id}`" type="button" role="menuitem" :class="{ active: sameResponder(value, { kind: 'partner', id: partner.partner_id, name: partner.name }) }" @click="choose({ kind: 'partner', id: partner.partner_id, name: partner.name })">
          <PartnerAvatar :name="partner.name" :emoji="partner.emoji" :color="partner.color" :image="partner.avatar" :size="22" />
          <span><strong>{{ partner.name }}</strong><small>{{ partner.description || '独立会话中回答你发送的内容' }}</small></span>
          <LegacyIcon v-if="value.kind === 'partner' && responderId(value) === partner.partner_id" name="check" :size="13" />
        </button>
      </template>
    </div>
  </div>
</template>
