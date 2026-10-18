import { describe, expect, it } from 'vitest'
import { MAX_ZOOM, MIN_ZOOM, anchorScroll, fitZoom, stepZoom } from './zoom'

describe('zoom', () => {
  it('fits wide and tall diagrams inside the viewport, with padding', () => {
    expect(fitZoom(2000, 400, 1048, 648)).toBeCloseTo(0.5) // width-bound: (1048-48)/2000
    expect(fitZoom(400, 2000, 1048, 1048)).toBeCloseTo(0.5) // height-bound
  })

  it('does not blow small diagrams up past 200%, and survives bad sizes', () => {
    expect(fitZoom(100, 50, 2000, 2000)).toBe(2)
    expect(fitZoom(0, 0, 800, 600)).toBe(1)
  })

  it('steps and clamps', () => {
    expect(stepZoom(1, 1)).toBeCloseTo(1.25)
    expect(stepZoom(1, -1)).toBeCloseTo(0.8)
    expect(stepZoom(MAX_ZOOM, 1)).toBe(MAX_ZOOM)
    expect(stepZoom(MIN_ZOOM, -1)).toBe(MIN_ZOOM)
  })

  it('keeps the point under the cursor fixed', () => {
    // content point under cursor before: (scroll + p) / z0 = (100 + 50) / 1 = 150
    const { left, top } = anchorScroll(100, 0, 50, 20, 1, 2)
    expect((left + 50) / 2).toBe(150)
    expect((top + 20) / 2).toBe(20)
  })
})
