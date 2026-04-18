import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { PaletteColor } from '../lib/colorFromImage'
import { usePrefersReducedMotion } from '../lib/usePrefersReducedMotion'

/**
 * "Color of Thoughts" blob — Codrops "Insomnia" approach, adapted to our palette.
 *
 * Reference:
 *   https://github.com/codrops/WebGLBlobs  (Mario Carrillo, MIT)
 *   https://tympanus.net/Tutorials/WebGLBlobs/index3.html
 *
 * The three things that make this look right:
 *   1. Vertex displacement along the normal via 3D Perlin noise (the "blob").
 *   2. `rotateY(pos, sin(uv.y * uFreq + t) * uAmp)` — latitude-dependent twist.
 *      This is what carves the visible vinyl-like grooves across the sphere.
 *   3. The fragment colors every pixel from the *noise value* at that surface
 *      point, so peaks/valleys read as distinct color bands instead of a
 *      lit, uniform hue. Codrops used a procedural `cosPalette`; we replace
 *      that with a weighted lookup into the user's extracted palette, so the
 *      bands are painted with the image's own crayon colors.
 *
 * We use a plain `THREE.ShaderMaterial` (no PBR lighting) on purpose — the
 * banding effect relies on color being a direct function of noise, not of
 * light direction.
 */

const MAX_COLORS = 5

type Props = {
  palette: PaletteColor[]
  /** Stable seed (participant id) — drives per-sphere phase so 50 wall spheres don't all look the same. */
  seed: string
  /** Disable per-frame uniform updates (rarely useful; mostly for tests). */
  animate?: boolean
}

/**
 * Takes an arbitrary-length palette (weights summing to ~1), keeps the top
 * MAX_COLORS entries, and renormalizes so the shader receives a compact,
 * well-formed weight distribution.
 */
function prepareTopColors(palette: PaletteColor[]): {
  colors: THREE.Color[]
  weights: number[]
  count: number
} {
  const top = palette.slice(0, MAX_COLORS)
  const sum = top.reduce((acc, c) => acc + c.weight, 0)
  const safeSum = sum > 0 ? sum : 1

  const colors: THREE.Color[] = top.map(
    (c) => new THREE.Color(c.r / 255, c.g / 255, c.b / 255),
  )
  const weights: number[] = top.map((c) => c.weight / safeSum)

  while (colors.length < MAX_COLORS) {
    colors.push(new THREE.Color(0, 0, 0))
    weights.push(0)
  }

  return { colors, weights, count: top.length }
}

/** Deterministic 0..1 value from a string. */
function seedToUnit(seed: string): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 10000) / 10000
}

/**
 * Classic Perlin 3D noise by Stefan Gustavson (webgl-noise). Used by the
 * vertex shader to displace each vertex along its own normal.
 * Codrops uses `pnoise` (periodic noise) + `glslify`; we inline classic
 * Perlin which visually matches for this scale.
 */
const NOISE_GLSL = /* glsl */ `
vec4 permute(vec4 x){ return mod(((x*34.0)+1.0)*x, 289.0); }
vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
vec3 fade(vec3 t){ return t*t*t*(t*(t*6.0-15.0)+10.0); }

float cnoise(vec3 P){
  vec3 Pi0 = floor(P);
  vec3 Pi1 = Pi0 + vec3(1.0);
  Pi0 = mod(Pi0, 289.0);
  Pi1 = mod(Pi1, 289.0);
  vec3 Pf0 = fract(P);
  vec3 Pf1 = Pf0 - vec3(1.0);
  vec4 ix = vec4(Pi0.x, Pi1.x, Pi0.x, Pi1.x);
  vec4 iy = vec4(Pi0.yy, Pi1.yy);
  vec4 iz0 = Pi0.zzzz;
  vec4 iz1 = Pi1.zzzz;

  vec4 ixy = permute(permute(ix) + iy);
  vec4 ixy0 = permute(ixy + iz0);
  vec4 ixy1 = permute(ixy + iz1);

  vec4 gx0 = ixy0 / 7.0;
  vec4 gy0 = fract(floor(gx0) / 7.0) - 0.5;
  gx0 = fract(gx0);
  vec4 gz0 = vec4(0.5) - abs(gx0) - abs(gy0);
  vec4 sz0 = step(gz0, vec4(0.0));
  gx0 -= sz0 * (step(0.0, gx0) - 0.5);
  gy0 -= sz0 * (step(0.0, gy0) - 0.5);

  vec4 gx1 = ixy1 / 7.0;
  vec4 gy1 = fract(floor(gx1) / 7.0) - 0.5;
  gx1 = fract(gx1);
  vec4 gz1 = vec4(0.5) - abs(gx1) - abs(gy1);
  vec4 sz1 = step(gz1, vec4(0.0));
  gx1 -= sz1 * (step(0.0, gx1) - 0.5);
  gy1 -= sz1 * (step(0.0, gy1) - 0.5);

  vec3 g000 = vec3(gx0.x, gy0.x, gz0.x);
  vec3 g100 = vec3(gx0.y, gy0.y, gz0.y);
  vec3 g010 = vec3(gx0.z, gy0.z, gz0.z);
  vec3 g110 = vec3(gx0.w, gy0.w, gz0.w);
  vec3 g001 = vec3(gx1.x, gy1.x, gz1.x);
  vec3 g101 = vec3(gx1.y, gy1.y, gz1.y);
  vec3 g011 = vec3(gx1.z, gy1.z, gz1.z);
  vec3 g111 = vec3(gx1.w, gy1.w, gz1.w);

  vec4 norm0 = taylorInvSqrt(vec4(dot(g000,g000), dot(g010,g010), dot(g100,g100), dot(g110,g110)));
  g000 *= norm0.x; g010 *= norm0.y; g100 *= norm0.z; g110 *= norm0.w;
  vec4 norm1 = taylorInvSqrt(vec4(dot(g001,g001), dot(g011,g011), dot(g101,g101), dot(g111,g111)));
  g001 *= norm1.x; g011 *= norm1.y; g101 *= norm1.z; g111 *= norm1.w;

  float n000 = dot(g000, Pf0);
  float n100 = dot(g100, vec3(Pf1.x, Pf0.yz));
  float n010 = dot(g010, vec3(Pf0.x, Pf1.y, Pf0.z));
  float n110 = dot(g110, vec3(Pf1.xy, Pf0.z));
  float n001 = dot(g001, vec3(Pf0.xy, Pf1.z));
  float n101 = dot(g101, vec3(Pf1.x, Pf0.y, Pf1.z));
  float n011 = dot(g011, vec3(Pf0.x, Pf1.yz));
  float n111 = dot(g111, Pf1);

  vec3 fade_xyz = fade(Pf0);
  vec4 n_z = mix(vec4(n000, n100, n010, n110), vec4(n001, n101, n011, n111), fade_xyz.z);
  vec2 n_yz = mix(n_z.xy, n_z.zw, fade_xyz.y);
  float n_xyz = mix(n_yz.x, n_yz.y, fade_xyz.x);
  return 2.2 * n_xyz;
}
`

/**
 * Rotate a vector around the Y axis by `angle` radians.
 * Codrops uses this in the vertex shader to twist the sphere per latitude;
 * that twist is what makes the grooves visible.
 */
const ROTATE_Y_GLSL = /* glsl */ `
vec3 rotateY(vec3 v, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return vec3(c * v.x + s * v.z, v.y, -s * v.x + c * v.z);
}
`

const VERTEX_SHADER = /* glsl */ `
${NOISE_GLSL}
${ROTATE_Y_GLSL}

varying vec2  vUv;
varying float vDistort;

uniform float uTime;
uniform float uSpeed;
uniform float uNoiseDensity;
uniform float uNoiseStrength;
uniform float uFreq;
uniform float uAmp;
uniform float uOffset;
uniform float uBreathAmp;

void main() {
  vUv = uv;

  float t = uTime * uSpeed;

  // Perlin-noise displacement along each vertex's normal.
  float distortion = cnoise((normal + t) * uNoiseDensity) * uNoiseStrength;

  vec3 pos = position + normal * distortion;

  // Latitude-dependent twist: the core "Insomnia" trick.
  float angle = sin(uv.y * uFreq + t) * uAmp;
  pos = rotateY(pos, angle);

  // Gentle breathing scale. Codrops uses 1.0 → 1.2; we stay subtler so
  // wall spheres don't overlap when many are on screen.
  float breath = 1.0 + uBreathAmp * sin(uTime + uOffset);
  pos *= breath;

  vDistort = distortion;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`

const FRAGMENT_SHADER = /* glsl */ `
precision highp float;

varying vec2  vUv;
varying float vDistort;

uniform vec3  uColors[${MAX_COLORS}];
uniform float uWeights[${MAX_COLORS}];
uniform int   uColorCount;
uniform float uTime;
uniform float uNoiseStrength;
uniform float uPhase;

/**
 * Piecewise palette lookup for t ∈ [0, 1).
 * Each palette entry i owns a window of width uWeights[i]. Activation is
 * a soft circular bump, so adjacent colors crossfade (no hard banding seams)
 * and the stream wraps cleanly across the 0/1 boundary.
 * A floor on the half-width guarantees tiny palette entries still appear.
 */
vec3 paletteLookup(float t) {
  vec3  total    = vec3(0.0);
  float totalAct = 0.0;
  float cum      = 0.0;
  const float softness = 0.10;

  for (int i = 0; i < ${MAX_COLORS}; i++) {
    if (i >= uColorCount) break;
    float w = uWeights[i];
    float center = cum + w * 0.5;
    cum += w;

    float d = abs(t - center);
    d = min(d, 1.0 - d);

    float halfW = max(w * 0.55, 0.07);
    float act   = 1.0 - smoothstep(halfW, halfW + softness, d);

    total    += uColors[i] * act;
    totalAct += act;
  }
  return total / max(totalAct, 0.0001);
}

void main() {
  // t is the palette coordinate for this fragment.
  // - uv.y gives a smooth pole-to-pole sweep (like Codrops' uHue base).
  // - vDistort adds per-surface variation so color follows the noise bumps,
  //   which is what produces visible bands along the grooves.
  // - uPhase offsets each sphere so the wall does not look uniform.
  // - uTime slowly drifts the whole gradient for a living feel.
  float noiseScale = 1.0 / max(uNoiseStrength, 0.001);
  float t = vUv.y * 1.35 + vDistort * noiseScale * 0.45 + uPhase + uTime * 0.03;
  t = fract(t);

  vec3 color = paletteLookup(t);

  // Saturation boost — keeps the palette vibrant against the cream bg.
  float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = mix(vec3(luma), color, 1.18);
  color = clamp(color, 0.0, 1.0);

  gl_FragColor = vec4(color, 1.0);
}
`

export function PaletteSphereMaterial({ palette, seed, animate = true }: Props) {
  const matRef = useRef<THREE.ShaderMaterial | null>(null)
  const reducedMotion = usePrefersReducedMotion()

  // Stable string fingerprint of the palette VALUES. Using this (instead of
  // the `palette` array reference) as the memo dep prevents uniforms churn
  // when realtime refetch hands us a new array with identical values.
  // Without this, replacing material.uniforms on every refetch disconnects
  // uTime from the compiled shader program and the animation freezes.
  const paletteKey = palette
    .map((p) => `${p.hex}:${p.weight.toFixed(4)}`)
    .join('|')

  const { uniforms, materialKey } = useMemo(() => {
    const { colors, weights, count } = prepareTopColors(palette)
    const phase = seedToUnit(seed)

    // Tuned for a unit sphere. Breath and twist are softened vs Codrops so
    // ~50 wall spheres read cleanly without dominating each other.
    const u = {
      uTime:          { value: 0 },
      uSpeed:         { value: reducedMotion ? 0.08 : 0.28 },
      uNoiseDensity:  { value: 1.8 },
      uNoiseStrength: { value: 0.22 },
      uFreq:          { value: 3.0 },
      uAmp:           { value: reducedMotion ? 1.6 : 3.2 },
      uOffset:        { value: phase * Math.PI * 2 },
      uBreathAmp:     { value: reducedMotion ? 0.02 : 0.07 },
      uPhase:         { value: phase },
      uColors:        { value: colors },
      uWeights:       { value: weights },
      uColorCount:    { value: count },
    }
    return {
      uniforms: u,
      materialKey: `${seed}:${reducedMotion}:${paletteKey}`,
    }
    // `palette` is read for its initial values; `paletteKey` captures the
    // meaningful identity, so we depend on it instead of the array ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paletteKey, seed, reducedMotion])

  useFrame(({ clock }) => {
    if (!animate) return
    const u = matRef.current?.uniforms
    if (u?.uTime) u.uTime.value = clock.elapsedTime
  })

  return (
    <shaderMaterial
      key={materialKey}
      ref={matRef}
      vertexShader={VERTEX_SHADER}
      fragmentShader={FRAGMENT_SHADER}
      uniforms={uniforms}
      transparent={false}
    />
  )
}
