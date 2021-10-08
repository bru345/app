import * as THREE from "three";
import metaversefile from "metaversefile";
import { world } from "./world.js";

class EquipmentRender {
  constructor() {
    this.previewCanvas = null;
    this.previewContext = null;
    this.previewRenderer = null;

    this.initializeScene();
  }

  initializeScene() {
    this.previewScene = new THREE.Scene();
    this.previewCamera = new THREE.PerspectiveCamera(
      10,
      window.innerWidth / window.innerHeight,
      0.1,
      100
    );
    this.previewCamera.position.set(0, 1.35, 4.5);
  }

  async bindPreviewCanvas(pCanvas) {
    this.previewCanvas = pCanvas;

    const rect = this.previewCanvas.getBoundingClientRect();
    this.previewContext =
      this.previewCanvas &&
      this.previewCanvas.getContext("webgl2", {
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: false,
        xrCompatible: true,
      });
    this.previewRenderer = new THREE.WebGLRenderer({
      canvas: this.previewCanvas,
      context: this.previewContext,
      antialias: true,
      alpha: true,
    });
    this.previewRenderer.setSize(rect.width, rect.height);
    this.previewRenderer.setPixelRatio(window.devicePixelRatio);
    this.previewRenderer.autoClear = false;
    this.previewRenderer.sortObjects = false;
    this.previewRenderer.physicallyCorrectLights = true;
    this.previewRenderer.outputEncoding = THREE.sRGBEncoding;
    this.previewRenderer.gammaFactor = 2.2;

    if (!this.previewContext) {
      this.previewContext = this.previewRenderer.getContext();
    }
    this.previewContext.enable(this.previewContext.SAMPLE_ALPHA_TO_COVERAGE);
    this.previewRenderer.xr.enabled = true;

    world.appManager.addEventListener("avatarupdate", (e) => {
      const newAvatar = e.data.app.clone();

      newAvatar.position.set(0, 0, 0);
      newAvatar.rotation.set(0, 0, 0);
      newAvatar.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);

      this.previewScene.clear();
      this.previewScene.add(newAvatar);

      metaversefile.addAppToList(newAvatar);
    });
  }

  render() {
    this.previewRenderer.clear();
    this.previewRenderer.render(this.previewScene, this.previewCamera);
  }
}

const equipmentRender = new EquipmentRender();
export default equipmentRender;