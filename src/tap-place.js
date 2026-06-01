// tap-place.js — Restored completely to the native 8th Wall Place Ground (Cactus) logic.

export const tapPlaceComponent = {
  init() {
    const ground = document.getElementById('ground')
    const prompt = document.getElementById('promptText')

    // Configuration
    this.activeModel = '#grillModel'
    this.placedEntity = null
    this.hasPlacedModel = false
    this.isDragging = false
    this._floorY = 0  // Y coordinate of the floor where the model was placed
    
    // Scale config: Setting this to 0.7 makes it 30% smaller than before.
    // Fixed size: We will now ignore manual scaling gestures to keep this size constant.
    const finalScale = 0.7 

    // Listeners for gestures
    this._touches = new Map()
    this._prevAngle = null
    this._prevSpread = null
    this._prevCentroidY = null
    this._raycaster = new THREE.Raycaster()
    this._hitPlane = new THREE.Plane()
    this._hitPoint = new THREE.Vector3()

    ground.addEventListener('click', event => {
      // Basic 8th Wall logic: only place one model
      if (this.hasPlacedModel) return
      this.hasPlacedModel = true

      if (prompt) prompt.style.display = 'none'

      // Create new entity for the new object
      const newElement = document.createElement('a-entity')

      // The raycaster gives a location of the touch in the scene
      const touchPoint = event.detail.intersection.point
      newElement.setAttribute('position', touchPoint)
      newElement.setAttribute('rotation', '0 0 0')
      
      // Start tiny so we can animate it popping up
      newElement.setAttribute('visible', 'false')
      newElement.setAttribute('scale', '0.0001 0.0001 0.0001')

      // Set the 3D model
      newElement.setAttribute('gltf-model', this.activeModel)
      newElement.setAttribute('shadow', {receive: false})

      this.el.sceneEl.appendChild(newElement)

      newElement.addEventListener('model-loaded', () => {
        this.placedEntity = newElement
        this._floorY = touchPoint.y  // Lock to the floor Y where user tapped
        
        // Normalize model to be exactly 1x1x1 meters before scaling
        this._normalizeModel(newElement)

        // Once the model is loaded, we are ready to show it popping in using an animation
        newElement.setAttribute('visible', 'true')
        newElement.setAttribute('animation', {
          property: 'scale',
          to: `${finalScale} ${finalScale} ${finalScale}`,
          easing: 'easeOutElastic',
          dur: 800,
        })
      })
    })

    // Initialize custom gesture tracking the standard DOM way
    this._initGestures()
  },

  _normalizeModel(entity) {
    const obj = entity.getObject3D('mesh')
    if (!obj) {
      entity.object3D.visible = false
      entity.addEventListener('model-loaded', () => this._normalizeModel(entity), {once: true})
      return
    }

    // Step 1: Reset any transforms baked into the mesh by the exporter
    obj.position.set(0, 0, 0)
    obj.rotation.set(0, 0, 0)
    obj.scale.set(1, 1, 1)
    obj.updateMatrixWorld(true)

    // Step 2: Compute the raw bounding box of the model in its own local space
    const box = new THREE.Box3().setFromObject(obj)
    if (box.isEmpty()) {
      entity.object3D.visible = true
      return
    }

    const size = new THREE.Vector3()
    box.getSize(size)
    const center = new THREE.Vector3()
    box.getCenter(center)

    // Step 3: Normalize the model so its largest dimension equals 1 meter
    const maxDim = Math.max(size.x, size.y, size.z)
    const s = maxDim > 0 ? (1.0 / maxDim) : 1.0
    obj.scale.set(s, s, s)

    // Step 4: Shift the mesh so its bottom face sits exactly at Y=0
    // After scaling, the bottom of the box is at (box.min.y * s).
    // We need to shift the mesh up by that amount so the bottom is at Y=0.
    obj.position.set(
      -center.x * s,   // Center horizontally
      -box.min.y * s,   // Sit on the floor (Y=0)
      -center.z * s     // Center depth-wise
    )

    entity.object3D.visible = true
    console.log('[tap-place] Model normalized — scale:', s.toFixed(4),
      'floor offset:', (-box.min.y * s).toFixed(4))
  },

  _initGestures() {
    const onStart = (e) => {
      Array.from(e.changedTouches).forEach(t => {
        this._touches.set(t.identifier, {x: t.clientX, y: t.clientY})
      })
      this._prevAngle = null
      this._prevSpread = null
      this._prevCentroidY = null

      if (this.placedEntity && e.touches.length === 1) {
        const touch = e.touches[0]
        const camera = this.el.sceneEl.camera
        const canvas = this.el.sceneEl.canvas
        if (camera && canvas) {
          const rect = canvas.getBoundingClientRect()
          const ndcX = ((touch.clientX - rect.left) / rect.width) * 2 - 1
          const ndcY = -((touch.clientY - rect.top) / rect.height) * 2 + 1
          this._raycaster.setFromCamera({x: ndcX, y: ndcY}, camera)
          const intersects = this._raycaster.intersectObject(this.placedEntity.object3D, true)
          this.isDragging = intersects.length > 0
        } else {
          this.isDragging = false
        }
      } else if (e.touches.length >= 2) {
        this.isDragging = true
      }
    }

    const onMove = (e) => {
      if (!this.placedEntity) return

      let handled = false
      Array.from(e.changedTouches).forEach(t => {
        if (this._touches.has(t.identifier)) {
          this._touches.set(t.identifier, {x: t.clientX, y: t.clientY})
          handled = true
        }
      })
      if (!handled) return

      const pts = Array.from(this._touches.values())

      if (pts.length === 1 && this.isDragging) {
        this._drag(pts[0])
        e.preventDefault()
      } else if (pts.length >= 2 && this.isDragging) {
        this._pinchRotate(pts[0], pts[1])
        e.preventDefault()
      }
    }

    const onEnd = (e) => {
      Array.from(e.changedTouches).forEach(t => {
        this._touches.delete(t.identifier)
      })
      this._prevAngle = null
      this._prevSpread = null
      this._prevCentroidY = null
      if (this._touches.size === 0) {
        this.isDragging = false
      }
    }

    document.addEventListener('touchstart', onStart, {passive: true})
    document.addEventListener('touchmove', onMove, {passive: false})
    document.addEventListener('touchend', onEnd, {passive: true})
    document.addEventListener('touchcancel', onEnd, {passive: true})
  },

  _drag(touch) {
    if (!this.placedEntity) return
    const camera = this.el.sceneEl.camera
    const canvas = this.el.sceneEl.canvas
    const rect = canvas.getBoundingClientRect()
    const ndcX = ((touch.x - rect.left) / rect.width) * 2 - 1
    const ndcY = -((touch.y - rect.top) / rect.height) * 2 + 1
    this._raycaster.setFromCamera({x: ndcX, y: ndcY}, camera)

    // Raycast against the FIXED floor plane (Y = floorY), never the model's current Y
    this._hitPlane.set(new THREE.Vector3(0, 1, 0), -this._floorY)
    
    if (this._raycaster.ray.intersectPlane(this._hitPlane, this._hitPoint)) {
      const currentPos = this.placedEntity.object3D.position
      const dx = this._hitPoint.x - currentPos.x
      const dz = this._hitPoint.z - currentPos.z
      const dist = Math.sqrt(dx * dx + dz * dz)

      // Only move if the shift is bigger than 5mm (Deadzone)
      if (dist > 0.005) {
        currentPos.x += dx * 0.4
        currentPos.z += dz * 0.4
      }

      // Hard-lock Y to the floor and prevent any tilt
      currentPos.y = this._floorY
      this.placedEntity.object3D.rotation.x = 0
      this.placedEntity.object3D.rotation.z = 0
    }
  },

  _pinchRotate(t1, t2) {
    if (!this.placedEntity) return

    const angle = Math.atan2(t2.y - t1.y, t2.x - t1.x)

    if (this._prevAngle !== null) {
      // Twist Rotation only — no vertical slide to keep grill on the floor
      const dAngle = angle - this._prevAngle
      this.placedEntity.object3D.rotation.y -= dAngle

      // Hard-lock to floor and prevent any tilt
      this.placedEntity.object3D.position.y = this._floorY
      this.placedEntity.object3D.rotation.x = 0
      this.placedEntity.object3D.rotation.z = 0
    }

    this._prevAngle = angle
  }
}
