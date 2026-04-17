import { useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import type { WallEntry } from '../lib/wallData'
import { placementFromParticipantId } from '../lib/placement'
import { PaletteSphereMaterial } from './PaletteSphereMaterial'

type DriftingSphereProps = {
  entry: WallEntry
}

function DriftingSphere({ entry }: DriftingSphereProps) {
  const mesh = useRef<THREE.Mesh>(null)
  const placement = useMemo(
    () => placementFromParticipantId(entry.participantId),
    [entry.participantId],
  )

  const hasPalette = entry.palette && entry.palette.length >= 2
  const fallback = `rgb(${entry.r}, ${entry.g}, ${entry.b})`

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    const ox = Math.sin(t * 0.28 + placement.phase) * 0.12
    const oy = Math.cos(t * 0.22 + placement.phase2) * 0.1
    if (mesh.current) {
      mesh.current.position.set(
        placement.baseX + ox,
        placement.baseY + oy,
        placement.baseZ,
      )
    }
  })

  return (
    <mesh
      ref={mesh}
      position={[placement.baseX, placement.baseY, placement.baseZ]}
      scale={0.32}
    >
      {/* Unit Icosahedron — even triangulation so the shader's latitude
          twist reads cleanly. Lower detail than the preview since wall
          spheres are small on screen. Actual size comes from `scale`. */}
      <icosahedronGeometry args={[1, 24]} />
      {hasPalette ? (
        <PaletteSphereMaterial
          palette={entry.palette}
          seed={entry.participantId}
          animate
        />
      ) : (
        <meshPhysicalMaterial
          color={fallback}
          roughness={0.4}
          metalness={0.0}
          clearcoat={0.3}
          clearcoatRoughness={0.3}
        />
      )}
    </mesh>
  )
}

export type WallSceneProps = {
  entries: WallEntry[]
  className?: string
}

/**
 * Single canvas for many marble spheres (exhibition wall).
 * Shared lights; each mesh drifts slowly from a hash-based anchor.
 */
export function WallScene({ entries, className }: WallSceneProps) {
  return (
    <div className={className} role="img" aria-label="Exhibition wall of color spheres">
      <Canvas
        camera={{ position: [0, 0, 5.8], fov: 45 }}
        style={{ width: '100%', height: 'min(72vh, 640px)', touchAction: 'none' }}
        gl={{ antialias: true, alpha: false }}
      >
        <color attach="background" args={['#F5EFE6']} />
        <ambientLight intensity={0.75} />
        <directionalLight position={[6, 8, 10]} intensity={0.9} color="#fff6e8" />
        <directionalLight position={[-5, -3, -4]} intensity={0.3} color="#dfe6ff" />
        {entries.map((e) => (
          <DriftingSphere key={e.participantId} entry={e} />
        ))}
        <OrbitControls
          enablePan
          minDistance={3}
          maxDistance={12}
          maxPolarAngle={Math.PI / 1.9}
        />
      </Canvas>
    </div>
  )
}
