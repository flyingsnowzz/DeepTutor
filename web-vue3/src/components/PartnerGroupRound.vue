<script setup lang="ts">
import { computed, ref } from 'vue'
import PartnerAvatar from './PartnerAvatar.vue'
import LegacyIcon from './LegacyIcon.vue'
import PartnerGroupSeat from './PartnerGroupSeat.vue'
import type { GroupMember, GroupRound } from '../groupDiscussion'

const props = defineProps<{
  round: GroupRound
  members: GroupMember[]
  progress: { done: number; total: number; clash?: boolean } | null
  pendingActions: Set<string>
}>()
const emit = defineEmits<{
  approve: [invocationId: string]
  reject: [invocationId: string]
  quote: [payload: { member?: GroupMember; content: string }]
  trace: [payload: { turnId: string; partnerId: string }]
  'ask-peer': [payload: { requesterId: string; targetId: string; content: string }]
  summarize: [payload: { turnId: string; partnerId: string }]
}>()

const followupOpen = ref(true)
const summaryOpen = ref(false)
const memberOf = (partnerId: string) => props.members.find(member => member.partner_id === partnerId)
const answered = computed(() =>
  props.round.seats.filter(seat =>
    seat.status === 'done' && seat.message?.kind !== 'round_summary'))
const summaryMembers = computed(() => {
  const ids = new Set(answered.value.map(seat => seat.partnerId))
  return props.members.filter(member => ids.has(member.partner_id))
})
const summarised = computed(() =>
  props.round.seats.some(seat => seat.message?.kind === 'round_summary'))
const canSummarise = computed(() =>
  !props.round.live && !props.round.stopped && !summarised.value && answered.value.length > 1)
const invocation = computed(() =>
  props.round.seats.find(seat => seat.message?.invocation)?.message?.invocation)
const followupRequester = computed(() =>
  invocation.value?.requester_partner_name || props.round.seats[0]?.message?.author_name || '')
const followupTarget = computed(() =>
  invocation.value?.target_partner_name
  || memberOf(props.round.seats[0]?.message?.mentions?.[0] || '')?.name
  || '')

function askPeer(payload: { requesterId: string; targetId: string; content: string }) {
  emit('ask-peer', payload)
}
</script>

<template>
  <section v-if="round.followup" :data-turn-key="round.turnId" class="group-round is-followup">
    <button type="button" class="group-followup-head" :aria-expanded="followupOpen" @click="followupOpen = !followupOpen">
      <LegacyIcon name="chevronDown" :size="12" :class="{ collapsed: !followupOpen }" />
      <span>{{ followupRequester && followupTarget ? `${followupRequester} 询问了 ${followupTarget}` : '伙伴追问' }}</span>
      <i />
    </button>
    <div v-if="followupOpen" class="group-followup-body">
      <PartnerGroupSeat
        v-for="seat in round.seats"
        :key="seat.message?.event_id || seat.partnerId"
        :seat="seat"
        :member="memberOf(seat.partnerId)"
        :peers="members"
        :pending-invocation="Boolean(seat.message?.invocation && pendingActions.has(seat.message.invocation.invocation_id))"
        @trace="emit('trace', { turnId: round.turnId, partnerId: seat.partnerId })"
        @quote="emit('quote', $event)"
        @ask-peer="askPeer({ requesterId: seat.partnerId, targetId: $event, content: seat.message?.content || seat.streamed })"
        @approve="emit('approve', $event)"
        @reject="emit('reject', $event)"
      />
    </div>
  </section>
  <section v-else :data-turn-key="round.turnId" class="group-round">
    <div v-if="round.user" class="group-user-message">{{ round.user.content }}</div>
    <div v-if="round.live && progress && progress.total > 1" class="group-round-progress">
      <span>{{ progress.clash ? `交锋轮次 · ${progress.done}/${progress.total}` : `${progress.done}/${progress.total} 已回答` }}</span>
      <i />
    </div>
    <div class="group-seat-list">
      <PartnerGroupSeat
        v-for="seat in round.seats"
        :key="seat.message?.event_id || seat.partnerId"
        :seat="seat"
        :member="memberOf(seat.partnerId)"
        :peers="members"
        :pending-invocation="Boolean(seat.message?.invocation && pendingActions.has(seat.message.invocation.invocation_id))"
        @trace="emit('trace', { turnId: round.turnId, partnerId: seat.partnerId })"
        @quote="emit('quote', $event)"
        @ask-peer="askPeer({ requesterId: seat.partnerId, targetId: $event, content: seat.message?.content || seat.streamed })"
        @approve="emit('approve', $event)"
        @reject="emit('reject', $event)"
      />
    </div>
    <div v-if="canSummarise" class="group-summary-action">
      <button type="button" @click="summaryOpen = !summaryOpen"><LegacyIcon name="tasks" :size="11" />总结本轮</button>
      <div v-if="summaryOpen" class="group-member-popover" @mouseleave="summaryOpen = false">
        <small>由谁总结？</small>
        <button v-for="member in summaryMembers" :key="member.partner_id" type="button" @click="summaryOpen = false; emit('summarize', { turnId: round.turnId, partnerId: member.partner_id })">
          <PartnerAvatar :name="member.name" :emoji="member.emoji" :color="member.color" :image="member.avatar" :size="18" />
          <span>{{ member.name }}</span>
        </button>
      </div>
    </div>
    <div v-if="round.stopped" class="group-round-stopped"><i /><span>你停止了本轮讨论</span><i /></div>
  </section>
</template>
