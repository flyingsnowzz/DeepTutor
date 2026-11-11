import { describe, expect, it, vi } from 'vitest'
import { parseGgbCommands, runGeoGebraCommand } from '../geogebraCommands'

function api() {
  return {
    evalCommand: vi.fn(() => true),
    setColor: vi.fn(),
    setLineThickness: vi.fn(),
    exists: vi.fn(() => true),
  }
}

describe('parseGgbCommands', () => {
  it('strips comments and blank lines', () => {
    expect(parseGgbCommands('A=(1,2)\n# description\n\nB=(3,4)\r\n')).toEqual(['A=(1,2)', 'B=(3,4)'])
    expect(parseGgbCommands('')).toEqual([])
  })
})

describe('runGeoGebraCommand', () => {
  it('routes SetLineThickness within the allowed range', () => {
    const a = api()
    expect(runGeoGebraCommand(a, 'SetLineThickness(obj, 5)')).toBe(true)
    expect(a.setLineThickness).toHaveBeenCalledWith('obj', 5)
    expect(a.evalCommand).not.toHaveBeenCalled()
    expect(runGeoGebraCommand(a, 'SetLineThickness(obj, -1)')).toBe(true)
  })
  it('falls back to evalCommand for out-of-range or unknown objects', () => {
    const a = api()
    expect(runGeoGebraCommand(a, 'SetLineThickness(obj, 99)')).toBe(true)
    expect(a.evalCommand).toHaveBeenCalled()
    a.exists.mockReturnValue(false)
    const b = api()
    b.exists.mockReturnValue(false)
    expect(runGeoGebraCommand(b, 'SetLineThickness(obj, 3)')).toBe(false)
  })
  it('routes SetColor / SetColour with RGB scaling', () => {
    const a = api()
    expect(runGeoGebraCommand(a, 'SetColor(obj, 1, 0.5, 0)')).toBe(true)
    expect(a.setColor).toHaveBeenCalledWith('obj', 255, 128, 0)
    const b = api()
    expect(runGeoGebraCommand(b, 'SetColour(obj, 0.2, 0.4, 0.6)')).toBe(true)
    expect(b.setColor).toHaveBeenCalledWith('obj', 51, 102, 153)
  })
  it('rejects out-of-range color values and defers to evalCommand', () => {
    const a = api()
    expect(runGeoGebraCommand(a, 'SetColor(obj, 2, 0, 0)')).toBe(true)
    expect(a.setColor).not.toHaveBeenCalled()
    expect(a.evalCommand).toHaveBeenCalled()
  })
})
