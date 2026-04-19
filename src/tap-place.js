// tap-place.js — 8th Wall SLAM-native world-locked AR placement
//
// PLACEMENT: Uses XR8's native camera pipeline hit test against the real
//            SLAM-detected floor surface — NOT a static invisible ground box.
//            This guarantees true world-space locking via 8th Wall's SLAM.
//
// GESTURES (finger interaction only):
//   1-finger drag   : moves model horizontally on the SLAM floor plane
//   2-finger twist  : rotates model around Y axis
//   2-finger spread : scales model
//   2-finger slide  : lifts model on Y axis
//
// tick() NEVER touches transform. The model only moves when fingers move.

export const tapPlaceComponent = {
  schema: {
    finalScale: {default: 8.321},
  },

  init() {
    this.prompt = document.getElementById('promptText')

    // ── Core state ─────────────────────────────────────────
    this.hasPlacedModel   = false
    this.placedEntity     = null
    this.modelChild       = null
    this.activeModel      = '#grillModel'
    this.gesturesEnabled  = false
    this.hasAnimated      = false

    // Per-model config
    this.modelScales  = {'#grillModel': 1.0}
    this.modelYOffsets = {'#grillModel': 0}

    // Animation mixer (for models with embedded animations)
    this.animatedModels = new Set([])
    this._mixer       = null
    this._animPlaying = false
    this._animClock   = new THREE.Clock()

    // Gesture tracking
    this._raycaster = new THREE.Raycaster()
    this._hitPoint  = new THREE.Vector3()
    this._hitPlane  = new THREE.Plane()
    this._touches   = new Map()
    this._prevAngle     = null
    this._prevSpread    = null
    this._prevCentroidY = null

    // ── Register XR8 pipeline module for tap placement ─────
    // This hooks into 8th Wall's SLAM camera pipeline directly.
    // We listen for a single tap, then use XR8's world hit test
    // to find the exact SLAM floor position.
    this._pipelineModule = this._buildPipelineModule()

    this.el.sceneEl.addEventListener('loaded', () => {
      if (window.XR8) {
        XR8.addCameraPipelineModule(this._pipelineModule)
      } else {
        // fallback: use standard ground click if XR8 not available
        this._initFallbackGroundTap()
      }
    })

    this._initGestures()
  },

  // ══════════════════════════════════════════════════════════
  //  8th WALL PIPELINE MODULE
  //  Hooks into SLAM to detect real floor surface on tap
  // ══════════════════════════════════════════════════════════
  _buildPipelineModule() {
    const self = this
    return {
      name: 'tap-place-pipeline',
      listeners: [
        {
          event: 'reality.imagefound',
          process: () => {},
        },
      ],
      onStart({canvas}) {
        // Listen for tap on the canvas forwarded through XR8's world tracking
        canvas.addEventListener('touchstart', (e) => {
          if (self.hasPlacedModel) return
          if (e.touches.length !== 1) return

          const touch = e.touches[0]
          const normalizedX = touch.clientX / canvas.clientWidth
          const normalizedY = touch.clientY / canvas.clientHeight

          // XR8.XrController.hitTest: asks SLAM "what real-world surface
          // is under this screen coordinate?" — true world-space result
          if (window.XR8 && XR8.XrController && XR8.XrController.hitTest) {
            const hits = XR8.XrController.hitTest(normalizedX, normalizedY, ['FEATURE_POINT', 'ESTIMATED_SURFACE'])

            if (hits && hits.length > 0) {
              const hit = hits[0]
              // hit.position is a true SLAM world-space coordinate
              self._placeModelAtWorldPos(
                hit.position.x,
                hit.position.y,
                hit.position.z,
                hit.rotation  // optional orientation from surface normal
              )
              return
            }
          }

          // If hit test returned no results, fall back to ground box raycaster
          // (this handles surfaces where SLAM hasn't detected a plane yet)
          self._initFallbackGroundTap()
        }, {passive: true})
      },
    }
  },

  // ── Fallback for when XR8 hit test isn't available ─────
  _initFallbackGroundTap() {
    if (this._fallbackInitialized) return
    this._fallbackInitialized = true

    const ground = document.getElementById('ground')
    if (!ground) return
    ground.addEventListener('click', (event) => {
      if (this.hasPlacedModel) return
      const p = event.detail.intersection.point
      this._placeModelAtWorldPos(p.x, p.y, p.z, null)
    })
  },

  // ══════════════════════════════════════════════════════════
  //  PLACE MODEL AT SLAM WORLD POSITION
  // ══════════════════════════════════════════════════════════
  _placeModelAtWorldPos(wx, wy, wz, rotation) {
    if (this.hasPlacedModel) return
    this.hasPlacedModel = true

    if (this.prompt) this.prompt.style.display = 'none'

    const finalScale = this.data.finalScale
    const newElement = document.createElement('a-entity')

    // Place at SLAM world coords — these are tied to real SLAM surface,
    // NOT relative to camera, so they remain world-locked as user moves.
    newElement.setAttribute('position', {x: wx, y: wy, z: wz})
    newElement.setAttribute('rotation', '0 0 0')
    newElement.setAttribute('visible', 'false')
    newElement.setAttribute('scale',   '0.0001 0.0001 0.0001')
    // NO cantap class — prevents raycaster from hitting model and
    // causing any position recalculation when user walks toward it

    const modelChild = document.createElement('a-entity')
    modelChild.setAttribute('gltf-model', this.activeModel)
    modelChild.setAttribute('shadow',     {receive: false})

    modelChild.addEventListener('model-loaded', () => {
      this._normalizeModel(modelChild)

      if (!this.hasAnimated) {
        this.hasAnimated = true
        newElement.setAttribute('visible', 'true')
        newElement.setAttribute('animation', {
          property: 'scale',
          to:       `${finalScale} ${finalScale} ${finalScale}`,
          easing:   'easeOutElastic',
          dur:      800,
        })

        newElement.addEventListener('animationcomplete', () => {
          if (this.gesturesEnabled) return
          this.gesturesEnabled = true
        }, {once: true})
      }
    })

    this.modelChild = modelChild
    newElement.appendChild(modelChild)
    this.el.sceneEl.appendChild(newElement)
    this.placedEntity = newElement
  },

  // ══════════════════════════════════════════════════════════
  //  GESTURE SYSTEM  (native Touch — zero xrextras dependency)
  // ══════════════════════════════════════════════════════════
  _initGestures() {
    const onStart = (e) => {
      Array.from(e.changedTouches).forEach(t => {
        this._touches.set(t.identifier, {x: t.clientX, y: t.clientY})
      })
      this._prevAngle     = null
      this._prevSpread    = null
      this._prevCentroidY = null
    }

    const onMove = (e) => {
      if (!this.gesturesEnabled || !this.placedEntity) return

      let handled = false
      Array.from(e.changedTouches).forEach(t => {
        if (this._touches.has(t.identifier)) {
          const prev = this._touches.get(t.identifier)
          const dist = Math.hypot(t.clientX - prev.x, t.clientY - prev.y)
          // Deadzone: ignore < 1.5px to filter hand tremor
          if (dist > 1.5) {
            this._touches.set(t.identifier, {x: t.clientX, y: t.clientY})
            handled = true
          }
        }
      })
      if (!handled) return

      const pts = Array.from(this._touches.values())
      if (pts.length === 1) {
        this._drag(pts[0])
        e.preventDefault()
      } else if (pts.length >= 2) {
        this._pinchRotate(pts[0], pts[1])
        e.preventDefault()
      }
    }

    const onEnd = (e) => {
      Array.from(e.changedTouches).forEach(t => {
        this._touches.delete(t.identifier)
      })
      this._prevAngle     = null
      this._prevSpread    = null
      this._prevCentroidY = null
    }

    document.addEventListener('touchstart',  onStart, {passive: true})
    document.addEventListener('touchmove',   onMove,  {passive: false})
    document.addEventListener('touchend',    onEnd,   {passive: true})
    document.addEventListener('touchcancel', onEnd,   {passive: true})
  },

  // ── 1-FINGER DRAG ────────────────────────────────────────
  // Raycasts from camera through finger onto the model's horizontal plane.
  // Uses the model's current Y for the plane — keeps model at same height.
  _drag(touch) {
    const entity = this.placedEntity
    if (!entity) return
    const camera = this.el.sceneEl.camera
    const canvas = this.el.sceneEl.canvas
    const rect   = canvas.getBoundingClientRect()
    const ndcX   =  ((touch.x - rect.left) / rect.width)  * 2 - 1
    const ndcY   = -((touch.y - rect.top)  / rect.height) * 2 + 1
    this._raycaster.setFromCamera({x: ndcX, y: ndcY}, camera)

    const modelY = entity.object3D.position.y
    this._hitPlane.set(new THREE.Vector3(0, 1, 0), -modelY)
    if (this._raycaster.ray.intersectPlane(this._hitPlane, this._hitPoint)) {
      entity.object3D.position.x = this._hitPoint.x
      entity.object3D.position.z = this._hitPoint.z
    }
  },

  // ── 2-FINGER: ROTATE + SCALE + HEIGHT ────────────────────
  _pinchRotate(t1, t2) {
    const entity = this.placedEntity
    if (!entity) return

    const angle     = Math.atan2(t2.y - t1.y, t2.x - t1.x)
    const spread    = Math.hypot(t2.x - t1.x, t2.y - t1.y)
    const centroidY = (t1.y + t2.y) / 2

    if (this._prevAngle !== null) {
      // 1. Rotation
      const dAngle = angle - this._prevAngle
      entity.object3D.rotation.y -= dAngle

      // 2. Height (Y lift)
      const dCentroidY   = centroidY - this._prevCentroidY
      entity.object3D.position.y -= dCentroidY * 0.05

      // 3. Scale
      const dSpread   = spread / this._prevSpread
      const newScale  = entity.object3D.scale.x * dSpread
      const minS = 0.5, maxS = 100.0
      if (newScale > minS && newScale < maxS) {
        entity.object3D.scale.multiplyScalar(dSpread)
      }
    }

    this._prevAngle     = angle
    this._prevSpread    = spread
    this._prevCentroidY = centroidY
  },

  // ── tick: ONLY animation mixer — NEVER touches transform ─
  tick() {
    if (this._mixer && this._animPlaying) {
      this._mixer.update(this._animClock.getDelta())
    }
  },

  // ── Normalize model to unit scale before applying finalScale
  _normalizeModel(entity) {
    const obj = entity.getObject3D('mesh')
    if (!obj) {
      entity.object3D.visible = false
      entity.addEventListener('model-loaded', () => this._normalizeModel(entity), {once: true})
      return
    }

    const backups = []
    let curr = entity.object3D, root = curr
    while (curr) {
      backups.push({obj: curr, scale: curr.scale.clone(), rotation: curr.rotation.clone()})
      curr.scale.set(1, 1, 1)
      curr.rotation.set(0, 0, 0)
      root = curr
      curr = curr.parent
    }

    root.updateMatrixWorld(true)
    const box = new THREE.Box3()
    obj.traverse(child => { if (child.isMesh) box.expandByObject(child) })
    if (box.isEmpty()) box.setFromObject(obj)

    const size = new THREE.Vector3()
    box.getSize(size)
    const worldPos = new THREE.Vector3()
    obj.getWorldPosition(worldPos)
    const localBottomY = box.min.y - worldPos.y

    for (const item of backups) {
      item.obj.scale.copy(item.scale)
      item.obj.rotation.copy(item.rotation)
    }

    const maxDim = Math.max(size.x, size.y, size.z)
    let s = 1.0
    if (maxDim > 0) {
      s = (1.0 / maxDim) * (this.modelScales[this.activeModel] || 1.0)
      entity.object3D.scale.set(s, s, s)
    }

    entity.object3D.updateMatrixWorld(true)
    const yOffset = this.modelYOffsets[this.activeModel] || 0
    entity.object3D.position.y = (-localBottomY * s) + yOffset
    entity.object3D.visible = true
  },
}
