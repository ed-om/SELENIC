import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { Focus, RotateCcw } from 'lucide-react'
import type { Site } from './types'

type Props = {
  sites: Site[]
}

function seededRandom(seed: number) {
  let value = seed >>> 0
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0
    return value / 4294967296
  }
}

/** A monochrome, procedural lunar reference texture. It is intentionally labelled as illustrative,
 * not a replacement for a LOLA DEM or a georeferenced LRO basemap. */
function createLunarTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 2048
  canvas.height = 1024
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas 2D is not available')

  const image = context.createImageData(canvas.width, canvas.height)
  const random = seededRandom(89_221)
  for (let y = 0; y < canvas.height; y += 1) {
    const latitudeBand = Math.sin((y / canvas.height) * Math.PI * 9) * 5
    for (let x = 0; x < canvas.width; x += 1) {
      const i = (y * canvas.width + x) * 4
      const broad = Math.sin(x * 0.014) * 4 + Math.cos(y * 0.021) * 5
      const grain = (random() - 0.5) * 19
      const value = Math.max(76, Math.min(205, 145 + latitudeBand + broad + grain))
      image.data[i] = value
      image.data[i + 1] = value
      image.data[i + 2] = value
      image.data[i + 3] = 255
    }
  }
  context.putImageData(image, 0, 0)

  // Add crater bowls, rims and ejecta in an equirectangular layout.
  for (let i = 0; i < 520; i += 1) {
    const x = random() * canvas.width
    const y = random() * canvas.height
    const radius = 2 + Math.pow(random(), 2.5) * 26
    const crater = context.createRadialGradient(
      x - radius * 0.22,
      y - radius * 0.24,
      radius * 0.08,
      x,
      y,
      radius,
    )
    crater.addColorStop(0, 'rgba(30,30,30,.62)')
    crater.addColorStop(0.52, 'rgba(70,70,70,.25)')
    crater.addColorStop(0.78, 'rgba(225,225,225,.28)')
    crater.addColorStop(1, 'rgba(38,38,38,0)')
    context.fillStyle = crater
    context.beginPath()
    context.ellipse(x, y, radius * (0.82 + random() * 0.35), radius * (0.66 + random() * 0.3), random() * 0.5, 0, Math.PI * 2)
    context.fill()
  }

  // Quiet coordinate graticule for orientation; it is not a cartographic basemap.
  context.strokeStyle = 'rgba(20,20,20,.17)'
  context.lineWidth = 1
  for (let x = 0; x <= canvas.width; x += canvas.width / 12) {
    context.beginPath(); context.moveTo(x, 0); context.lineTo(x, canvas.height); context.stroke()
  }
  for (let y = 0; y <= canvas.height; y += canvas.height / 6) {
    context.beginPath(); context.moveTo(0, y); context.lineTo(canvas.width, y); context.stroke()
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  return texture
}


/** Load the official NASA/JPL Solar System Treks global LRO WAC mosaic tiles.
 * This is image texture data, not a LOLA elevation model; it improves visual
 * fidelity but does not displace the sphere geometry. */
async function loadMoonTrekWacTexture(): Promise<THREE.Texture> {
  const roots = [
    'https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/default/default028mm',
    'https://moontrek.jpl.nasa.gov/trektiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/default/default028mm',
  ]

  const loadImage = (url: string) => new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`NASA Moon Trek tile unavailable: ${url}`))
    image.src = url
  })

  const loadLevel = async (root: string, level: number) => {
    const columns = 2 ** (level + 1)
    const rows = 2 ** level
    const requests: Promise<HTMLImageElement>[] = []
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        requests.push(loadImage(`${root}/${level}/${row}/${column}.jpg`))
      }
    }
    const tiles = await Promise.all(requests)
    const tileWidth = tiles[0].naturalWidth
    const tileHeight = tiles[0].naturalHeight
    if (!tileWidth || !tileHeight || tiles.some(tile => tile.naturalWidth !== tileWidth || tile.naturalHeight !== tileHeight)) {
      throw new Error('NASA Moon Trek tiles have inconsistent dimensions.')
    }
    const canvas = document.createElement('canvas')
    canvas.width = tileWidth * columns
    canvas.height = tileHeight * rows
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas 2D is not available for lunar imagery.')
    tiles.forEach((tile, index) => {
      const row = Math.floor(index / columns)
      const column = index % columns
      context.drawImage(tile, column * tileWidth, row * tileHeight, tileWidth, tileHeight)
    })
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.wrapS = THREE.RepeatWrapping
    // Moon Trek's global equirectangular tiles begin at 180°W; the globe's
    // marker convention places 0° longitude at the center of the texture.
    texture.offset.x = 0.5
    texture.anisotropy = 8
    texture.needsUpdate = true
    return texture
  }

  let lastError: unknown
  for (const root of roots) {
    try { return await loadLevel(root, 1) } catch (error) { lastError = error }
    try { return await loadLevel(root, 0) } catch (error) { lastError = error }
  }
  throw lastError instanceof Error ? lastError : new Error('NASA Moon Trek imagery could not be loaded.')
}

function ExternalLinkIconFallback() { return <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9 2h5v5M14 2 7 9"/><path d="M12 9v4a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h4"/></svg> }

function latLonVector(site: Site, radius: number) {
  const latitude = THREE.MathUtils.degToRad(site.latitude_deg)
  const longitude = THREE.MathUtils.degToRad(site.longitude_east_deg)
  // Match Three.js SphereGeometry's equirectangular longitude convention.
  return new THREE.Vector3(
    -Math.cos(longitude) * Math.cos(latitude),
    Math.sin(latitude),
    Math.sin(longitude) * Math.cos(latitude),
  ).normalize().multiplyScalar(radius)
}

function makeSiteLabel(letter: string) {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 112
  const context = canvas.getContext('2d')!
  context.fillStyle = 'rgba(18,18,18,.94)'
  context.fillRect(1, 1, 254, 110)
  context.strokeStyle = 'rgba(245,245,245,.8)'
  context.lineWidth = 3
  context.strokeRect(2, 2, 252, 108)
  context.fillStyle = '#f5f5f5'
  context.font = '600 58px Arial, sans-serif'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(`SITE ${letter}`, 128, 56)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }))
  sprite.scale.set(0.25, 0.11, 1)
  return sprite
}

export default function MoonGlobe({ sites }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const siteVectorsRef = useRef<THREE.Vector3[]>([])
  const [webglError, setWebglError] = useState(false)
  const [textureSource, setTextureSource] = useState<'loading' | 'nasa' | 'fallback'>('loading')
  const [focused, setFocused] = useState<'A' | 'B' | 'ALL'>('ALL')

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' })
    } catch {
      setWebglError(true)
      return
    }

    setWebglError(false)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.setClearColor(0x080808, 0)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100)
    camera.position.set(0.1, -2.9, 2.35)

    const moonGroup = new THREE.Group()
    scene.add(moonGroup)
    const fallbackTexture = createLunarTexture()
    const moonMaterial = new THREE.MeshStandardMaterial({
      map: fallbackTexture,
      roughness: 1,
      metalness: 0,
    })
    let nasaTexture: THREE.Texture | null = null
    let disposed = false
    setTextureSource('loading')
    loadMoonTrekWacTexture().then(texture => {
      if (disposed) { texture.dispose(); return }
      nasaTexture = texture
      moonMaterial.map = texture
      moonMaterial.bumpMap = null
      moonMaterial.needsUpdate = true
      setTextureSource('nasa')
    }).catch(() => {
      if (!disposed) setTextureSource('fallback')
    })
    const moon = new THREE.Mesh(new THREE.SphereGeometry(1.12, 128, 96), moonMaterial)
    moonGroup.add(moon)

    // Subtle longitude/latitude guide rings, kept low contrast so the Moon remains the focus.
    const gridMaterial = new THREE.LineBasicMaterial({ color: 0x8d8d8d, transparent: true, opacity: 0.14 })
    for (let latitude = -60; latitude <= 60; latitude += 30) {
      const radius = 1.123 * Math.cos(THREE.MathUtils.degToRad(latitude))
      const y = 1.123 * Math.sin(THREE.MathUtils.degToRad(latitude))
      const points: THREE.Vector3[] = []
      for (let j = 0; j <= 160; j += 1) {
        const angle = (j / 160) * Math.PI * 2
        points.push(new THREE.Vector3(-Math.cos(angle) * radius, y, Math.sin(angle) * radius))
      }
      moonGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), gridMaterial))
    }
    for (let longitude = 0; longitude < 180; longitude += 30) {
      const angle = THREE.MathUtils.degToRad(longitude)
      const points: THREE.Vector3[] = []
      for (let j = 0; j <= 100; j += 1) {
        const latitude = THREE.MathUtils.degToRad(-90 + (j / 100) * 180)
        points.push(new THREE.Vector3(
          -Math.cos(angle) * Math.cos(latitude) * 1.124,
          Math.sin(latitude) * 1.124,
          Math.sin(angle) * Math.cos(latitude) * 1.124,
        ))
      }
      moonGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), gridMaterial))
    }

    const markerMeshes: THREE.Mesh[] = []
    const siteVectors = sites.map((site) => latLonVector(site, 1.145))
    siteVectorsRef.current = siteVectors
    sites.forEach((site, index) => {
      const letter = index === 0 ? 'A' : 'B'
      const markerGroup = new THREE.Group()
      const direction = siteVectors[index].clone().normalize()
      markerGroup.position.copy(siteVectors[index])
      markerGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction)
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(index === 0 ? 0.035 : 0.042, 0.006, 8, 36),
        new THREE.MeshBasicMaterial({ color: index === 0 ? 0xffffff : 0x7d7d7d, transparent: true, opacity: 0.98 }),
      )
      const pin = new THREE.Mesh(
        new THREE.SphereGeometry(0.018, 16, 12),
        new THREE.MeshBasicMaterial({ color: index === 0 ? 0xffffff : 0x777777 }),
      )
      markerGroup.add(ring, pin)
      const tangent = new THREE.Vector3(0, 0, 1).cross(direction).normalize()
      if (tangent.lengthSq() < 0.001) tangent.set(1, 0, 0)
      const labelOffset = index === 0 ? 0.14 : -0.14
      const labelPosition = siteVectors[index].clone().add(tangent.multiplyScalar(labelOffset)).add(new THREE.Vector3(0, index === 0 ? 0.075 : -0.075, 0))
      const connector = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([siteVectors[index].clone(), labelPosition.clone()]),
        new THREE.LineBasicMaterial({ color: index === 0 ? 0xffffff : 0x999999, transparent: true, opacity: 0.75 }),
      )
      moonGroup.add(connector)
      const label = makeSiteLabel(letter)
      label.position.copy(labelPosition)
      moonGroup.add(markerGroup, label)
      markerMeshes.push(pin)
    })

    scene.add(new THREE.AmbientLight(0xffffff, 1.05))
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.15)
    keyLight.position.set(3.5, -1.8, 4.6)
    scene.add(keyLight)
    const fillLight = new THREE.DirectionalLight(0x777777, 0.42)
    fillLight.position.set(-4, 2, -2)
    scene.add(fillLight)

    // Fine star field; deliberately monochrome and restrained.
    const starPositions: number[] = []
    const random = seededRandom(2411)
    for (let i = 0; i < 520; i += 1) {
      const radius = 5 + random() * 12
      const theta = random() * Math.PI * 2
      const phi = Math.acos(2 * random() - 1)
      starPositions.push(
        radius * Math.sin(phi) * Math.cos(theta),
        radius * Math.cos(phi),
        radius * Math.sin(phi) * Math.sin(theta),
      )
    }
    const starsGeometry = new THREE.BufferGeometry()
    starsGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3))
    const stars = new THREE.Points(starsGeometry, new THREE.PointsMaterial({ color: 0xd8d8d8, size: 0.022, transparent: true, opacity: 0.7 }))
    scene.add(stars)

    const controls = new OrbitControls(camera, renderer.domElement)
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    controls.enableDamping = true
    controls.dampingFactor = 0.055
    controls.enablePan = false
    controls.minDistance = 1.9
    controls.maxDistance = 5.8
    controls.autoRotate = !reducedMotion
    controls.autoRotateSpeed = 0.22
    controls.target.set(0, -0.72, 0)
    controls.update()
    controlsRef.current = controls

    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    let pointerStart: { x: number; y: number } | null = null
    const onPointerDown = (event: PointerEvent) => {
      pointerStart = { x: event.clientX, y: event.clientY }
      controls.autoRotate = false
    }
    const onPointerUp = (event: PointerEvent) => {
      if (!pointerStart || Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 5) return
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
      raycaster.setFromCamera(pointer, camera)
      const hits = raycaster.intersectObjects(markerMeshes, false)
      if (hits.length) {
        const selectedIndex = markerMeshes.indexOf(hits[0].object as THREE.Mesh)
        const selected = siteVectors[selectedIndex]
        controls.autoRotate = false
        controls.target.copy(selected.clone().multiplyScalar(0.72))
        controls.update()
        setFocused(selectedIndex === 0 ? 'A' : 'B')
      }
      pointerStart = null
    }
    renderer.domElement.addEventListener('pointerdown', onPointerDown)
    renderer.domElement.addEventListener('pointerup', onPointerUp)

    let animationId = 0
    const render = () => {
      animationId = window.requestAnimationFrame(render)
      controls.update()
      renderer.render(scene, camera)
    }
    render()

    const resizeObserver = new ResizeObserver(() => {
      const bounds = canvas.getBoundingClientRect()
      const width = Math.max(1, bounds.width)
      const height = Math.max(1, bounds.height)
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    })
    resizeObserver.observe(canvas.parentElement ?? canvas)
    const initialBounds = canvas.getBoundingClientRect()
    renderer.setSize(Math.max(1, initialBounds.width), Math.max(1, initialBounds.height), false)
    camera.aspect = Math.max(1, initialBounds.width) / Math.max(1, initialBounds.height)
    camera.updateProjectionMatrix()

    return () => {
      window.cancelAnimationFrame(animationId)
      resizeObserver.disconnect()
      renderer.domElement.removeEventListener('pointerdown', onPointerDown)
      renderer.domElement.removeEventListener('pointerup', onPointerUp)
      controls.dispose()
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points) {
          object.geometry.dispose()
          const material = object.material
          if (Array.isArray(material)) material.forEach((item) => item.dispose())
          else material.dispose()
        }
      })
      disposed = true
      fallbackTexture.dispose()
      nasaTexture?.dispose()
      renderer.dispose()
      controlsRef.current = null
    }
  }, [sites.map((site) => `${site.latitude_deg}:${site.longitude_east_deg}`).join('|')])

  const focusSite = (site: 'A' | 'B') => {
    const controls = controlsRef.current
    const vector = siteVectorsRef.current[site === 'A' ? 0 : 1]
    if (!controls || !vector) return
    controls.autoRotate = false
    controls.target.copy(vector.clone().multiplyScalar(0.72))
    controls.update()
    setFocused(site)
  }

  const resetView = () => {
    const controls = controlsRef.current
    if (!controls) return
    controls.target.set(0, -0.72, 0)
    controls.object.position.set(0.1, -2.9, 2.35)
    controls.autoRotate = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    controls.update()
    setFocused('ALL')
  }

  return (
    <div className="moon-globe-shell">
      <div className="moon-globe-stage">
        <canvas ref={canvasRef} className="moon-globe-canvas" tabIndex={0} aria-label="Interactive three-dimensional lunar globe with candidate landing-site markers" />
        {webglError && (
          <div className="globe-fallback">
            <strong>3D rendering is unavailable in this browser.</strong>
            <span>Enable WebGL or use a modern browser to explore the lunar globe.</span>
          </div>
        )}
        <div className="globe-caption globe-caption-top"><span>MOON / SOUTH POLAR VIEW</span><span>ROTATE · SCROLL TO ZOOM</span></div>
        <div className="globe-caption globe-caption-bottom"><span>{textureSource === 'nasa' ? 'LRO WAC MOSAIC · NASA/JPL' : textureSource === 'loading' ? 'LOADING NASA LUNAR IMAGERY' : 'LOCAL REFERENCE TEXTURE · OFFLINE'}</span><span>IMAGE TEXTURE · NOT ELEVATION RELIEF</span></div>
      </div>
      <div className="globe-controls-row">
        <div className="globe-site-controls">
          <button className={`globe-site-button ${focused === 'A' ? 'active' : ''}`} onClick={() => focusSite('A')}><span className="site-pin pin-a">A</span> Focus site A</button>
          <button className={`globe-site-button ${focused === 'B' ? 'active' : ''}`} onClick={() => focusSite('B')}><span className="site-pin pin-b">B</span> Focus site B</button>
        </div>
        <button className="globe-reset-button" onClick={resetView}><RotateCcw size={13}/> Reset view</button>
      </div>
      <div className="moon-trek-source-row"><span>{textureSource === 'nasa' ? 'Surface imagery: NASA LRO WAC global mosaic' : 'NASA Moon Trek imagery may be unavailable offline'}</span><a href="https://trek.nasa.gov/moon/" target="_blank" rel="noreferrer">Open full Moon Trek viewer <ExternalLinkIconFallback/></a></div>
      <div className="globe-site-readout">
        {sites.map((site, index) => (
          <div className="globe-site-readout-item" key={site.id}>
            <span className={`globe-readout-dot ${index === 0 ? 'readout-a' : 'readout-b'}`}>{index === 0 ? 'A' : 'B'}</span>
            <div><strong>{site.name}</strong><small>{Math.abs(site.latitude_deg).toFixed(2)}° {site.latitude_deg < 0 ? 'S' : 'N'} · {site.longitude_east_deg.toFixed(2)}° E</small></div>
          </div>
        ))}
        <div className="globe-readout-note"><Focus size={13}/> Candidate sites are close together near the pole; labels are offset for readability.</div>
      </div>
    </div>
  )
}
