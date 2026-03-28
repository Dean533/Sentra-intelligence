"use client"
import { useEffect, useRef, useState } from "react"
import * as d3 from "d3"

interface RotatingEarthProps {
  width?: number
  height?: number
  className?: string
}

export default function RotatingEarth({ width = 800, height = 600, className = "" }: RotatingEarthProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!canvasRef.current) return
    const canvas = canvasRef.current
    const context = canvas.getContext("2d")
    if (!context) return
    const containerWidth = Math.min(width, window.innerWidth - 40)
    const containerHeight = Math.min(height, window.innerHeight - 100)
    const radius = Math.min(containerWidth, containerHeight) / 2.5
    const dpr = window.devicePixelRatio || 1
    canvas.width = containerWidth * dpr
    canvas.height = containerHeight * dpr
    canvas.style.width = `${containerWidth}px`
    canvas.style.height = `${containerHeight}px`
    context.scale(dpr, dpr)
    const projection = d3.geoOrthographic().scale(radius).translate([containerWidth / 2, containerHeight / 2]).clipAngle(90)
    const path = d3.geoPath().projection(projection).context(context)
    const pointInPolygon = (point: [number, number], polygon: number[][]): boolean => {
      const [x, y] = point
      let inside = false
      for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const [xi, yi] = polygon[i]
        const [xj, yj] = polygon[j]
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
      }
      return inside
    }
    const pointInFeature = (point: [number, number], feature: any): boolean => {
      const geometry = feature.geometry
      if (geometry.type === "Polygon") {
        if (!pointInPolygon(point, geometry.coordinates[0])) return false
        for (let i = 1; i < geometry.coordinates.length; i++) if (pointInPolygon(point, geometry.coordinates[i])) return false
        return true
      } else if (geometry.type === "MultiPolygon") {
        for (const polygon of geometry.coordinates) {
          if (pointInPolygon(point, polygon[0])) {
            let inHole = false
            for (let i = 1; i < polygon.length; i++) if (pointInPolygon(point, polygon[i])) { inHole = true; break }
            if (!inHole) return true
          }
        }
        return false
      }
      return false
    }
    const generateDotsInPolygon = (feature: any, dotSpacing = 16) => {
      const dots: [number, number][] = []
      const bounds = d3.geoBounds(feature)
      const [[minLng, minLat], [maxLng, maxLat]] = bounds
      const stepSize = dotSpacing * 0.08
      for (let lng = minLng; lng <= maxLng; lng += stepSize)
        for (let lat = minLat; lat <= maxLat; lat += stepSize)
          if (pointInFeature([lng, lat], feature)) dots.push([lng, lat])
      return dots
    }
    const allDots: { lng: number; lat: number }[] = []
    let landFeatures: any
    const render = () => {
      context.clearRect(0, 0, containerWidth, containerHeight)
      const currentScale = projection.scale()
      const scaleFactor = currentScale / radius
      context.beginPath()
      context.arc(containerWidth / 2, containerHeight / 2, currentScale, 0, 2 * Math.PI)
      context.fillStyle = "#000000"
      context.fill()
      context.strokeStyle = "#333333"
      context.lineWidth = 1.5 * scaleFactor
      context.stroke()
      if (landFeatures) {
        const graticule = d3.geoGraticule()
        context.beginPath()
        path(graticule())
        context.strokeStyle = "#ffffff"
        context.lineWidth = 0.5 * scaleFactor
        context.globalAlpha = 0.08
        context.stroke()
        context.globalAlpha = 1
        allDots.forEach((dot) => {
          const projected = projection([dot.lng, dot.lat])
          if (projected && projected[0] >= 0 && projected[0] <= containerWidth && projected[1] >= 0 && projected[1] <= containerHeight) {
            context.beginPath()
            context.arc(projected[0], projected[1], 1.5 * scaleFactor, 0, 2 * Math.PI)
            context.fillStyle = "#ffffff"
            context.globalAlpha = 0.6
            context.fill()
            context.globalAlpha = 1
          }
        })
      }
    }
    const loadWorldData = async () => {
      try {
        setIsLoading(true)
        const response = await fetch("https://raw.githubusercontent.com/martynafford/natural-earth-geojson/refs/heads/master/110m/physical/ne_110m_land.json")
        if (!response.ok) throw new Error("Failed to load land data")
        landFeatures = await response.json()
        landFeatures.features.forEach((feature: any) => {
          generateDotsInPolygon(feature, 16).forEach(([lng, lat]) => allDots.push({ lng, lat }))
        })
        render()
        setIsLoading(false)
      } catch (err) {
        setError("Failed to load map data")
        setIsLoading(false)
      }
    }
    const rotation: [number, number] = [0, 0]
    let autoRotate = true
    const rotationTimer = d3.timer(() => { if (autoRotate) { rotation[0] += 0.3; projection.rotate(rotation); render() } })
    const handleMouseDown = (event: MouseEvent) => {
      autoRotate = false
      const startX = event.clientX, startY = event.clientY, startRotation: [number, number] = [rotation[0], rotation[1]]
      const handleMouseMove = (e: MouseEvent) => {
        rotation[0] = startRotation[0] + (e.clientX - startX) * 0.5
        rotation[1] = Math.max(-90, Math.min(90, startRotation[1] - (e.clientY - startY) * 0.5))
        projection.rotate(rotation); render()
      }
      const handleMouseUp = () => { document.removeEventListener("mousemove", handleMouseMove); document.removeEventListener("mouseup", handleMouseUp); setTimeout(() => { autoRotate = true }, 10) }
      document.addEventListener("mousemove", handleMouseMove)
      document.addEventListener("mouseup", handleMouseUp)
    }
    canvas.addEventListener("mousedown", handleMouseDown)
    loadWorldData()
    return () => { rotationTimer.stop(); canvas.removeEventListener("mousedown", handleMouseDown) }
  }, [width, height])

  return (
    <div className={`relative ${className}`}>
      <canvas ref={canvasRef} className="w-full h-auto" style={{ maxWidth: "100%" }} />
    </div>
  )
}
