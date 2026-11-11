<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'

const emit = defineEmits<{ done: [] }>()
const canvas = ref<HTMLCanvasElement | null>(null)
const reducedMotion = ref(false)
const COLORS = ['#FF4D6D', '#FF8A3D', '#FFC53D', '#3DD68C', '#38BDF8', '#7C7CFF', '#F472B6']
const DURATION = 3200
const TAIL_FADE = 550
const BASE_FRAME_MS = 1000 / 60
type Shape = 'paper' | 'sequin' | 'streamer'
interface Particle { x: number; y: number; vx: number; vy: number; w: number; h: number; color: string; shape: Shape; tilt: number; tiltSpin: number; flip: number; flipSpeed: number; wobble: number; wobbleSpeed: number; wobbleStrength: number; life: number; decay: number }
interface Cannon { x: number; y: number; aim: number; spread: number; count: number; delay: number }
function makeParticle(cannon: Cannon): Particle {
  const nearField = Math.random() < 0.18
  const speed = nearField ? 6 + Math.random() * 7 : 17 + Math.sqrt(Math.random()) * 17
  const angle = -Math.PI / 2 + cannon.aim + (Math.random() - 0.5) * cannon.spread
  const shapeRoll = Math.random()
  const shape: Shape = shapeRoll < 0.66 ? 'paper' : shapeRoll < 0.88 ? 'sequin' : 'streamer'
  const w = shape === 'streamer' ? 3 + Math.random() * 2 : 7 + Math.random() * 5
  const h = shape === 'streamer' ? 14 + Math.random() * 10 : shape === 'sequin' ? w : w * (0.5 + Math.random() * 0.35)
  return { x: cannon.x + (Math.random() - 0.5) * 26, y: cannon.y + (Math.random() - 0.5) * 14, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, w, h, color: COLORS[Math.floor(Math.random() * COLORS.length)], shape, tilt: Math.random() * Math.PI * 2, tiltSpin: (Math.random() - 0.5) * 0.24, flip: Math.random() * Math.PI * 2, flipSpeed: (shape === 'sequin' ? 0.18 : 0.09) * (0.6 + Math.random() * 0.9), wobble: Math.random() * Math.PI * 2, wobbleSpeed: 0.04 + Math.random() * 0.05, wobbleStrength: 0.35 + Math.random() * 0.9, life: 1, decay: 0.00045 + Math.random() * 0.00045 }
}
let raf = 0
let resizeHandler: (() => void) | null = null
onMounted(() => {
  reducedMotion.value = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reducedMotion.value) { emit('done'); return }
  const element = canvas.value
  const context = element?.getContext('2d')
  if (!element || !context) { emit('done'); return }
  let width = window.innerWidth
  let height = window.innerHeight
  const resize = () => {
    width = window.innerWidth; height = window.innerHeight
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    element.width = width * dpr; element.height = height * dpr
    element.style.width = `${width}px`; element.style.height = `${height}px`
    context.setTransform(dpr, 0, 0, dpr, 0, 0)
  }
  resizeHandler = resize
  resize(); window.addEventListener('resize', resize)
  const cannons: Cannon[] = [
    { x: width * 0.14, y: height * 0.88, aim: 0.42, spread: 0.72, count: 62, delay: 0 },
    { x: width * 0.86, y: height * 0.88, aim: -0.42, spread: 0.72, count: 62, delay: 110 },
    { x: width * 0.5, y: height * 0.94, aim: 0, spread: 1, count: 56, delay: 260 },
  ]
  const particles: Particle[] = []
  const fired = cannons.map(() => false)
  let last = performance.now()
  const start = last
  const tick = (now: number) => {
    const elapsed = now - start
    const step = Math.min((now - last) / BASE_FRAME_MS, 3)
    last = now
    cannons.forEach((cannon, index) => {
      if (!fired[index] && elapsed >= cannon.delay) {
        fired[index] = true
        for (let count = 0; count < cannon.count; count += 1) particles.push(makeParticle(cannon))
      }
    })
    context.clearRect(0, 0, width, height)
    const tailFade = elapsed > DURATION - TAIL_FADE ? Math.max(0, 1 - (elapsed - (DURATION - TAIL_FADE)) / TAIL_FADE) : 1
    for (let index = particles.length - 1; index >= 0; index -= 1) {
      const particle = particles[index]
      particle.vx *= Math.pow(0.968, step); particle.vy *= Math.pow(0.995, step); particle.vy += 0.42 * step
      if (particle.vy > 9) particle.vy = 9
      particle.wobble += particle.wobbleSpeed * step
      const settled = Math.max(0, 1 - Math.abs(particle.vx) / 6)
      particle.x += (particle.vx + Math.cos(particle.wobble) * particle.wobbleStrength * settled) * step
      particle.y += particle.vy * step; particle.tilt += particle.tiltSpin * step; particle.flip += particle.flipSpeed * step; particle.life -= particle.decay * step
      if (particle.life <= 0 || particle.y - 40 > height) { particles.splice(index, 1); continue }
      if (particle.x < -60 || particle.x > width + 60) continue
      const alpha = Math.min(1, particle.life * 2.2)
      const squash = Math.cos(particle.flip)
      context.save(); context.globalAlpha = alpha * (squash < 0 ? 0.76 : 1) * tailFade
      context.translate(particle.x, particle.y); context.rotate(particle.tilt); context.scale(1, squash); context.fillStyle = particle.color
      if (particle.shape === 'sequin') { context.beginPath(); context.arc(0, 0, particle.w / 2, 0, Math.PI * 2); context.fill() }
      else context.fillRect(-particle.w / 2, -particle.h / 2, particle.w, particle.h)
      context.restore()
    }
    if (elapsed < DURATION && (particles.length || elapsed < 400)) raf = requestAnimationFrame(tick)
    else { context.clearRect(0, 0, width, height); emit('done') }
  }
  raf = requestAnimationFrame(tick)
})
onUnmounted(() => { cancelAnimationFrame(raf); if (resizeHandler) window.removeEventListener('resize', resizeHandler) })
</script>

<template><Teleport to="body"><canvas v-if="!reducedMotion" ref="canvas" aria-hidden="true" class="mastery-level-up-canvas" /></Teleport></template>
