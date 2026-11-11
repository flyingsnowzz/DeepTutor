<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import LegacyIcon from './LegacyIcon.vue'
import ResourceReuseToggle from './ResourceReuseToggle.vue'
import { api } from '../api'
import {
  MAX_READING_REFERENCE_MATERIALS,
  MAX_READING_REFERENCE_UNITS,
  countSelectedReadingUnits,
  type ReadingUnitKind,
  type SelectedReadingReference,
  type SelectedReadingUnit,
} from '../readingReferences'

interface MaterialInfo {
  material_id: string
  filename: string
  unit: ReadingUnitKind
  unit_count: number
  title: string
  revision?: number
}
interface OutlineRow { locator: number; title: string }
interface UnitReference { locator: number; title: string }
interface MaterialDetail extends MaterialInfo { outline: OutlineRow[]; unit_refs: UnitReference[] }

const props = withDefaults(defineProps<{ open: boolean; initial: SelectedReadingReference[]; everyTurn?: boolean }>(), { everyTurn: false })
const emit = defineEmits<{ close: []; apply: [refs: SelectedReadingReference[]]; 'update:everyTurn': [value: boolean] }>()
const materials = ref<MaterialInfo[]>([])
const details = ref<Record<string, MaterialDetail>>({})
const activeMaterialId = ref('')
const selected = ref<SelectedReadingReference[]>([])
const query = ref('')
const loadingMaterials = ref(false)
const loadingDetail = ref(false)
const error = ref('')

const unitLabels: Record<ReadingUnitKind, string> = {
  page: '页', chapter: '章', slide: '页幻灯片', section: '节', segment: '段',
}
const filteredMaterials = computed(() => {
  const keyword = query.value.trim().toLocaleLowerCase()
  if (!keyword) return materials.value
  return materials.value.filter(material => `${material.title} ${material.filename}`.toLocaleLowerCase().includes(keyword))
})
const activeMaterial = computed(() => materials.value.find(material => material.material_id === activeMaterialId.value) || null)
const activeDetail = computed(() => activeMaterialId.value ? details.value[activeMaterialId.value] : undefined)
const selectedCount = computed(() => countSelectedReadingUnits(selected.value))
const selectedKeys = computed(() => new Set(selected.value.flatMap(reference => reference.units.map(unit => unitKey(reference.materialId, reference.revision, unit.locator)))))
const activeUnits = computed<SelectedReadingUnit[]>(() => {
  const detail = activeDetail.value
  if (!detail) return []
  return Array.from({ length: detail.unit_count }, (_, index) => {
    const locator = index + 1
    const outlineTitle = detail.outline.find(row => row.locator === locator && row.title.trim())?.title
    const nativeTitle = detail.unit_refs.find(row => row.locator === locator && row.title.trim())?.title
    return { locator, title: outlineTitle?.trim() || nativeTitle?.trim() || `${unitLabels[detail.unit]} ${locator}` }
  })
})
const allActiveSelected = computed(() => activeUnits.value.length > 0 && activeUnits.value.every(unit => selectedKeys.value.has(unitKey(activeMaterial.value?.material_id || '', revisionOf(activeMaterial.value), unit.locator))))

function revisionOf(material: MaterialInfo | null | undefined) { return material?.revision ?? 1 }
function unitKey(materialId: string, revision: number, locator: number) { return `${materialId}:${revision}:${locator}` }
function countFor(material: MaterialInfo) {
  return selected.value.find(reference => reference.materialId === material.material_id && reference.revision === revisionOf(material))?.units.length || 0
}
function addUnits(material: MaterialInfo, additions: SelectedReadingUnit[]) {
  const revision = revisionOf(material)
  const existing = selected.value.find(reference => reference.materialId === material.material_id && reference.revision === revision)
  if (!existing && !selected.value.some(reference => reference.materialId === material.material_id) && new Set(selected.value.map(reference => reference.materialId)).size >= MAX_READING_REFERENCE_MATERIALS) {
    error.value = `一次最多可引用 ${MAX_READING_REFERENCE_MATERIALS} 份精读材料。`
    return
  }
  const availableKeys = new Set(existing?.units.map(unit => unitKey(material.material_id, revision, unit.locator)) || [])
  const pending = additions.filter(unit => !availableKeys.has(unitKey(material.material_id, revision, unit.locator)))
  const remaining = MAX_READING_REFERENCE_UNITS - selectedCount.value
  if (remaining <= 0) {
    error.value = `一次最多可引用 ${MAX_READING_REFERENCE_UNITS} 个精读章节。`
    return
  }
  const accepted = pending.slice(0, remaining)
  if (accepted.length < pending.length) error.value = `一次最多可引用 ${MAX_READING_REFERENCE_UNITS} 个精读章节。`
  else error.value = ''
  if (!accepted.length) return
  if (existing) {
    selected.value = selected.value.map(reference => reference.materialId === material.material_id && reference.revision === revision ? { ...reference, units: [...reference.units, ...accepted] } : reference)
    return
  }
  selected.value = [...selected.value, {
    materialId: material.material_id,
    revision,
    materialTitle: material.title || material.filename,
    unit: material.unit,
    units: accepted,
  }]
}
function removeUnits(materialId: string, revision: number, locators: Set<number>) {
  selected.value = selected.value.map(reference => reference.materialId === materialId && reference.revision === revision ? { ...reference, units: reference.units.filter(unit => !locators.has(unit.locator)) } : reference).filter(reference => reference.units.length > 0)
  error.value = ''
}
function toggleUnit(unit: SelectedReadingUnit) {
  const material = activeMaterial.value
  if (!material) return
  const revision = revisionOf(material)
  if (selectedKeys.value.has(unitKey(material.material_id, revision, unit.locator))) removeUnits(material.material_id, revision, new Set([unit.locator]))
  else addUnits(material, [unit])
}
function toggleAllActive() {
  const material = activeMaterial.value
  if (!material || !activeUnits.value.length) return
  const revision = revisionOf(material)
  if (allActiveSelected.value) removeUnits(material.material_id, revision, new Set(activeUnits.value.map(unit => unit.locator)))
  else addUnits(material, activeUnits.value)
}
async function activateMaterial(materialId: string) {
  activeMaterialId.value = materialId
  if (details.value[materialId]) return
  loadingDetail.value = true
  error.value = ''
  try {
    details.value = { ...details.value, [materialId]: await api<MaterialDetail>(`/api/reading/materials/${encodeURIComponent(materialId)}`) }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '无法加载精读章节。'
  } finally {
    loadingDetail.value = false
  }
}
async function loadMaterials() {
  loadingMaterials.value = true
  error.value = ''
  try {
    materials.value = await api<MaterialInfo[]>('/api/reading/materials')
    const currentExists = materials.value.some(material => material.material_id === activeMaterialId.value)
    const next = currentExists ? activeMaterialId.value : (materials.value[0]?.material_id || '')
    if (next) await activateMaterial(next)
    else activeMaterialId.value = ''
  } catch (cause) {
    materials.value = []
    activeMaterialId.value = ''
    error.value = cause instanceof Error ? cause.message : '无法加载精读材料。'
  } finally {
    loadingMaterials.value = false
  }
}
function close() { emit('close') }
function apply() { emit('apply', selected.value.map(reference => ({ ...reference, units: [...reference.units] }))); close() }
function clear() { selected.value = []; error.value = '' }
function keydown(event: KeyboardEvent) { if (props.open && event.key === 'Escape') close() }

watch([() => props.open, () => props.initial], ([open]) => {
  if (!open) return
  selected.value = props.initial.map(reference => ({ ...reference, units: [...reference.units] }))
  query.value = ''
  error.value = ''
  void loadMaterials()
}, { deep: true })
onMounted(() => document.addEventListener('keydown', keydown))
onUnmounted(() => document.removeEventListener('keydown', keydown))
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="picker-overlay reading-reference-overlay" @click.self="close">
      <section class="reading-reference-picker" role="dialog" aria-modal="true" aria-labelledby="reading-reference-picker-title">
        <header>
          <div class="picker-icon"><LegacyIcon name="bookmark" :size="18" /></div>
          <div><h2 id="reading-reference-picker-title">选择精读章节</h2><p>选择已导入精读材料中的章节，作为下一次回答的依据。</p></div>
          <ResourceReuseToggle :every-turn="everyTurn" @update:every-turn="emit('update:everyTurn', $event)" />
          <button type="button" aria-label="关闭" @click="close"><LegacyIcon name="close" :size="18" /></button>
        </header>
        <div v-if="error" class="reading-reference-error" role="alert">{{ error }}</div>
        <div class="reading-reference-body">
          <aside>
            <label class="reading-material-search"><LegacyIcon name="search" :size="15" /><input v-model="query" placeholder="搜索精读材料" /></label>
            <div class="reading-material-list">
              <div v-if="loadingMaterials" class="picker-loading"><span class="mastery-spinner" /></div>
              <template v-else-if="filteredMaterials.length">
                <button v-for="material in filteredMaterials" :key="material.material_id" type="button" :class="{ active: material.material_id === activeMaterialId }" @click="activateMaterial(material.material_id)">
                  <LegacyIcon name="bookmark" :size="16" />
                  <span><strong>{{ material.title || material.filename }}</strong><small>{{ material.unit_count }} 节</small></span>
                  <em v-if="countFor(material)">{{ countFor(material) }}</em>
                  <LegacyIcon name="chevronRight" :size="15" />
                </button>
              </template>
              <p v-else>未找到精读材料。</p>
            </div>
          </aside>
          <section class="reading-unit-panel">
            <div v-if="!activeMaterial" class="reading-picker-placeholder">选择一份精读材料以查看章节。</div>
            <div v-else-if="loadingDetail && !activeDetail" class="picker-loading"><span class="mastery-spinner" /></div>
            <template v-else-if="activeDetail">
              <div class="reading-unit-heading"><div><h3>{{ activeMaterial.title || activeMaterial.filename }}</h3><p>{{ activeMaterial.filename }}</p></div><button type="button" @click="toggleAllActive">{{ allActiveSelected ? '清除此材料' : '全选' }}</button></div>
              <div class="reading-unit-list">
                <button v-for="unit in activeUnits" :key="unit.locator" type="button" :class="{ selected: selectedKeys.has(unitKey(activeMaterial.material_id, revisionOf(activeMaterial), unit.locator)) }" @click="toggleUnit(unit)">
                  <span class="history-check"><LegacyIcon v-if="selectedKeys.has(unitKey(activeMaterial.material_id, revisionOf(activeMaterial), unit.locator))" name="check" :size="12" /></span>
                  <span><strong>{{ unit.title }}</strong><small>第 {{ unit.locator }} {{ unitLabels[activeMaterial.unit] }}</small></span>
                </button>
              </div>
            </template>
          </section>
        </div>
        <footer>
          <span>{{ selectedCount ? `已选 ${selectedCount} 个精读章节` : '尚未选择精读章节' }}</span>
          <div><button type="button" @click="clear">清空</button><button type="button" class="primary" @click="apply">应用</button></div>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
