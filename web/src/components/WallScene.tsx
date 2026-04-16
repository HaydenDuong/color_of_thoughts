import { useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import type { WallEntry } from '../lib/wallData'
import { placementFromParticipantId } from '../lib/placement'

type DriftingSphereProps = {
  entry: WallEntry
}

function DriftingSphere({ entry }: DriftingSphereProps) {
  const mesh = useRef<THREE.Mesh>(null)
  const placement = useMemo(
    () => placementFromParticipantId(entry.participantId),
    [entry.participantId],
  )
  const color = `rgb(${entry.r}, ${entry.g}, ${entry.b})`

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
    >
      <sphereGeometry args={[0.26, 32, 32]} />
      <meshStandardMaterial
        color={color}
        roughness={0.4}
        metalness={0.1}
      />
    </mesh>
  )
}

export type WallSceneProps = {
  entries: WallEntry[]
  className?: string
}

/**
 * Single canvas for many colored spheres (exhibition wall).
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
        <color attach="background" args={['#0c0c12']} />
        <ambientLight intensity={0.5} />
        <directionalLight position={[6, 8, 10]} intensity={1.05} />
        <directionalLight position={[-5, -3, -4]} intensity={0.35} />
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
