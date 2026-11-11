<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import LegacyIcon from '../components/LegacyIcon.vue'
import { buildGraph, fetchMemorySnapshot, type ClusterMeta, type GraphNode, type GraphEdge, type Layer, type MemoryGraph } from '../memory/graph'

const router = useRouter()
const graph = ref<MemoryGraph | null>(null)
const stage = ref<HTMLElement | null>(null)
const stageWidth = ref(1200)
const stageHeight = ref(1200)
const loading = ref(true)
const error = ref('')
const visible = reactive<Record<Layer, boolean>>({ L1: true, L2: true, L3: true })
const selectedId = ref('')
const memoryMenuOpen = ref(false)
const hoveredId = ref('')
const zoom = ref(1)
const panX = ref(0)
const panY = ref(0)
let dragging: { x: number; y: number; panX: number; panY: number } | null = null
const nodeIndex = computed(() => new Map(graph.value?.nodes.map(node => [node.id, node]) || []))
const active = computed(() => nodeIndex.value.get(selectedId.value || hoveredId.value) || null)
const neighbors = computed(() => {
  const found = new Set<string>(); const id = selectedId.value || hoveredId.value
  if (!id || !graph.value) return found
  found.add(id); let frontier = [id]
  for (let depth = 0; depth < 2; depth++) {
    const next: string[] = []
    for (const current of frontier) for (const neighbor of graph.value.adjacency.get(current) || []) if (!found.has(neighbor)) { found.add(neighbor); next.push(neighbor) }
    frontier = next
  }
  return found
})
const viewBox = computed(() => `0 0 ${stageWidth.value} ${stageHeight.value}`)
const viewTransform = computed(() => `translate(${(stageWidth.value - 1200 * zoom.value) / 2 + panX.value} ${(stageHeight.value - 1200 * zoom.value) / 2 + panY.value}) scale(${zoom.value})`)
const color = (layer: Layer) => layer === 'L3' ? 'var(--primary)' : layer === 'L2' ? 'color-mix(in srgb, var(--primary) 78%, var(--foreground) 22%)' : 'color-mix(in srgb, var(--primary) 38%, var(--foreground) 62%)'
const CLUSTER_LABELS: Record<string, string> = {
  Notebook: '收藏夹', Quiz: '测验', 'Knowledge base': '知识库', Book: '书籍', Partner: '伙伴', 'Co-writer': 'Co-writer',
  Profile: '配置文件', Recent: '近期', Scope: '范围', Chat: '聊天',
}
function clusterDisplayLabel(label: string) { return CLUSTER_LABELS[label] || label }
const visibleNodes = computed(() => graph.value?.nodes.filter(node => node.r > 0 && visible[node.layer]) || [])
const layerCounts = computed(() => ({ L1: graph.value?.nodes.filter(node => node.r > 0 && node.layer === 'L1').length || 0, L2: graph.value?.nodes.filter(node => node.r > 0 && node.layer === 'L2').length || 0, L3: graph.value?.nodes.filter(node => node.r > 0 && node.layer === 'L3').length || 0 }))
const hoverStyle = computed(() => {
  if (!active.value) return {}
  const tx = (stageWidth.value - 1200 * zoom.value) / 2 + panX.value
  const ty = (stageHeight.value - 1200 * zoom.value) / 2 + panY.value
  const x = (active.value.x * zoom.value + tx) / stageWidth.value * 100
  const y = (active.value.y * zoom.value + ty) / stageHeight.value * 100
  return { left: `${Math.min(72, Math.max(4, x + 2))}%`, top: `${Math.min(76, Math.max(4, y + 2))}%` }
})
const visibleEdges = computed(() => graph.value?.edges.filter(edge => { const a = nodeIndex.value.get(edge.source); const b = nodeIndex.value.get(edge.target); return a && b && visible[a.layer] && visible[b.layer] }) || [])
async function load() {
  loading.value = true; error.value = ''
  try { graph.value = buildGraph(await fetchMemorySnapshot()); selectedId.value = ''; await nextTick(); fit() }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '记忆图谱加载失败' }
  finally { loading.value = false }
}
onMounted(load)
function fit() { const rect = stage.value?.getBoundingClientRect(); if (!rect) return; stageWidth.value = rect.width; stageHeight.value = rect.height; zoom.value = Math.min(rect.width, rect.height) / 1200 * 0.95; panX.value = 0; panY.value = 0 }
function clusterArc(cluster: ClusterMeta) {
  const cx = 600, cy = 600
  const { startAngle: start, endAngle: end, innerRadius: inner, outerRadius: outer } = cluster
  const large = end - start > Math.PI ? 1 : 0
  const x1 = cx + Math.cos(start) * outer, y1 = cy + Math.sin(start) * outer
  const x2 = cx + Math.cos(end) * outer, y2 = cy + Math.sin(end) * outer
  const x3 = cx + Math.cos(end) * inner, y3 = cy + Math.sin(end) * inner
  const x4 = cx + Math.cos(start) * inner, y4 = cy + Math.sin(start) * inner
  return `M ${x1} ${y1} A ${outer} ${outer} 0 ${large} 1 ${x2} ${y2} L ${x3} ${y3} A ${inner} ${inner} 0 ${large} 0 ${x4} ${y4} Z`
}
function edgePath(edge: GraphEdge) {
  const source = nodeIndex.value.get(edge.source), target = nodeIndex.value.get(edge.target)
  if (!source || !target) return ''
  const mx = (source.x + target.x) / 2, my = (source.y + target.y) / 2
  const k = edge.kind === 'soft' ? 0.45 : 0.25
  const cpx = mx + (600 - mx) * k, cpy = my + (600 - my) * k
  return `M ${source.x} ${source.y} Q ${cpx} ${cpy} ${target.x} ${target.y}`
}
function changeZoom(factor: number) { zoom.value = Math.min(4, Math.max(0.35, zoom.value * factor)) }
function wheel(event: WheelEvent) { event.preventDefault(); changeZoom(Math.exp(-event.deltaY * 0.001)) }
function dragStart(event: PointerEvent) { if ((event.target as Element).closest('[data-node]')) return; dragging = { x: event.clientX, y: event.clientY, panX: panX.value, panY: panY.value }; (event.currentTarget as Element).setPointerCapture(event.pointerId) }
function dragMove(event: PointerEvent) { if (!dragging) return; const rect = (event.currentTarget as Element).getBoundingClientRect(); panX.value = dragging.panX + event.clientX - dragging.x; panY.value = dragging.panY + event.clientY - dragging.y }
function dragEnd() { dragging = null }
function selectNode(node: GraphNode) { selectedId.value = selectedId.value === node.id ? '' : node.id }
function openNode(node: GraphNode) {
  const entryId = node.id.split(':').slice(2).join(':')
  const url = new URL(node.href, window.location.origin)
  if (node.layer !== 'L1') url.searchParams.set('focus', entryId)
  void router.push(`${url.pathname}${url.search}`)
}
</script>

<template>
  <main class="memory-graph-page"><nav class="memory-page-bar" aria-label="位置"><div class="memory-crumb-wrap"><button type="button" class="memory-crumb" aria-haspopup="menu" :aria-expanded="memoryMenuOpen" @click.stop="memoryMenuOpen = !memoryMenuOpen" @keydown.esc="memoryMenuOpen = false"><span aria-hidden="true"><LegacyIcon name="memory" :size="14" /></span>记忆</button><template v-if="memoryMenuOpen"><div class="memory-menu-dismiss" @click="memoryMenuOpen = false"></div><div class="memory-resource-menu" role="menu" aria-label="个性化"><p>个性化</p><RouterLink role="menuitem" to="/personalization" @click="memoryMenuOpen = false">全部个性化</RouterLink><RouterLink role="menuitem" to="/agents" @click="memoryMenuOpen = false">子智能体</RouterLink><RouterLink role="menuitem" to="/space/personas" @click="memoryMenuOpen = false">Personas</RouterLink><RouterLink role="menuitem" to="/space/skills" @click="memoryMenuOpen = false">技能</RouterLink><RouterLink role="menuitem" to="/space/mcp" @click="memoryMenuOpen = false">MCP 服务</RouterLink><RouterLink role="menuitem" to="/space/cli-apps" @click="memoryMenuOpen = false">CLI 应用</RouterLink><RouterLink role="menuitem" class="is-active" to="/memory" @click="memoryMenuOpen = false">记忆</RouterLink></div></template></div></nav><header class="memory-graph-header"><div class="memory-graph-heading"><RouterLink to="/memory"><LegacyIcon name="arrowLeft" :size="14" />记忆</RouterLink><div><h1>记忆图谱</h1><p>中心为 L3 综合，中圈为 L2 事实，外圈为 L1 原始事件。</p></div></div><button :disabled="loading" @click="load"><LegacyIcon name="refreshCw" :size="14" :class="{ 'memory-spin': loading }" />刷新</button></header><p v-if="error" class="error" role="alert">{{ error }}</p><div ref="stage" class="memory-graph-stage"><p v-if="loading" class="memory-graph-loading" role="status">正在生成记忆图谱…</p><svg class="memory-graph-canvas" :viewBox="viewBox" aria-label="记忆图谱" role="img" @wheel="wheel" @pointerdown="dragStart" @pointermove="dragMove" @pointerup="dragEnd" @pointercancel="dragEnd"><g :transform="viewTransform"><defs><radialGradient id="halo-l3" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="var(--primary)" stop-opacity=".2"/><stop offset="100%" stop-color="var(--primary)" stop-opacity=".02"/></radialGradient><radialGradient id="halo-l2" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="var(--primary)" stop-opacity=".12"/><stop offset="100%" stop-color="var(--primary)" stop-opacity=".02"/></radialGradient><radialGradient id="halo-l1" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="var(--foreground)" stop-opacity=".08"/><stop offset="100%" stop-color="var(--foreground)" stop-opacity=".01"/></radialGradient></defs><path v-for="cluster in graph?.clusters || []" :key="`halo-${cluster.id}`" :d="clusterArc(cluster)" :fill="`url(#halo-${cluster.layer.toLowerCase()})`" stroke="color-mix(in srgb, var(--primary) 8%, transparent)" stroke-width="0.6" /><circle cx="600" cy="600" r="570" class="memory-ring" /><circle cx="600" cy="600" r="360" class="memory-ring" /><circle cx="600" cy="600" r="190" class="memory-ring" /><template v-for="cluster in graph?.clusters || []" :key="cluster.id"><g v-if="visible[cluster.layer] && cluster.layer !== 'L3'"><text :x="cluster.cx" :y="cluster.cy - 12" class="memory-cluster-label" :font-size="cluster.layer === 'L1' ? 22 : 20">{{ clusterDisplayLabel(cluster.label) }}</text><text :x="cluster.cx" :y="cluster.cy + 14" class="memory-cluster-count" :font-size="cluster.layer === 'L1' ? 15 : 14">{{ cluster.count.toLocaleString() }} {{ cluster.layer === 'L2' ? '条事实' : '条事件' }}</text></g></template><template v-if="visible.L3"><circle cx="600" cy="600" r="64" class="memory-l3-center" /><text x="600" y="590" class="memory-l3-title">L3</text><text x="600" y="616" class="memory-l3-subtitle">综合</text></template><path v-for="edge in visibleEdges" :key="`${edge.source}:${edge.target}`" :d="edgePath(edge)" fill="none" :class="{ faded: neighbors.size && (!neighbors.has(edge.source) || !neighbors.has(edge.target)) }" class="memory-edge" /><circle v-for="node in visibleNodes" :key="node.id" :data-node="node.id" :cx="node.x" :cy="node.y" :r="Math.max(node.r, selectedId === node.id ? 8 : 5)" :fill="color(node.layer)" :class="{ faded: neighbors.size && !neighbors.has(node.id), chosen: selectedId === node.id }" class="memory-node" tabindex="0" @mouseenter="hoveredId = node.id" @mouseleave="hoveredId = ''" @focus="hoveredId = node.id" @blur="hoveredId = ''" @click.stop="selectNode(node)" @dblclick.stop="openNode(node)" @keydown.enter="openNode(node)"><title>{{ node.label }} — {{ node.preview }}</title></circle></g></svg><div class="memory-graph-controls"><div class="memory-graph-zoom"><button type="button" aria-label="放大" title="放大" @click="changeZoom(1.25)"><LegacyIcon name="zoomIn" :size="14" /></button><button type="button" aria-label="缩小" title="缩小" @click="changeZoom(0.8)"><LegacyIcon name="zoomOut" :size="14" /></button><button type="button" aria-label="适配" title="适配" @click="fit"><LegacyIcon name="maximize2" :size="14" /></button><span>{{ Math.round(zoom * 100) }}%</span></div><div class="memory-graph-layer-controls"><button v-for="layer in (['L3', 'L2', 'L1'] as const)" :key="layer" type="button" :aria-pressed="visible[layer]" @click="visible[layer] = !visible[layer]"><i :style="{ background: color(layer) }"></i><strong>{{ layer }}</strong><span>{{ layer === 'L3' ? '综合' : layer === 'L2' ? '各模块' : '原始事件' }}</span><LegacyIcon :name="visible[layer] ? 'eye' : 'eyeOff'" :size="12" /></button></div></div><div v-if="active" class="memory-graph-hovercard" :style="hoverStyle"><small>{{ active.layer }} · {{ clusterDisplayLabel(active.cluster) }}</small><p>{{ active.preview || active.label }}</p><button type="button" @click="openNode(active)">双击打开工作区</button></div><div v-if="graph" class="memory-graph-legend"><div><span v-for="layer in (['L3', 'L2', 'L1'] as const)" :key="layer"><i :style="{ background: color(layer) }"></i><strong>{{ layer }}</strong> {{ layerCounts[layer] }}</span></div><p>悬停节点可预览记忆。点击可锁定高亮，并追踪其向内（L1 → L2 → L3）或向外的引用关系。</p></div></div></main>
</template>
