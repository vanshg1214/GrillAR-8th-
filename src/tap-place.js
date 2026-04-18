// tap-place.js — Industry-grade AR gesture control
//
// Drag   : raycast camera→finger→ground plane (model follows finger exactly)
// Rotate : two-finger angle delta (atan2)
// Scale  : two-finger spread ratio (multiplicative, no drift)
//
// Everything uses native Touch events — zero xrextras gesture dependency.

export const tapPlaceComponent = {
  schema: {
    min: {default: 8.321},
    max: {default: 8.321},
  },

  init() {
    const ground  = document.getElementById('ground')
    this.prompt   = document.getElementById('promptText')

    // ── Core state ─────────────────────────────────────────
    this.hasPlacedModel   = false
    this.placedEntity     = null
    this.modelChild       = null
    this.activeModel      = '#grillModel'
    this.gesturesEnabled  = false   
    
    // ── Smoothing Targets (Eliminates Jitter) ──────────────
    this.targetPos   = new THREE.Vector3()
    this.targetRotY  = 0
    this.targetScale = 1
    
    // Adaptive LERP Settings
    this.baseLerp    = 0.05  // Extremely stiff/solid when hands are off
    this.activeLerp  = 0.35  // Very snappy/responsive when interacting
    this.currentLerp = this.baseLerp 
    this.isInitialized = false

    // Per-model scale normalisation
    this.modelScales = {
      '#grillModel': 1.0,
    }

    this.modelYOffsets = {
      '#grillModel': 0,
    }

    // Models that have embedded GLTF animations
    this.animatedModels = new Set([])
    this._mixer = null
    this._animAction = null
    this._animPlaying = false
    this._animClock = new THREE.Clock()

    this._initGestures()

    // ── Ground tap → place model ────────────────────────────
    ground.addEventListener('click', (event) => {
      if (this.hasPlacedModel) return
      this._placeModel(event)
    })
  },

  // ══════════════════════════════════════════════════════════
  //  PLACE MODEL
  // ══════════════════════════════════════════════════════════
  _placeModel(event) {
    this.prompt.style.display = 'none'

    const touchPoint = event.detail.intersection.point
    const newElement = document.createElement('a-entity')

    newElement.setAttribute('position', touchPoint)
    newElement.setAttribute('rotation', '0 0 0')
    newElement.setAttribute('visible',  'false')
    newElement.setAttribute('scale',    '0.0001 0.0001 0.0001')
    newElement.classList.add('cantap')

    const finalScale  = 8.321 // Reduced by 30% from 11.8872

    // Child holds the GLTF model
    const modelChild = document.createElement('a-entity')
    modelChild.setAttribute('gltf-model', this.activeModel)
    modelChild.setAttribute('shadow', {receive: false})

    // Normalise and handle entrance
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
      }
    })

    this.modelChild = modelChild
    newElement.appendChild(modelChild)
    this.el.sceneEl.appendChild(newElement)

    this.hasPlacedModel  = true
    this.placedEntity    = newElement
    this.hasAnimated     = false
    this.gesturesEnabled = false

    // Enable gestures and sync smoothing targets once animation is done
    const enable = () => {
      if (this.gesturesEnabled) return
      this.gesturesEnabled = true
      
      // Initialize targets with the current state to prevent "jump" at start
      this.targetPos.copy(newElement.object3D.position)
      this.targetRotY  = newElement.object3D.rotation.y
      this.targetScale = newElement.object3D.scale.x
      this.isInitialized = true
    }
    newElement.addEventListener('animationcomplete', enable)
    setTimeout(enable, 1200)
  },

  // ══════════════════════════════════════════════════════════
  //  GESTURE SYSTEM  (native Touch events)
  // ══════════════════════════════════════════════════════════
  _initGestures() {
    this._raycaster = new THREE.Raycaster()
    this._hitPoint  = new THREE.Vector3()
    this._hitPlane  = new THREE.Plane()
    this._touches   = new Map()
    this._prevAngle     = null
    this._prevSpread    = null
    this._prevCentroidY = null

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
          
          // ── Tremor Filtering (Deadzone) ──
          // Ignore micro-movements (< 1.5 pixels) to stop jitter from hand shaking
          if (dist > 1.5) {
            this._touches.set(t.identifier, {x: t.clientX, y: t.clientY})
            handled = true
          }
        }
      })
      if (!handled) return
      
      // We are actively interacting, increase smoothing speed to be highly responsive
      this.currentLerp = this.activeLerp

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

  _drag(touch) {
    const entity = this.placedEntity
    if (!entity) return
    const camera = this.el.sceneEl.camera
    const canvas = this.el.sceneEl.canvas
    const rect   = canvas.getBoundingClientRect()
    const ndcX =  ((touch.x - rect.left) / rect.width)  * 2 - 1
    const ndcY = -((touch.y - rect.top)  / rect.height) * 2 + 1
    this._raycaster.setFromCamera({x: ndcX, y: ndcY}, camera)
    
    // During drag, we update the target position
    const modelY = entity.object3D.position.y
    this._hitPlane.set(new THREE.Vector3(0, 1, 0), -modelY)
    if (this._raycaster.ray.intersectPlane(this._hitPlane, this._hitPoint)) {
      this.targetPos.x = this._hitPoint.x
      this.targetPos.z = this._hitPoint.z
    }
  },

  _pinchRotate(t1, t2) {
    const entity = this.placedEntity
    if (!entity) return

    const angle     = Math.atan2(t2.y - t1.y, t2.x - t1.x)
    const spread    = Math.hypot(t2.x - t1.x, t2.y - t1.y)
    const centroidY = (t1.y + t2.y) / 2

    if (this._prevAngle !== null) {
      // 1. Rotation (Twist)
      const dAngle = angle - this._prevAngle
      this.targetRotY -= dAngle

      // 2. Height Control (Vertical Slide)
      const dCentroidY = centroidY - this._prevCentroidY
      const moveSensitivity = 0.05
      this.targetPos.y -= (dCentroidY * moveSensitivity)

      // 3. Scaling (Pinch/Spread)
      const dSpread = spread / this._prevSpread
      const newScale = this.targetScale * dSpread
      
      // Safety limits
      const minS = 0.5
      const maxS = 100.0
      
      if (newScale > minS && newScale < maxS) {
        this.targetScale = newScale
      }
    }

    this._prevAngle     = angle
    this._prevSpread    = spread
    this._prevCentroidY = centroidY
  },

  tick() {
    // ── Animation Mixer ──────────────────
    if (this._mixer && this._animPlaying) {
      const delta = this._animClock.getDelta()
      this._mixer.update(delta)
    }

    // ── Stability Smoothing (The Magic) ──
    if (this.placedEntity && this.isInitialized) {
      const obj = this.placedEntity.object3D
      
      // Decay LERP speed back to solid base over time when user stops moving fingers
      this.currentLerp = THREE.MathUtils.lerp(this.currentLerp, this.baseLerp, 0.04)

      // Smoothly move position using dynamic damping
      obj.position.lerp(this.targetPos, this.currentLerp)
      
      // Smoothly rotate (Lerp angle)
      obj.rotation.y += (this.targetRotY - obj.rotation.y) * this.currentLerp
      
      // Smoothly scale
      const s = obj.scale.x + (this.targetScale - obj.scale.x) * this.currentLerp
      obj.scale.set(s, s, s)
    }
  },

  _normalizeModel(entity) {
    const obj = entity.getObject3D('mesh')
    if (!obj) {
      entity.object3D.visible = false
      entity.addEventListener('model-loaded', () => this._normalizeModel(entity), {once: true})
      return
    }

    const backups = [];
    let curr = entity.object3D;
    let root = curr;
    while (curr) {
      backups.push({obj: curr, scale: curr.scale.clone(), rotation: curr.rotation.clone()});
      curr.scale.set(1, 1, 1);
      curr.rotation.set(0, 0, 0);
      root = curr;
      curr = curr.parent;
    }

    root.updateMatrixWorld(true);
    const box = new THREE.Box3();
    obj.traverse((child) => { if (child.isMesh) box.expandByObject(child) });
    if (box.isEmpty()) box.setFromObject(obj);

    const size = new THREE.Vector3();
    box.getSize(size);
    const target = new THREE.Vector3();
    obj.getWorldPosition(target);
    const localBottomY = box.min.y - target.y;

    for (const item of backups) {
      item.obj.scale.copy(item.scale);
      item.obj.rotation.copy(item.rotation);
    }

    const maxDim = Math.max(size.x, size.y, size.z)
    let s = 1.0;
    if (maxDim > 0) {
      const userScale = this.modelScales[this.activeModel] || 1.0
      s = (1.0 / maxDim) * userScale
      entity.object3D.scale.set(s, s, s)
    }

    entity.object3D.updateMatrixWorld(true);
    const yOffset = this.modelYOffsets[this.activeModel] || 0;
    entity.object3D.position.y = (-localBottomY * s) + yOffset;
    entity.object3D.visible = true
  },
}
