/**
 * GeoGebra command dispatch — Vue3 port of web/lib/geogebra-commands.ts.
 * Styling commands have no algebra result, so they must be routed to the
 * documented setColor/setLineThickness APIs instead of evalCommand.
 */
export interface GeoGebraCommandAPI {
  evalCommand: (command: string) => boolean
  setColor?: (object: string, red: number, green: number, blue: number) => void
  setLineThickness?: (object: string, thickness: number) => void
  exists?: (object: string) => boolean
}

/** Split an agent-authored script into non-empty command lines (comments start with #). */
export function parseGgbCommands(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('#'))
}

export function runGeoGebraCommand(api: GeoGebraCommandAPI, command: string): boolean {
  const thickness = command.match(/^SetLineThickness\(\s*([^,()]+)\s*,\s*(-?\d+)\s*\)$/i)
  if (thickness && api.setLineThickness) {
    const value = Number(thickness[2])
    const object = String(thickness[1]).trim()
    if (value === -1 || (value >= 1 && value <= 13)) {
      if (api.exists && !api.exists(object)) return false
      api.setLineThickness(object, value)
      return true
    }
  }
  const color = command.match(
    /^SetColou?r\(\s*([^,()]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/i,
  )
  if (color && api.setColor) {
    const rgb = [Number(color[2]), Number(color[3]), Number(color[4])]
    const object = String(color[1]).trim()
    if (rgb.every(value => Number.isFinite(value) && value >= 0 && value <= 1)) {
      if (api.exists && !api.exists(object)) return false
      api.setColor(
        object,
        Math.round((rgb[0] as number) * 255),
        Math.round((rgb[1] as number) * 255),
        Math.round((rgb[2] as number) * 255),
      )
      return true
    }
  }
  return api.evalCommand(command)
}
