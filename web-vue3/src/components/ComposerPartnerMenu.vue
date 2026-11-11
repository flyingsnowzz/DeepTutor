<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import LegacyIcon from './LegacyIcon.vue'
import AgentGlyph from './AgentGlyph.vue'
import PartnerAvatar from './PartnerAvatar.vue'

interface Partner { partner_id: string; name: string; description?: string; emoji?: string; color?: string; avatar?: string }
interface PartnerGroup { group_id: string; name: string; emoji?: string; members?: Array<{ name: string }> }
interface Agent { name: string; kind?: string }
const props = withDefaults(defineProps<{
  partners?: Partner[]
  groups?: PartnerGroup[]
  agents?: Agent[]
  partner: string
  group: string
  agent: string
  everyTurn: boolean
  below?: boolean
}>(), { partners: () => [], groups: () => [], agents: () => [] })
const emit = defineEmits<{
  'update:partner': [value: string]
  'update:group': [value: string]
  'update:agent': [value: string]
  'update:everyTurn': [value: boolean]
}>()
const open = ref(false)
const root = ref<HTMLElement | null>(null)
const trigger = ref<HTMLButtonElement | null>(null)
const selectedName = computed(() => {
  const partner = props.partners.find(item => item.partner_id === props.partner)
  if (partner) return partner.name
  const group = props.groups.find(item => item.group_id === props.group)
  if (group) return group.name
  return props.agent || ''
})
function selectPartner(value: string) {
  emit('update:partner', props.partner === value ? '' : value)
  emit('update:group', '')
  emit('update:agent', '')
  open.value = false
}
function selectGroup(value: string) {
  emit('update:group', props.group === value ? '' : value)
  emit('update:partner', '')
  emit('update:agent', '')
  open.value = false
}
function selectAgent(value: string) {
  emit('update:agent', props.agent === value ? '' : value)
  emit('update:partner', '')
  emit('update:group', '')
  open.value = false
}
function outside(event: MouseEvent) { if (open.value && !root.value?.contains(event.target as Node)) open.value = false }
function keydown(event: KeyboardEvent) { if (event.key === 'Escape' && open.value) { open.value = false; trigger.value?.focus() } }
onMounted(() => { document.addEventListener('click', outside); document.addEventListener('keydown', keydown) })
onUnmounted(() => { document.removeEventListener('click', outside); document.removeEventListener('keydown', keydown) })
</script>

<template>
  <div ref="root" class="composer-tray-control">
    <button ref="trigger" type="button" class="chat-mode-trigger composer-partner-trigger" aria-label="伙伴" :aria-expanded="open" @click="open = !open"><LegacyIcon name="partners" :size="14" /><span>伙伴</span><strong v-if="selectedName">{{ selectedName }}</strong><LegacyIcon name="chevronDown" :size="11" /></button>
    <div v-if="open" class="composer-tray-popover composer-partner-popover" :class="{ below }" role="dialog" aria-label="伙伴">
      <div role="listbox" aria-label="伙伴">
        <section v-if="partners.length" class="composer-partner-section"><h3>询问伙伴 <small>DeepTutor 问伙伴，再整理回答</small></h3><button v-for="item in partners" :key="item.partner_id" type="button" role="option" :aria-selected="partner === item.partner_id" @click="selectPartner(item.partner_id)"><PartnerAvatar :name="item.name" :emoji="item.emoji" :color="item.color" :image="item.avatar" :size="24" /><span><strong>{{ item.name }}</strong><small>{{ item.description || '伙伴' }}</small></span><LegacyIcon v-if="partner === item.partner_id" name="check" :size="13" /></button></section>
        <section v-if="groups.length" class="composer-partner-section"><h3>组织伙伴讨论</h3><button v-for="item in groups" :key="item.group_id" type="button" role="option" :aria-selected="group === item.group_id" @click="selectGroup(item.group_id)"><span class="partner-group-emoji">{{ item.emoji || '👥' }}</span><span><strong>{{ item.name }}</strong><small>{{ item.members?.map(member => member.name).join(' · ') || '组织伙伴讨论' }}</small></span><LegacyIcon v-if="group === item.group_id" name="check" :size="13" /></button></section>
        <section v-if="agents.length" class="composer-partner-section"><h3>询问子智能体</h3><button v-for="item in agents" :key="item.name" type="button" role="option" :aria-selected="agent === item.name" @click="selectAgent(item.name)"><AgentGlyph :kind="item.kind" :size="16" /><span><strong>{{ item.name }}</strong><small>{{ item.kind || '子智能体' }}</small></span><LegacyIcon v-if="agent === item.name" name="check" :size="13" /></button></section>
        <p v-if="!partners.length && !groups.length && !agents.length" class="composer-partner-empty">还没有伙伴</p>
      </div>
      <footer><label><button type="button" role="switch" :aria-checked="everyTurn" @click="emit('update:everyTurn', !everyTurn)"><span /></button>每轮附带</label></footer>
    </div>
  </div>
</template>
