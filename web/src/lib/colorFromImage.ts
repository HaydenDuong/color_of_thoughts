/**
 * Client-side dominant color extraction for Phase 1.
 *
 * Why canvas + getImageData: browsers give us raw RGBA pixels without extra libraries.
 * Why center crop: edges of a “paper” photo often hold shadows, fingers, or table—
 * averaging the middle reduces that noise vs using the whole frame.
 * Why downscale first: huge phone photos are slow to read pixel-by-pixel; we only need
 * enough resolution to estimate a paper color.
 * Why luminance variance → uniformityScore: if the crop is one flat color, variance is
 * low (high score); mixed shadow + paper raises variance (lower score)—useful later for
 * “try again with more even light” without blocking the user.
 */

export type DominantColorResult = {
  r: number
  g: number
  b: number
  /** CSS hex, e.g. #a4c639 */
  hex: string
  /**
   * 0–1, higher = more uniform crop (lower spread in brightness across pixels).
   * Heuristic only—not a scientific measure of “paper quality.”
   */
  uniformityScore: number
}

const MAX_DIMENSION = 512
/** Use the middle fraction of width/height so we mostly sample the paper, not borders. */
const CENTER_FRACTION = 0.62

function rgbToHex(r: number, g: number, b: number): string {
  return (
    '#' +
    [r, g, b]
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  )
}

/**
 * Loads a File as an HTMLImageElement (decode in the browser’s image pipeline).
 */
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
 * Draws the image onto a small canvas, samples the center crop, averages RGB,
 * and estimates uniformity from luminance spread.
 */
export function extractDominantColor(image: HTMLImageElement): DominantColorResult {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) {
    throw new Error('Canvas 2D context is not available')
  }

  let { width: iw, height: ih } = image
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

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!
    const g = data[i + 1]!
    const b = data[i + 2]!
    const a = data[i + 3]!
    if (a < 8) continue
    sumR += r
    sumG += g
    sumB += b
    n++
    // Rec. 709 luma — single number per pixel for spread
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b
    luminances.push(y)
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
  // Map typical std (0 ~ 80+) into 0–1; clamp so UI stays stable
  const uniformityScore = Math.max(0, Math.min(1, 1 - std / 72))

  return {
    r,
    g,
    b,
    hex: rgbToHex(r, g, b),
    uniformityScore,
  }
}
