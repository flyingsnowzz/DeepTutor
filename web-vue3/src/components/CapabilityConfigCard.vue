<script setup lang="ts">
import LegacyIcon from './LegacyIcon.vue'

withDefaults(defineProps<{
  title: string
  icon?: string
  confirmed?: boolean
  canConfirm?: boolean
  validationErrors?: string[]
}>(), {
  icon: 'slidersHorizontal',
  confirmed: false,
  canConfirm: true,
  validationErrors: () => [],
})

const emit = defineEmits<{ confirm: [] }>()
</script>

<template>
  <section class="capability-config-card" :data-confirmed="confirmed || undefined">
    <header>
      <LegacyIcon :name="icon" :size="13" :stroke-width="1.8" />
      <span>{{ title }}</span>
      <b v-if="confirmed" class="is-confirmed"><LegacyIcon name="check" :size="10" :stroke-width="2.5" />已确认</b>
      <b v-else class="is-required">必填</b>
    </header>
    <div class="capability-config-body">
      <slot />
    </div>
    <ul v-if="validationErrors.length" class="capability-config-errors">
      <li v-for="(error, index) in validationErrors" :key="index">• {{ error }}</li>
    </ul>
    <footer>
      <span>{{ confirmed ? '修改任意字段后会更新设置。' : '请先确认设置，再发送消息。' }}</span>
      <button
        type="button"
        :disabled="confirmed || !canConfirm"
        @click="emit('confirm')"
      >
        {{ confirmed ? '已确认' : '确认' }}
      </button>
    </footer>
  </section>
</template>
