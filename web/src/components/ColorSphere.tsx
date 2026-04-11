import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'

/**
 * 3D preview of the extracted color (README: exhibition uses a sphere).
 *
 * - React Three Fiber maps React components to Three.js scene objects; declarative updates
 *   when `color` changes.
 * - meshStandardMaterial reacts to lights so the ball reads as a solid object, not a flat disk.
 * - OrbitControls: subtle drag to inspect (zoom disabled so kiosk/wall layouts stay predictable).
 * - Shared sphere geometry could be instanced later for many users; one sphere is fine for Phase 1.
 */

type SphereMeshProps = {
  color: string
}

function SphereMesh({ color }: SphereMeshProps) {
  return (
    <mesh rotation={[0.25, 0.5, 0]}>
      <sphereGeometry args={[1, 48, 48]} />
      <meshStandardMaterial
        color={color}
        roughness={0.38}
        metalness={0.12}
      />
    </mesh>
  )
}

export type ColorSphereProps = {
  /** Any CSS color string, e.g. #RRGGBB */
  color: string
  className?: string
}

export function ColorSphere({ color, className }: ColorSphereProps) {
  return (
    <div className={className} role="img" aria-label={`Color preview sphere, ${color}`}>
      <Canvas
        camera={{ position: [0, 0, 3.15], fov: 42 }}
        style={{ width: '100%', height: 'min(42vh, 320px)', touchAction: 'none' }}
        gl={{ antialias: true, alpha: false }}
      >
        <color attach="background" args={['#12121a']} />
        <ambientLight intensity={0.55} />
        <directionalLight position={[5, 6, 7]} intensity={1.15} />
        <directionalLight position={[-4, -2, -3]} intensity={0.35} />
        <SphereMesh color={color} />
        <OrbitControls enableZoom={false} enablePan={false} />
      </Canvas>
    </div>
  )
}
