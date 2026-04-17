/**
 * Client-side color extraction for Phase 1.
 *
 * Returns both:
 *  - `r/g/b/hex` — averaged "primary" color (kept for DB columns, accessibility text).
 *  - `palette`  — up to N clustered colors (k-means) with weights (fraction of pixels),
 *                 so the sphere can show the image's actual color composition
 *                 (e.g. rainbow crayon image → orange + green + blue + red + yellow).
 *
 * Near-white pixels are filtered before clustering so paper background does not dominate.
 */

export type PaletteColor = {
  r: number
  g: number
  b: number
  hex: string
  /** 0–1, share of accepted pixels in this cluster */
  weight: number
}

export type DominantColorResult = {
  r: number
  g: number
  b: number
  /** CSS hex of the averaged color, e.g. #a4c639 */
  hex: string
  /**
   * 0–1, higher = more uniform crop (lower spread in brightness across pixels).
   * Heuristic only—not a scientific measure of “paper quality.”
   */
  uniformityScore: number
  /** Up to `PALETTE_SIZE` colors sorted by weight descending. */
  palette: PaletteColor[]
}

/** Max edge length of the working canvas; bigger = slower, not much more accurate. */
const MAX_DIMENSION = 512
/** Use the middle fraction of width/height so we mostly sample the paper, not borders. */
const CENTER_FRACTION = 0.62
/** Number of k-means clusters (≈ a small crayon box). */
const PALETTE_SIZE = 8
/** K-means iterations; 8 is enough for 512×512 images and stays fast. */
const KMEANS_ITERATIONS = 8
/** Stride when sampling pixels into k-means (1 = every pixel; higher = faster). */
const KMEANS_STRIDE = 2
/** Drop clusters whose weight is tiny — they add noise to the UI. */
const MIN_PALETTE_WEIGHT = 0.025

function rgbToHex(r: number, g: number, b: number): string {
  return (
    '#' +
    [r, g, b]
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  )
}

/** Loads a File as an HTMLImageElement (decoded by the browser's image pipeline). */
export function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not decode image'))
    }
    img.src = url
  })
}

/**
 * Is this pixel "near-white paper"?
 * Uses HSL-ish lightness + saturation thresholds: very bright + very unsaturated.
 */
function isNearWhite(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const lightness = (max + min) / 2
  const chroma = max - min
  return lightness > 232 && chroma < 18
}

type Cluster = {
  r: number
  g: number
  b: number
  count: number
}

/**
 * Simple k-means in RGB.
 * - Initial centers: spread across the sample using evenly-spaced indices
 *   (deterministic and good enough for N=8).
 * - Distance: squared Euclidean in RGB. LAB would be perceptually better but adds cost.
 */
function kmeansRgb(
  pixels: Uint8ClampedArray,
  sampleIndices: number[],
  k: number,
): Cluster[] {
  if (sampleIndices.length === 0) return []

  const centers: Cluster[] = []
  for (let i = 0; i < k; i++) {
    const idx = sampleIndices[Math.floor((i * sampleIndices.length) / k)]!
    centers.push({
      r: pixels[idx]!,
      g: pixels[idx + 1]!,
      b: pixels[idx + 2]!,
      count: 0,
    })
  }

  for (let iter = 0; iter < KMEANS_ITERATIONS; iter++) {
    const sums = centers.map(() => ({ r: 0, g: 0, b: 0, count: 0 }))
    for (const idx of sampleIndices) {
      const r = pixels[idx]!
      const g = pixels[idx + 1]!
      const b = pixels[idx + 2]!

      let bestK = 0
      let bestD = Infinity
      for (let c = 0; c < centers.length; c++) {
        const center = centers[c]!
        const dr = center.r - r
        const dg = center.g - g
        const db = center.b - b
        const d = dr * dr + dg * dg + db * db
        if (d < bestD) {
          bestD = d
          bestK = c
        }
      }
      const s = sums[bestK]!
      s.r += r
      s.g += g
      s.b += b
      s.count++
    }

    for (let c = 0; c < centers.length; c++) {
      const s = sums[c]!
      if (s.count > 0) {
        centers[c] = {
          r: s.r / s.count,
          g: s.g / s.count,
          b: s.b / s.count,
          count: s.count,
        }
      } else {
        centers[c] = { ...centers[c]!, count: 0 }
      }
    }
  }

  return centers
}

/**
 * Draws the image onto a small canvas, samples the center crop, and returns
 * both an averaged dominant color and a k-means palette.
 */
export function extractDominantColor(image: HTMLImageElement): DominantColorResult {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) {
    throw new Error('Canvas 2D context is not available')
  }

  const { width: iw, height: ih } = image
  if (iw < 1 || ih < 1) {
    throw new Error('Image has no dimensions')
  }

  const scale = Math.min(1, MAX_DIMENSION / Math.max(iw, ih))
  const dw = Math.max(1, Math.round(iw * scale))
  const dh = Math.max(1, Math.round(ih * scale))

  canvas.width = dw
  canvas.height = dh
  ctx.drawImage(image, 0, 0, dw, dh)

  const marginX = (dw * (1 - CENTER_FRACTION)) / 2
  const marginY = (dh * (1 - CENTER_FRACTION)) / 2
  const cw = Math.floor(dw * CENTER_FRACTION)
  const ch = Math.floor(dh * CENTER_FRACTION)
  const x0 = Math.floor(marginX)
  const y0 = Math.floor(marginY)

  const imageData = ctx.getImageData(x0, y0, cw, ch)
  const data = imageData.data

  let sumR = 0
  let sumG = 0
  let sumB = 0
  let n = 0
  const luminances: number[] = []
  /** Indices (into `data`) of pixels that survived near-white filtering — used for k-means. */
  const keptIndices: number[] = []

  for (let i = 0; i < data.length; i += 4 * KMEANS_STRIDE) {
    const r = data[i]!
    const g = data[i + 1]!
    const b = data[i + 2]!
    const a = data[i + 3]!
    if (a < 8) continue

    sumR += r
    sumG += g
    sumB += b
    n++
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b
    luminances.push(y)

    if (!isNearWhite(r, g, b)) {
      keptIndices.push(i)
    }
  }

  if (n === 0) {
    throw new Error('No opaque pixels in sampled region')
  }

  const r = Math.round(sumR / n)
  const g = Math.round(sumG / n)
  const b = Math.round(sumB / n)

  const meanL =
    luminances.reduce((acc, v) => acc + v, 0) / luminances.length
  const variance =
    luminances.reduce((acc, v) => acc + (v - meanL) ** 2, 0) /
    luminances.length
  const std = Math.sqrt(variance)
  const uniformityScore = Math.max(0, Math.min(1, 1 - std / 72))

  // If the image is almost entirely white (nothing left after filter), fall back
  // to the averaged color as a single-entry palette.
  const indicesForKmeans =
    keptIndices.length >= PALETTE_SIZE
      ? keptIndices
      : keptIndices.length > 0
        ? keptIndices
        : []

  let palette: PaletteColor[]
  if (indicesForKmeans.length === 0) {
    palette = [{ r, g, b, hex: rgbToHex(r, g, b), weight: 1 }]
  } else {
    const clusters = kmeansRgb(data, indicesForKmeans, PALETTE_SIZE)
    const totalCount = clusters.reduce((acc, c) => acc + c.count, 0)
    palette = clusters
      .filter((c) => c.count > 0)
      .map((c) => ({
        r: Math.round(c.r),
        g: Math.round(c.g),
        b: Math.round(c.b),
        hex: rgbToHex(Math.round(c.r), Math.round(c.g), Math.round(c.b)),
        weight: totalCount > 0 ? c.count / totalCount : 0,
      }))
      .filter((p) => p.weight >= MIN_PALETTE_WEIGHT)
      .sort((a, b) => b.weight - a.weight)

    // Renormalize weights after filtering so swatches reflect visible proportions.
    const kept = palette.reduce((acc, p) => acc + p.weight, 0)
    if (kept > 0) {
      palette = palette.map((p) => ({ ...p, weight: p.weight / kept }))
    }
    if (palette.length === 0) {
      palette = [{ r, g, b, hex: rgbToHex(r, g, b), weight: 1 }]
    }
  }

  return {
    r,
    g,
    b,
    hex: rgbToHex(r, g, b),
    uniformityScore,
    palette,
  }
}
