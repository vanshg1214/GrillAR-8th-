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
