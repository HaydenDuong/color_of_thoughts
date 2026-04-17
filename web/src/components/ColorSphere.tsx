import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { PaletteSphereMaterial } from './PaletteSphereMaterial'
import type { PaletteColor } from '../lib/colorFromImage'

/**
 * 3D preview of the extracted color(s).
 *
 * - Cream canvas background (`#F5EFE6`) per supervisor request.
 * - If `palette` has multiple entries, the sphere is shaded by a custom GLSL
 *   that blends the top 5 weighted colors using domain-warped Perlin noise
 *   (marble-like flow), on top of MeshPhysicalMaterial for iridescent shine.
 * - Falls back to a plain colored sphere when no palette is supplied.
 */

type SphereMeshProps = {
  fallbackColor: string
  palette?: PaletteColor[]
  seed?: string
  animate?: boolean
}

function SphereMesh({ fallbackColor, palette, seed, animate }: SphereMeshProps) {
  const hasPalette = Boolean(palette && palette.length >= 2)

  return (
    <mesh rotation={[0.25, 0.5, 0]}>
      {/* Icosahedron with high detail (~40k triangles) — evenly distributed
          triangles so the latitude-twist from the shader doesn't pinch
          the poles the way SphereGeometry would. */}
      <icosahedronGeometry args={[1, 64]} />
      {hasPalette ? (
        <PaletteSphereMaterial
          palette={palette!}
          seed={seed ?? fallbackColor}
          animate={animate}
        />
      ) : (
        <meshPhysicalMaterial
          color={fallbackColor}
          roughness={0.38}
          metalness={0.0}
          clearcoat={0.35}
          clearcoatRoughness={0.3}
        />
      )}
    </mesh>
  )
}

export type ColorSphereProps = {
  /** Primary hex/RGB color — used when no palette is supplied. */
  color: string
  /** Optional palette for the shader-based marble rendering. */
  palette?: PaletteColor[]
  /** Stable seed (e.g. participant id) so the marble pattern does not reshuffle. */
  textureSeed?: string
  className?: string
}

export function ColorSphere({
  color,
  palette,
  textureSeed,
  className,
}: ColorSphereProps) {
  return (
    <div
      className={className}
      role="img"
      aria-label={`Color preview sphere, primary ${color}`}
    >
      <Canvas
        camera={{ position: [0, 0, 3.15], fov: 42 }}
        style={{ width: '100%', height: 'min(42vh, 320px)', touchAction: 'none' }}
        gl={{ antialias: true, alpha: false }}
      >
        <color attach="background" args={['#F5EFE6']} />
        <ambientLight intensity={0.75} />
        <directionalLight position={[5, 6, 7]} intensity={0.9} color="#fff6e8" />
        <directionalLight position={[-4, -2, -3]} intensity={0.3} color="#dfe6ff" />
        <SphereMesh
          fallbackColor={color}
          palette={palette}
          seed={textureSeed ?? color}
          animate
        />
        <OrbitControls enableZoom={false} enablePan={false} />
      </Canvas>
    </div>
  )
}
