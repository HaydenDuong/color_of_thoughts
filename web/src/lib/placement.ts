/**
 * Deterministic layout + drift phases from participant UUID so spheres stay
 * in roughly the same neighborhood across reloads without a fixed grid.
 */

export type SpherePlacement = {
  baseX: number
  baseY: number
  baseZ: number
  phase: number
  phase2: number
}

function stringHash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function placementFromParticipantId(id: string): SpherePlacement {
  const h = stringHash(id)
  const u1 = (h & 0xffff) / 0xffff
  const u2 = ((h >> 16) & 0xffff) / 0xffff
  const spread = 4.6
  const baseX = (u1 - 0.5) * spread
  const baseY = (u2 - 0.5) * spread * 0.62
  const baseZ = (((h >>> 8) % 1000) / 1000 - 0.5) * 0.35
  const phase = u1 * Math.PI * 2
  const phase2 = u2 * Math.PI * 2
  return { baseX, baseY, baseZ, phase, phase2 }
}
