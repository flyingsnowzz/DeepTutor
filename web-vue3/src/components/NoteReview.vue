<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api, post } from '../api'

interface Card { page_id: string; page_title: string; block_id: string; card_id: string; front: string; back: string }
const cards = ref<Card[]>([])
const open = ref(false)
const revealed = ref(false)
const error = ref('')
const busy = ref(false)
onMounted(async () => {
  try { cards.value = (await api<{ cards: Card[] }>('/api/documents/review/due')).cards }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '复习卡加载失败' }
})
async function grade(remembered: boolean) {
  const card = cards.value[0]
  if (!card || busy.value) return
  busy.value = true
  error.value = ''
  try {
    await post(`/api/documents/${encodeURIComponent(card.page_id)}/review`, { card_id: card.card_id, remembered })
    cards.value = cards.value.slice(1)
    revealed.value = false
    if (!cards.value.length) open.value = false
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '复习结果保存失败' }
  finally { busy.value = false }
}
</script>

<template>
  <button v-if="cards.length || open" type="button" @click="revealed = false; open = true">复习记忆卡 <span>{{ cards.length }}</span></button>
  <div v-if="open" class="modal-backdrop" role="dialog" aria-modal="true" aria-label="复习记忆卡" @click="open = false">
    <section class="modal-panel note-review" @click.stop>
      <header class="modal-header"><h2>复习记忆卡</h2><span v-if="cards.length">剩余 {{ cards.length }} 张</span><button type="button" aria-label="关闭" @click="open = false">×</button></header>
      <template v-if="cards[0]"><article class="note-review-card"><p>{{ cards[0].front }}</p><p v-if="revealed">{{ cards[0].back }}</p></article><RouterLink :to="`/co-writer/${cards[0].page_id}#${cards[0].block_id}`">来自“{{ cards[0].page_title || '未命名页面' }}” ↗</RouterLink><div class="partner-actions"><button v-if="!revealed" class="primary" @click="revealed = true">显示答案</button><template v-else><button :disabled="busy" @click="grade(false)">再来一次</button><button class="primary" :disabled="busy" @click="grade(true)">记住了</button></template></div></template>
      <p v-else>全部复习完成。</p><p v-if="error" class="error" role="alert">{{ error }}</p>
    </section>
  </div>
</template>
