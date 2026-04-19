// tap-place.js — Restored completely to the native 8th Wall Place Ground (Cactus) logic.

export const tapPlaceComponent = {
  init() {
    const ground = document.getElementById('ground')
    const prompt = document.getElementById('promptText')

    // Configuration
    this.activeModel = '#grillModel'
    this.placedEntity = null
    this.hasPlacedModel = false
    
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

    const backups = []
    let curr = entity.object3D
    let root = curr
    while (curr) {
      backups.push({obj: curr, scale: curr.scale.clone(), rotation: curr.rotation.clone()})
      curr.scale.set(1, 1, 1)
      curr.rotation.set(0, 0, 0)
      root = curr
      curr = curr.parent
    }

    root.updateMatrixWorld(true)
    const box = new THREE.Box3()
    obj.traverse((child) => { if (child.isMesh) box.expandByObject(child) })
    if (box.isEmpty()) box.setFromObject(obj)

    const size = new THREE.Vector3()
    box.getSize(size)
    const target = new THREE.Vector3()
    obj.getWorldPosition(target)
    const localBottomY = box.min.y - target.y

    for (const item of backups) {
      item.obj.scale.copy(item.scale)
      item.obj.rotation.copy(item.rotation)
    }

    const maxDim = Math.max(size.x, size.y, size.z)
    let s = 1.0
    if (maxDim > 0) {
      s = 1.0 / maxDim
      entity.object3D.scale.set(s, s, s)
    }

    entity.object3D.updateMatrixWorld(true)
    // Shift the child mesh locally so its lowest point rests exactly on the floor, 
    // without overriding the entity's world placement coordinate.
    obj.position.y = (-localBottomY * s)
    entity.object3D.visible = true
  },

  _initGestures() {
    const onStart = (e) => {
      Array.from(e.changedTouches).forEach(t => {
        this._touches.set(t.identifier, {x: t.clientX, y: t.clientY})
      })
      this._prevAngle = null
      this._prevSpread = null
      this._prevCentroidY = null
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
      this._prevAngle = null
      this._prevSpread = null
      this._prevCentroidY = null
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

    // Raycast against flat horizontal plane at model's current Y height
    const modelY = this.placedEntity.object3D.position.y
    this._hitPlane.set(new THREE.Vector3(0, 1, 0), -modelY)
    
    if (this._raycaster.ray.intersectPlane(this._hitPlane, this._hitPoint)) {
      this.placedEntity.object3D.position.x = this._hitPoint.x
      this.placedEntity.object3D.position.z = this._hitPoint.z
    }
  },

  _pinchRotate(t1, t2) {
    if (!this.placedEntity) return

    const angle = Math.atan2(t2.y - t1.y, t2.x - t1.x)
    const spread = Math.hypot(t2.x - t1.x, t2.y - t1.y)
    const centroidY = (t1.y + t2.y) / 2

    if (this._prevAngle !== null) {
      // Twist Rotation
      const dAngle = angle - this._prevAngle
      this.placedEntity.object3D.rotation.y -= dAngle

      // Vertical Slide Height
      const dCentroidY = centroidY - this._prevCentroidY
      this.placedEntity.object3D.position.y -= dCentroidY * 0.01
    }

    this._prevAngle = angle
    this._prevSpread = spread
    this._prevCentroidY = centroidY
  }
}
