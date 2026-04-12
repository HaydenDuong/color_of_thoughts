/**
 * Random two-word labels for anonymous participants (stable once stored in Supabase).
 * Not cryptographically unique — fine for a friendly display name.
 */

const ADJECTIVES = [
  'Quiet',
  'Gentle',
  'Bright',
  'Calm',
  'Swift',
  'Soft',
  'Bold',
  'Warm',
  'Cool',
  'Keen',
  'Sunny',
  'Misty',
  'Silver',
  'Golden',
  'Crimson',
  'Azure',
  'Amber',
  'Jade',
  'Ivory',
  'Velvet',
] as const

const NOUNS = [
  'Maple',
  'River',
  'Harbor',
  'Meadow',
  'Cedar',
  'Willow',
  'Falcon',
  'Heron',
  'Lotus',
  'Sparrow',
  'Comet',
  'Orbit',
  'Canvas',
  'Echo',
  'Breeze',
  'Horizon',
  'Lantern',
  'Mirror',
  'Pebble',
  'Garden',
] as const

function pick<T extends readonly string[]>(arr: T): T[number] {
  return arr[Math.floor(Math.random() * arr.length)]!
}

export function generateAnonymousLabel(): string {
  return `${pick(ADJECTIVES)} ${pick(NOUNS)}`
}
