import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const sourceRoot = new URL('../../web/app/', import.meta.url).pathname
const inventory = JSON.parse(readFileSync(new URL('../route-coverage.json', import.meta.url), 'utf8'))

function pages(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? pages(path) : entry.name === 'page.tsx' ? [path] : []
  })
}

function route(path) {
  const segments = relative(sourceRoot, path).split('/').slice(0, -1)
    .filter(segment => !segment.startsWith('('))
    .map(segment => segment.replace(/^\[(.+)\]$/, ':$1'))
  return '/' + segments.join('/')
}

const source = new Set(pages(sourceRoot).map(route))
const tracked = new Set(inventory.map(row => row.route))
const untracked = [...source].filter(path => !tracked.has(path))
const removed = [...tracked].filter(path => !source.has(path))
if (untracked.length || removed.length || tracked.size !== inventory.length) {
  console.error({ untracked, removed, duplicateInventoryRoutes: tracked.size !== inventory.length })
  process.exitCode = 1
}
const counts = Object.fromEntries(['complete', 'in_progress', 'pending'].map(status =>
  [status, inventory.filter(row => row.status === status).length]))
console.log(`${inventory.length} React routes tracked:`, counts)
