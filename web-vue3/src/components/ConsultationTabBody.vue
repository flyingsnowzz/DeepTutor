<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import SubagentTabBody from './SubagentTabBody.vue'
import PartnerConsultationPanel from './PartnerConsultationPanel.vue'
import LegacyIcon from './LegacyIcon.vue'
import { subagentIdentity, type SubagentEvent } from '../subagentTrace'

const props = defineProps<{
  events: SubagentEvent[]
  sessionId?: string | null
}>()
const router = useRouter()
const identity = computed(() => subagentIdentity(props.events))
const partnerRoute = computed(() => {
  if (identity.value.partnerId) return `/partners/${encodeURIComponent(identity.value.partnerId)}`
  if (identity.value.groupId) return `/partners/groups/${encodeURIComponent(identity.value.groupId)}`
  return ''
})
const partnerId = computed(() => identity.value.partnerId || identity.value.groupId || '')
const partnerSessionKey = computed(() => identity.value.partnerSessionKey || identity.value.groupSessionKey || '')
const idleSeconds = ref(0)
const idleWindow = ref(0)
let countdown: ReturnType<typeof setInterval> | undefined
function startCountdown() {
  if (countdown) clearInterval(countdown)
  countdown = undefined
  if (idleSeconds.value <= 0) return
  countdown = setInterval(() => {
    idleSeconds.value = Math.max(0, idleSeconds.value - 1)
    if (!idleSeconds.value && countdown) {
      clearInterval(countdown)
      countdown = undefined
    }
  }, 1000)
}
function resetIdleCountdown() {
  if (idleWindow.value <= 0) return
  idleSeconds.value = idleWindow.value
  startCountdown()
}
watch(
  () => props.events,
  events => {
    const latest = [...events].reverse().find(event => typeof event.metadata?.partner_group_idle_seconds === 'number')
    idleWindow.value = Math.max(idleWindow.value, Number(latest?.metadata?.partner_group_idle_seconds || 0))
    idleSeconds.value = idleWindow.value
    startCountdown()
  },
  { immediate: true, deep: true },
)
onBeforeUnmount(() => { if (countdown) clearInterval(countdown) })
</script>

<template>
  <div class="consultation-tab">
    <p v-if="idleSeconds > 0" class="consultation-idle" role="status">
      DeepTutor 将在 {{ idleSeconds }} 秒后回应；继续在这里发言可保持讨论。
    </p>
    <div v-if="partnerRoute" class="consultation-partner-bar">
      <span>
        <LegacyIcon :name="identity.groupId ? 'partners' : 'profile'" :size="14" />
        {{ identity.name || (identity.groupId ? '伙伴群组咨询' : '伙伴咨询') }}
      </span>
      <button type="button" @click="router.push(partnerRoute)">打开完整咨询 <LegacyIcon name="cornerUpRight" :size="12" /></button>
    </div>
    <PartnerConsultationPanel
      v-if="partnerId && partnerSessionKey"
      :kind="identity.groupId ? 'group' : 'partner'"
      :id="partnerId"
      :session-key="partnerSessionKey"
      :name="identity.name || (identity.groupId ? '伙伴群组' : '伙伴')"
      @activity="resetIdleCountdown"
    />
    <SubagentTabBody v-else :events="events" :session-id="sessionId" />
  </div>
</template>
