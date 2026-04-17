// Copyright (c) 2022 8th Wall, Inc.
//
// app.js is the main entry point for your 8th Wall app. Code here will execute after head.html
// is loaded, and before body.html is loaded.

import './index.css'

// Register custom A-Frame components in app.js before the scene in body.html has loaded.
import {tapPlaceComponent} from './tap-place'
AFRAME.registerComponent('tap-place', tapPlaceComponent)

// Real-time Occlusion: enables depth-sensing for automatic environment-based occlusion
AFRAME.registerComponent('xrextras-realtime-occlusion', {
  init() {
    const scene = this.el.sceneEl || this.el
    const setupOcclusion = () => {
      if (window.XR8) {
        XR8.XrController.configure({enableDepth: true})
      }
    }
    if (scene.hasLoaded) {
      scene.addEventListener('realityready', setupOcclusion)
    } else {
      scene.addEventListener('loaded', () => {
        scene.addEventListener('realityready', setupOcclusion)
      })
    }
  },
})

// ══════════════════════════════════════════════════════════════
//  PREMIUM MATERIALS — HDR environment + material enhancement
// ══════════════════════════════════════════════════════════════
//
// Generates a high-quality environment map for reflections using
// PMREMGenerator (built into THREE.js). Parses the .hdr file
// manually to avoid the missing RGBELoader dependency.
// Then enhances all PBR materials on loaded models.

// ── Minimal RGBE / Radiance HDR parser ────────────────────────
function parseHDR(buffer) {
  const bytes = new Uint8Array(buffer)
  let offset = 0

  // Skip header lines until empty line
  function readLine() {
    let line = ''
    while (offset < bytes.length) {
      const ch = bytes[offset++]
      if (ch === 10) break // \n
      if (ch !== 13) line += String.fromCharCode(ch) // skip \r
    }
    return line
  }

  let width = 0, height = 0
  while (offset < bytes.length) {
    const line = readLine()
    if (line.length === 0) break
  }

  // Resolution line: -Y <h> +X <w>
  const resLine = readLine()
  const match = resLine.match(/-Y\s+(\d+)\s+\+X\s+(\d+)/)
  if (!match) throw new Error('Invalid HDR resolution line: ' + resLine)
  height = parseInt(match[1])
  width  = parseInt(match[2])

  const data = new Float32Array(width * height * 4)

  // Decode scanlines (adaptive RLE or uncompressed)
  for (let y = 0; y < height; y++) {
    const rowStart = y * width * 4

    // Check for new-style adaptive RLE
    if (bytes[offset] === 2 && bytes[offset + 1] === 2) {
      const scanWidth = (bytes[offset + 2] << 8) | bytes[offset + 3]
      offset += 4

      if (scanWidth !== width) throw new Error('Scanline width mismatch')

      // Read each of the 4 channels (R, G, B, E) with RLE
      const scanline = new Uint8Array(width * 4)
      for (let ch = 0; ch < 4; ch++) {
        let ptr = ch
        let count = 0
        while (count < width) {
          const code = bytes[offset++]
          if (code > 128) {
            // Run
            const runLen = code - 128
            const val = bytes[offset++]
            for (let i = 0; i < runLen; i++) {
              scanline[ptr] = val
              ptr += 4
              count++
            }
          } else {
            // Literal
            for (let i = 0; i < code; i++) {
              scanline[ptr] = bytes[offset++]
              ptr += 4
              count++
            }
          }
        }
      }

      // Convert RGBE to float
      for (let x = 0; x < width; x++) {
        const si = x * 4
        const di = rowStart + x * 4
        const e = scanline[si + 3]
        if (e === 0) {
          data[di] = data[di + 1] = data[di + 2] = 0
        } else {
          const scale = Math.pow(2, e - 128 - 8)
          data[di]     = scanline[si]     * scale
          data[di + 1] = scanline[si + 1] * scale
          data[di + 2] = scanline[si + 2] * scale
        }
        data[di + 3] = 1.0
      }
    } else {
      // Uncompressed or old-style RLE — read raw RGBE pixels
      for (let x = 0; x < width; x++) {
        const di = rowStart + x * 4
        const r = bytes[offset++]
        const g = bytes[offset++]
        const b = bytes[offset++]
        const e = bytes[offset++]
        if (e === 0) {
          data[di] = data[di + 1] = data[di + 2] = 0
        } else {
          const scale = Math.pow(2, e - 128 - 8)
          data[di]     = r * scale
          data[di + 1] = g * scale
          data[di + 2] = b * scale
        }
        data[di + 3] = 1.0
      }
    }
  }

  return { data, width, height }
}

AFRAME.registerComponent('premium-materials', {
  schema: {
    hdr:      {type: 'string', default: ''},
    exposure: {type: 'number', default: 1.2},
  },

  init() {
    this._envMap = null

    // Configure renderer for premium look
    const renderer = this.el.sceneEl.renderer
    if (renderer) {
      renderer.toneMapping = THREE.ACESFilmicToneMapping
      renderer.toneMappingExposure = this.data.exposure
      renderer.physicallyCorrectLights = true
    }

    // Load HDR and generate environment map
    if (this.data.hdr) {
      this._loadHDR(this.data.hdr)
    } else {
      // Fallback: generate a procedural environment
      this._generateProceduralEnv()
    }

    // Listen for any model-loaded events to enhance materials
    this.el.sceneEl.addEventListener('model-loaded', (e) => {
      this._enhanceMaterials(e.detail.model || e.target.getObject3D('mesh'))
    })
  },

  _loadHDR(url) {
    fetch(url)
      .then(r => r.arrayBuffer())
      .then(buffer => {
        try {
          const { data, width, height } = parseHDR(buffer)

          const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.FloatType)
          texture.mapping = THREE.EquirectangularReflectionMapping
          texture.needsUpdate = true

          const renderer = this.el.sceneEl.renderer
          const pmrem = new THREE.PMREMGenerator(renderer)
          pmrem.compileEquirectangularShader()
          const envMap = pmrem.fromEquirectangular(texture).texture

          this.el.sceneEl.object3D.environment = envMap
          this._envMap = envMap
          pmrem.dispose()
          texture.dispose()

          console.log('[premium-materials] HDR environment map loaded successfully')
        } catch (err) {
          console.warn('[premium-materials] HDR parsing failed, using procedural fallback:', err)
          this._generateProceduralEnv()
        }
      })
      .catch(err => {
        console.warn('[premium-materials] HDR fetch failed, using procedural fallback:', err)
        this._generateProceduralEnv()
      })
  },

  _generateProceduralEnv() {
    const renderer = this.el.sceneEl.renderer
    if (!renderer) return

    const pmrem = new THREE.PMREMGenerator(renderer)

    // Create a gradient sky scene for reflections
    const envScene = new THREE.Scene()
    const skyGeo = new THREE.SphereGeometry(50, 32, 16)
    const skyMat = new THREE.MeshBasicMaterial({
      side: THREE.BackSide,
      vertexColors: true,
    })

    // Paint gradient colors onto vertices
    const colors = []
    const positions = skyGeo.attributes.position
    for (let i = 0; i < positions.count; i++) {
      const y = positions.getY(i)
      const t = (y / 50 + 1) / 2 // 0 at bottom, 1 at top
      // Warm sky gradient for outdoor steel reflections
      const r = 0.6 + t * 0.4
      const g = 0.7 + t * 0.3
      const b = 0.85 + t * 0.15
      colors.push(r, g, b)
    }
    skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    envScene.add(new THREE.Mesh(skyGeo, skyMat))

    // Add a bright "sun" spot
    const sunGeo = new THREE.SphereGeometry(5, 16, 8)
    const sunMat = new THREE.MeshBasicMaterial({color: 0xffffff})
    const sun = new THREE.Mesh(sunGeo, sunMat)
    sun.position.set(20, 30, -10)
    envScene.add(sun)

    const envMap = pmrem.fromScene(envScene, 0.04).texture
    this.el.sceneEl.object3D.environment = envMap
    this._envMap = envMap
    pmrem.dispose()

    console.log('[premium-materials] Procedural environment map generated')
  },

  _enhanceMaterials(obj) {
    if (!obj) return

    obj.traverse((child) => {
      if (!child.isMesh) return
      const mat = child.material
      if (!mat) return

      // Work with arrays of materials too
      const materials = Array.isArray(mat) ? mat : [mat]
      materials.forEach((m) => {
        if (m.isMeshStandardMaterial || m.isMeshPhysicalMaterial) {
          // Stainless steel look: metallic but with realistic brushed roughness
          if (m.metalness > 0.3) {
            m.metalness = Math.min(m.metalness * 1.05, 0.95)
            // Keep roughness moderate — stainless steel is NOT a mirror
            m.roughness = Math.max(m.roughness * 0.8, 0.25)
          } else {
            // Non-metal parts: subtle improvement only
            m.roughness = Math.max(m.roughness * 0.85, 0.3)
          }

          // Moderate environment map intensity — realistic, not flashy
          m.envMapIntensity = 1.0

          // Apply the environment map if available
          if (this._envMap) {
            m.envMap = this._envMap
          }

          m.needsUpdate = true
        }
      })

      // Enable better shadow reception
      child.castShadow = true
      child.receiveShadow = true
    })

    console.log('[premium-materials] Model materials enhanced')
  },
})

