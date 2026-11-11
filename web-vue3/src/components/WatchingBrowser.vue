<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import LegacyIcon from './LegacyIcon.vue'
import {
  browseInvidious,
  invidiousAccount,
  type InvidiousAccountStatus,
  type InvidiousPlaylist,
  type InvidiousVideo,
} from '../videoLearning'

const props = withDefaults(defineProps<{ canDismiss?: boolean }>(), { canDismiss: true })
const emit = defineEmits<{ close: []; select: [url: string] }>()
type View = 'feed' | 'playlists' | 'search' | 'playlist'
const account = ref<InvidiousAccountStatus | null>(null)
const view = ref<View>('search')
const input = ref('')
const query = ref('')
const playlist = ref('')
const page = ref(1)
const items = ref<Array<InvidiousVideo | InvidiousPlaylist>>([])
const busy = ref(false)
const accountBusy = ref(false)
const error = ref('')
let requestController: AbortController | null = null

const accountRequired = computed(() => (view.value !== 'search' || Boolean(query.value)) && account.value && !account.value.connected)
const hasItems = computed(() => items.value.length > 0)

function isPlaylist(item: InvidiousVideo | InvidiousPlaylist): item is InvidiousPlaylist {
  return 'playlistId' in item
}
function thumbnail(item: InvidiousVideo | InvidiousPlaylist) {
  const video = isPlaylist(item) ? item.videos?.[0] : item
  return video?.videoThumbnails?.find(entry => /^https?:\/\//.test(entry.url))?.url || ''
}
function duration(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
async function loadAccount() {
  try {
    account.value = await invidiousAccount('status')
    view.value = account.value.connected ? 'feed' : 'search'
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '无法读取 Invidious 状态'
  }
}
async function browse() {
  requestController?.abort()
  const controller = new AbortController()
  requestController = controller
  items.value = []
  error.value = ''
  if (view.value !== 'search' && !account.value?.connected) return
  if (view.value === 'search' && !query.value.trim()) return
  busy.value = true
  try {
    const result = await browseInvidious(view.value, query.value, page.value, playlist.value, controller.signal)
    if (controller.signal.aborted) return
    items.value = Array.isArray(result) ? result : result.videos ?? []
  } catch (cause) {
    if (!controller.signal.aborted) error.value = cause instanceof Error ? cause.message : '视频列表加载失败'
  } finally {
    if (!controller.signal.aborted) busy.value = false
  }
}
async function connect() {
  accountBusy.value = true
  error.value = ''
  try {
    const result = account.value?.connected ? await invidiousAccount('disconnect') : await invidiousAccount('authorize')
    if (result.authorize_url) {
      window.location.assign(result.authorize_url)
      return
    }
    account.value = result
    if (!result.connected) {
      view.value = 'search'
      query.value = ''
      items.value = []
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Invidious 连接失败'
  } finally {
    accountBusy.value = false
  }
}
function search() {
  const value = input.value.trim()
  if (/^https?:\/\//i.test(value)) {
    emit('select', value)
    emit('close')
    return
  }
  view.value = 'search'
  query.value = value
  page.value = 1
  void browse()
}
function selectVideo(item: InvidiousVideo) {
  emit('select', `https://www.youtube.com/watch?v=${encodeURIComponent(item.videoId)}`)
  emit('close')
}
function openPlaylist(item: InvidiousPlaylist) {
  playlist.value = item.playlistId
  view.value = 'playlist'
  page.value = 1
  void browse()
}
function changeView(next: View) {
  view.value = next
  page.value = 1
  void browse()
}
watch([view, query, page, playlist], () => { void browse() })
onMounted(loadAccount)
</script>

<template>
  <section class="watching-browser" aria-label="浏览视频">
    <header>
      <div><LegacyIcon name="video" :size="18" /><div><h2>浏览 Invidious</h2><p>选择视频加入当前资料组。</p></div></div>
      <div>
        <button type="button" :disabled="accountBusy" @click="connect"><LegacyIcon name="link" :size="14" />{{ account?.connected ? '断开 Invidious' : account?.needs_reauthorization ? '重新连接' : '连接 Invidious' }}</button>
        <button v-if="canDismiss" type="button" aria-label="关闭" @click="emit('close')"><LegacyIcon name="close" :size="15" /></button>
      </div>
    </header>

    <form class="watching-search" @submit.prevent="search">
      <LegacyIcon name="search" :size="15" />
      <input v-model="input" aria-label="搜索视频或粘贴链接" placeholder="搜索视频，或粘贴 YouTube / Bilibili 链接">
      <button type="submit" :disabled="!input.trim()">搜索</button>
    </form>

    <nav class="watching-tabs" aria-label="视频浏览视图">
      <button type="button" :aria-pressed="view === 'feed'" @click="changeView('feed')">订阅</button>
      <button type="button" :aria-pressed="view === 'playlists' || view === 'playlist'" @click="changeView('playlists')">播放列表</button>
      <button type="button" :aria-pressed="view === 'search'" @click="changeView('search')">搜索</button>
    </nav>

    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <div v-if="accountRequired" class="watching-account-required">
      <LegacyIcon name="link" :size="26" />
      <p>连接 Invidious 账号后可查看订阅和播放列表。</p>
      <button type="button" :disabled="accountBusy" @click="connect">连接 Invidious</button>
    </div>
    <p v-else-if="busy" class="watching-loading" role="status">正在加载视频…</p>
    <div v-else class="watching-grid">
      <button v-for="item in items" :key="isPlaylist(item) ? item.playlistId : item.videoId" type="button" class="watching-card" @click="isPlaylist(item) ? openPlaylist(item) : selectVideo(item)">
        <span class="watching-thumb">
          <img v-if="thumbnail(item)" :src="thumbnail(item)" alt="" loading="lazy" referrerpolicy="no-referrer">
          <LegacyIcon v-else :name="isPlaylist(item) ? 'tableOfContents' : 'play'" :size="28" />
          <small v-if="!isPlaylist(item)">{{ duration(item.lengthSeconds) }}</small>
        </span>
        <span class="watching-copy"><strong>{{ item.title }}</strong><small>{{ isPlaylist(item) ? `${item.videoCount} 个视频` : item.author }}</small></span>
      </button>
      <p v-if="!hasItems" class="watching-empty">{{ view === 'search' && !query ? '搜索一个视频开始学习。' : '这里还没有视频。' }}</p>
    </div>

    <footer v-if="hasItems && view !== 'playlists'" class="watching-pager">
      <button type="button" :disabled="page <= 1" @click="page--">上一页</button>
      <span>{{ page }}</span>
      <button type="button" :disabled="!hasItems" @click="page++">下一页</button>
    </footer>
  </section>
</template>

<style scoped>
.watching-browser{display:flex;flex-direction:column;width:min(1000px,100%);max-height:min(780px,calc(100dvh - 40px));overflow:hidden;border:1px solid var(--border);border-radius:16px;background:var(--popover);color:var(--popover-foreground);box-shadow:var(--dt-shadow-md)}
.watching-browser>header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 20px;border-bottom:1px solid var(--border)}
.watching-browser>header>div{display:flex;align-items:center;gap:9px}.watching-browser>header>div:first-child>div{display:grid;gap:2px}
.watching-browser h2{margin:0;font-size:15px}.watching-browser header p{margin:0;color:var(--muted-foreground);font-size:12px}
.watching-browser header button,.watching-search button,.watching-tabs button,.watching-pager button,.watching-account-required button{padding:6px 10px;border:1px solid var(--border);border-radius:8px;background:var(--card);color:var(--foreground);font-size:11px;cursor:pointer}
.watching-search{display:flex;align-items:center;gap:8px;margin:14px 20px 0;padding:0 10px;border:1px solid var(--border);border-radius:10px;background:var(--background)}
.watching-search input{min-width:0;flex:1;height:40px;border:0;background:transparent;color:var(--foreground);outline:none}
.watching-search button{border:0;background:var(--primary);color:var(--primary-foreground)}
.watching-tabs{display:flex;gap:5px;padding:10px 20px;border-bottom:1px solid var(--border)}
.watching-tabs button[aria-pressed=true]{border-color:var(--primary);color:var(--primary);background:color-mix(in srgb,var(--primary) 8%,var(--card))}
.watching-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;min-height:220px;overflow-y:auto;padding:16px 20px}
.watching-card{display:grid;gap:8px;padding:0;border:0;background:transparent;color:var(--foreground);text-align:left;cursor:pointer}
.watching-thumb{position:relative;display:flex;align-items:center;justify-content:center;aspect-ratio:16/9;overflow:hidden;border-radius:10px;background:var(--muted)}
.watching-thumb img{width:100%;height:100%;object-fit:cover}.watching-thumb small{position:absolute;right:6px;bottom:6px;padding:2px 5px;border-radius:4px;background:rgba(0,0,0,.72);color:#fff;font-size:10px}
.watching-copy{display:grid;gap:3px}.watching-copy strong{font-size:12px;line-height:1.4}.watching-copy small{color:var(--muted-foreground);font-size:10.5px}
.watching-account-required{display:grid;justify-items:center;gap:9px;padding:40px 20px;color:var(--muted-foreground);text-align:center}.watching-account-required p{margin:0}
.watching-loading,.watching-empty{grid-column:1/-1;padding:36px;color:var(--muted-foreground);font-size:12px;text-align:center}
.watching-pager{display:flex;align-items:center;justify-content:center;gap:12px;padding:12px;border-top:1px solid var(--border);font-size:12px}
@media(max-width:720px){.watching-grid{grid-template-columns:1fr}.watching-browser{height:100dvh;max-height:none;border-radius:0}}
</style>
