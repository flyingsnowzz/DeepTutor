<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { api } from '../api'
import LegacyIcon from './LegacyIcon.vue'
interface Device { device_id: string; device_name: string; device_kind: string; paired_at: string; last_seen: string; active: boolean }
interface Pairing { device_id: string; token: string; device_name: string; device_kind: string }
const props = defineProps<{ kbName: string }>()
const devices = ref<Device[]>([])
const objects = ref(0)
const deviceName = ref('')
const issued = ref<Pairing | null>(null)
const copied = ref(false)
const busy = ref(false)
const error = ref('')
const active = computed(() => devices.value.filter(device => device.active).length)
const headers = computed(() => ({ 'Content-Type': 'application/json', 'X-MN4-KB': props.kbName }))
async function load() { error.value = ''; try { const [list, status] = await Promise.all([api<Device[]>('/api/marginnote4/devices', { headers: headers.value }), api<{ objects: number }>('/api/marginnote4/status', { headers: headers.value })]); devices.value = list; objects.value = status.objects } catch (cause) { devices.value = []; error.value = cause instanceof Error ? cause.message : '设备加载失败' } }
onMounted(load)
async function pair() { busy.value = true; error.value = ''; try { issued.value = await api<Pairing>('/api/marginnote4/pair', { method: 'POST', headers: headers.value, body: JSON.stringify({ device_name: deviceName.value.trim(), device_kind: 'macos' }) }); deviceName.value = ''; copied.value = false; await load() } catch (cause) { error.value = cause instanceof Error ? cause.message : '配对失败' } finally { busy.value = false } }
async function revoke(device: Device) { if (!confirm(`取消配对“${device.device_name}”？`)) return; busy.value = true; try { await api(`/api/marginnote4/devices/${encodeURIComponent(device.device_id)}`, { method: 'DELETE', headers: headers.value }); if (issued.value?.device_id === device.device_id) issued.value = null; await load() } catch (cause) { error.value = cause instanceof Error ? cause.message : '取消配对失败' } finally { busy.value = false } }
async function copy() { if (!issued.value) return; await navigator.clipboard.writeText(`${issued.value.device_id}:${issued.value.token}`); copied.value = true }
</script>
<template><section class="kb-section"><header class="kb-section-heading"><div><h2>MarginNote 4 设备</h2><p>插件通过配对令牌同步笔记、摘录、卡片和脑图节点。</p></div><div class="kb-device-metrics"><span>活跃设备<strong>{{ active }}</strong></span><span>同步对象<strong>{{ objects }}</strong></span></div></header><p v-if="error" class="error" role="alert">{{ error }}</p><form class="kb-inline-form" @submit.prevent="pair"><label>设备名称<input v-model="deviceName" placeholder="我的 Mac"></label><button class="primary" :disabled="busy"><LegacyIcon name="plus" :size="14" />配对设备</button></form><div v-if="issued" class="kb-issued"><h3>配对令牌只显示一次</h3><p>请在 MarginNote 4 插件中输入以下完整令牌。</p><code>{{ issued.device_id }}:{{ issued.token }}</code><button @click="copy">{{ copied ? '已复制' : '复制令牌' }}</button></div><div v-if="!devices.length" class="kb-empty">尚未配对设备。</div><div v-else class="kb-record-list"><article v-for="device in devices" :key="device.device_id"><div><strong>{{ device.device_name }}</strong><p>{{ device.device_kind }} · {{ device.active ? '活跃' : '已停用' }}</p><small>配对于 {{ new Date(device.paired_at).toLocaleString('zh-CN') }}<template v-if="device.last_seen"> · 最近同步 {{ new Date(device.last_seen).toLocaleString('zh-CN') }}</template></small></div><button class="danger" :disabled="busy" @click="revoke(device)">取消配对</button></article></div></section></template>
