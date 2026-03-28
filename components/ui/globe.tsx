"use client"
import { useEffect, useRef } from "react"
import createGlobe from "cobe"

export default function Globe({ className = "" }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pointerInteracting = useRef<number | null>(null)
  const pointerInteractionMovement = useRef(0)
  const phiRef = useRef(0)

  useEffect(() => {
    let phi = 0
    let width = 0

    const onResize = () => {
      if (canvasRef.current) width = canvasRef.current.offsetWidth
    }

    // ResizeObserver catches initial render sizing reliably
    const ro = new ResizeObserver(onResize)
    if (canvasRef.current) ro.observe(canvasRef.current)
    onResize()

    const globe = createGlobe(canvasRef.current!, {
      devicePixelRatio: 2,
      width: width * 2,
      height: width * 2,
      phi: 0,
      theta: 0.15,
      dark: 1,
      diffuse: 1.2,
      mapSamples: 24000,
      mapBrightness: 6,
      baseColor: [0.1, 0.1, 0.1],
      markerColor: [1, 1, 1],
      glowColor: [0.1, 0.1, 0.1],
      markers: [
        { location: [40.71, -74.01], size: 0.05 },
        { location: [51.51, -0.13], size: 0.04 },
        { location: [35.68, 139.65], size: 0.04 },
        { location: [22.31, 114.17], size: 0.03 },
        { location: [1.35, 103.82], size: 0.03 },
        { location: [48.85, 2.35], size: 0.03 },
        { location: [-33.87, 151.21], size: 0.03 },
        { location: [19.43, -99.13], size: 0.03 },
      ],
      onRender: (state: any) => {
        if (!pointerInteracting.current) phi += 0.001
        state.phi = phi + pointerInteractionMovement.current
        phiRef.current = state.phi
        state.width = width * 2
        state.height = width * 2
      },
    } as any)

    canvasRef.current!.style.opacity = "1"

    return () => {
      globe.destroy()
      ro.disconnect()
    }
  }, [])

  return (
    <div style={{ width: "100%", aspectRatio: "1 / 1", overflow: "hidden" }}>
      <canvas
        ref={canvasRef}
        onPointerDown={(e) => {
          pointerInteracting.current = e.clientX - pointerInteractionMovement.current * 200
          canvasRef.current!.style.cursor = "grabbing"
        }}
        onPointerUp={() => {
          pointerInteracting.current = null
          canvasRef.current!.style.cursor = "grab"
        }}
        onPointerOut={() => {
          pointerInteracting.current = null
          canvasRef.current!.style.cursor = "grab"
        }}
        onMouseMove={(e) => {
          if (pointerInteracting.current !== null) {
            const delta = e.clientX - pointerInteracting.current
            pointerInteractionMovement.current = delta / 200
          }
        }}
        style={{
          width: "100%",
          height: "100%",
          cursor: "grab",
          opacity: 0,
          transition: "opacity 1s ease",
        }}
        className={className}
      />
    </div>
  )
}
