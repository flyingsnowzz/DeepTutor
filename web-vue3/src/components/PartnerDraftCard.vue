<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import LegacyIcon from './LegacyIcon.vue'
import { api } from '../api'
import type { PartnerDraftData } from '../partnerDraft'

const props = defineProps<{ data: PartnerDraftData }>()
const router = useRouter()
const editing = ref(false)
const showSoul = ref(false)
const creating = ref(false)
const error = ref('')

const name = ref(props.data.name)
const description = ref(props.data.description)
const soul = ref(props.data.soul)
const language = ref(props.data.language)
const emoji = ref(props.data.emoji || '🤝')
const color = ref(props.data.color || '#6366f1')
const createdId = ref(props.data.created_partner_id || '')

const canConfirm = computed(() => Boolean(name.value.trim() && soul.value.trim()))

async function confirm() {
  creating.value = true
  error.value = ''
  try {
    const partner = await api<{ partner_id: string }>(
      `/api/partners/drafts/${encodeURIComponent(props.data.draft_id)}/confirm`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.value,
          description: description.value,
          soul: soul.value,
          language: language.value,
          emoji: emoji.value,
          color: color.value,
          start: true,
        }),
      },
    )
    createdId.value = partner.partner_id
    editing.value = false
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '创建伙伴失败'
  } finally {
    creating.value = false
  }
}
</script>

<template>
  <section class="partner-draft-card">
    <div class="partner-draft-avatar" :style="{ color, backgroundColor: `${color}22` }">{{ emoji }}</div>
    <div class="partner-draft-body">
      <div class="partner-draft-head">
        <div>
          <p>伙伴草稿</p>
          <strong v-if="!editing">{{ name }}</strong>
        </div>
        <button v-if="!createdId" type="button" class="text-button" @click="editing = !editing">
          <LegacyIcon :name="editing ? 'check' : 'edit'" :size="12" />{{ editing ? '完成' : '编辑' }}
        </button>
      </div>

      <div v-if="editing" class="partner-draft-form">
        <input v-model="name" aria-label="伙伴名称" placeholder="伙伴名称">
        <textarea v-model="description" aria-label="简介" rows="3" placeholder="简介"></textarea>
        <div class="partner-draft-row">
          <input v-model="emoji" aria-label="表情" placeholder="表情">
          <input v-model="language" aria-label="语言" placeholder="zh / en">
          <input v-model="color" aria-label="颜色" placeholder="#6366f1">
        </div>
        <textarea v-model="soul" aria-label="灵魂设定" rows="8" class="monospace" placeholder="完整的系统人格与教学规则"></textarea>
      </div>

      <template v-else>
        <p class="partner-draft-description">{{ description }}</p>
        <button type="button" class="text-button" @click="showSoul = !showSoul">
          <LegacyIcon name="chevronDown" :size="12" />灵魂设定
        </button>
        <pre v-if="showSoul" class="partner-draft-soul">{{ soul }}</pre>
      </template>

      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <div class="partner-draft-actions">
        <button v-if="createdId" type="button" class="primary" @click="router.push(`/partners/${encodeURIComponent(createdId)}`)">
          <LegacyIcon name="check" :size="13" />打开伙伴
        </button>
        <button v-else type="button" :disabled="creating || !canConfirm" @click="confirm">
          <LegacyIcon :name="creating ? 'loader' : 'partners'" :size="13" :class="{ spinning: creating }" />
          {{ creating ? '创建中…' : '确认并创建' }}
        </button>
        <span>{{ createdId ? '伙伴已创建' : '确认前不会创建任何伙伴' }}</span>
      </div>
    </div>
  </section>
</template>
