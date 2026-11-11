<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import LegacyIcon from './LegacyIcon.vue'
import AgentGlyph from './AgentGlyph.vue'
import PartnerAvatar from './PartnerAvatar.vue'
import SubagentBudgetStepper from './SubagentBudgetStepper.vue'

interface Persona { id?: string; name: string; description?: string }
interface Partner { partner_id: string; name: string; description?: string; emoji?: string; color?: string; avatar?: string }
interface Agent { name: string; kind?: string }
const props = withDefaults(defineProps<{
  open: boolean
  persona: string
  personas?: Persona[]
  partners?: Partner[]
  agents?: Agent[]
  answerBy: string
  everyTurn: boolean
  subagentBudget?: number | null
  below?: boolean
}>(), { personas: () => [], partners: () => [], agents: () => [] })
const emit = defineEmits<{
  close: []
  'update:persona': [value: string]
  'update:answerBy': [value: string]
  'update:everyTurn': [value: boolean]
  'update:subagentBudget': [value: number]
}>()
const query = ref('')
const needle = computed(() => query.value.trim().toLocaleLowerCase())
const matches = (...values: Array<string | undefined>) => !needle.value || values.join(' ').toLocaleLowerCase().includes(needle.value)
const styleRows = computed(() => props.personas.filter(item => matches(item.name, item.description)))
const partnerRows = computed(() => props.partners.filter(item => matches(item.name, item.description)))
const agentRows = computed(() => props.agents.filter(item => matches(item.name)))
const showSearch = computed(() => props.personas.length + props.partners.length + props.agents.length >= 9)
function pickPersona(value: string) { emit('update:persona', value); emit('close') }
function pickAnswerer(value: string) { emit('update:answerBy', value); emit('close') }
watch(() => props.open, open => { if (open) query.value = '' })
</script>

<template>
  <div v-if="open" class="answer-preferences-menu" :class="{ below }" role="dialog" aria-label="偏好">
    <label v-if="showSearch" class="answer-preferences-search"><LegacyIcon name="search" :size="15" /><input v-model="query" aria-label="搜索回答风格与回答者" placeholder="搜索回答风格与回答者" /></label>
    <div class="answer-preferences-list" role="listbox" aria-label="偏好">
      <section class="answer-preferences-section">
        <h3>回答风格</h3>
        <button type="button" role="option" :aria-selected="!persona" @click="pickPersona('')"><span class="answer-option-icon"><LegacyIcon name="voice" :size="16" /></span><span><strong>默认</strong><small>不使用人格 — 使用助手的默认行为</small></span><LegacyIcon v-if="!persona" name="check" :size="15" class="answer-option-check" /></button>
        <button v-for="item in styleRows" :key="item.name" type="button" role="option" :aria-selected="persona === item.name" @click="pickPersona(item.name)"><span class="answer-option-icon"><LegacyIcon name="profile" :size="15" /></span><span><strong>{{ item.name }}</strong><small>{{ item.description || '回答风格' }}</small></span><LegacyIcon v-if="persona === item.name" name="check" :size="15" class="answer-option-check" /></button>
      </section>
      <section class="answer-preferences-section">
        <h3>由谁回答 <small>问题整个交给 TA 回答</small></h3>
        <button v-if="matches('DeepTutor')" type="button" role="option" :aria-selected="!answerBy" @click="pickAnswerer('')"><span class="answer-option-icon"><LegacyIcon name="chat" :size="15" /></span><span><strong>DeepTutor</strong><small>照常由 DeepTutor 回答</small></span><LegacyIcon v-if="!answerBy" name="check" :size="15" class="answer-option-check" /></button>
        <button v-for="partner in partnerRows" :key="`partner:${partner.partner_id}`" type="button" role="option" :aria-selected="answerBy === `partner:${partner.partner_id}`" @click="pickAnswerer(`partner:${partner.partner_id}`)"><PartnerAvatar :name="partner.name" :emoji="partner.emoji" :color="partner.color" :image="partner.avatar" :size="24" /><span><strong>{{ partner.name }}</strong><small>{{ partner.description || '伙伴' }}</small></span><LegacyIcon v-if="answerBy === `partner:${partner.partner_id}`" name="check" :size="15" class="answer-option-check" /></button>
        <button v-for="agent in agentRows" :key="`subagent:${agent.name}`" type="button" role="option" :aria-selected="answerBy === `subagent:${agent.name}`" @click="pickAnswerer(`subagent:${agent.name}`)"><span class="answer-option-icon"><AgentGlyph :kind="agent.kind" :size="15" /></span><span><strong>{{ agent.name }}</strong><small>{{ agent.kind || '子智能体' }}</small></span><LegacyIcon v-if="answerBy === `subagent:${agent.name}`" name="check" :size="15" class="answer-option-check" /></button>
        <p v-if="!partnerRows.length && !agentRows.length" class="answer-preferences-empty">还没有可以接手的子智能体或伙伴</p>
        <SubagentBudgetStepper v-if="agentRows.length && answerBy.startsWith('subagent:')" :model-value="subagentBudget ?? null" @update:model-value="emit('update:subagentBudget', $event)" />
      </section>
      <p v-if="needle && !styleRows.length && !partnerRows.length && !agentRows.length" class="answer-preferences-empty">没有结果</p>
    </div>
    <footer class="answer-preferences-footer"><label class="answer-reuse-toggle"><button type="button" role="switch" :aria-checked="everyTurn" @click="emit('update:everyTurn', !everyTurn)"><span /></button><span>每轮附带</span></label><RouterLink to="/personalization" @click="emit('close')">个性化 <LegacyIcon name="cornerUpRight" :size="13" /></RouterLink></footer>
  </div>
</template>
