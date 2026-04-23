import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { getTranslation, setLanguage } from './i18n.js';
// Providers live in the main process and are invoked via IPC (window.electronAPI.ai*)

// Debug: Write to window object
window.debugLog = [];
function debug(msg) {
  const timestamp = new Date().toLocaleTimeString();
  const fullMsg = `[${timestamp}] ${msg}`;
  console.log(fullMsg);
  window.debugLog.push(fullMsg);
}

debug('renderer.js module loading...');

const LENS_TEMPLATES = [
  { name: 'Leica Summilux 24mm',    fov: 74, near: 0.1, far: 10000, vignette: 0.15 },
  { name: 'Sigma Art 24mm',         fov: 74, near: 0.1, far: 10000, vignette: 0.10 },
  { name: 'Leica Summicron 28mm',   fov: 65, near: 0.1, far: 10000, vignette: 0.12 },
  { name: 'Zeiss Milvus 35mm',      fov: 54, near: 0.1, far: 10000, vignette: 0.10 },
  { name: 'Cooke S4 32mm',          fov: 58, near: 0.1, far: 10000, vignette: 0.12 },
  { name: 'Canon EF 50mm f/1.2L',   fov: 40, near: 0.1, far: 10000, vignette: 0.08 },
  { name: 'Leica Noctilux 50mm',    fov: 40, near: 0.1, far: 10000, vignette: 0.20 },
  { name: 'Zeiss Supreme 50mm',     fov: 40, near: 0.1, far: 10000, vignette: 0.08 },
  { name: 'Cooke S4 75mm',          fov: 27, near: 0.1, far: 10000, vignette: 0.10 },
  { name: 'Zeiss Otus 85mm',        fov: 24, near: 0.1, far: 10000, vignette: 0.10 },
  { name: 'Leica APO 90mm',         fov: 22, near: 0.1, far: 10000, vignette: 0.12 },
  { name: 'Canon EF 135mm f/2L',    fov: 15, near: 0.1, far: 10000, vignette: 0.08 },
];
let currentFov = 54;
let targetFov = 54;

// Mission E - popup sentinel so animate() can safely skip the position update
// before selectedObject and objectPopup are initialized later in the file
let _popupReady = false;

// Object animation clock - runs continuously for per-frame deltas
const objAnimClock = new THREE.Clock();

const RATIO_MAP = {
  '16:9': 16 / 9,
  '1:1':  1,
  '4:5':  4 / 5,
  '3:4':  3 / 4,
  '9:16': 9 / 16
};

function updateObjectAnimations(delta) {
  scene.traverse(obj => {
    if (!obj.userData || !obj.userData.animTemplate || obj.userData.animTemplate === 'none') return;
    obj.userData.animTime = (obj.userData.animTime || 0) + delta;
    const t = obj.userData.animTime;
    const sp = obj.userData.animStartPos;
    if (!sp) return;

    switch (obj.userData.animTemplate) {
      case 'float':
        // Gentle sine wave — smooth infinite loop
        obj.position.y = sp.y + Math.sin(t * 1.2) * 0.18;
        break;

      case 'land': {
        // Loop: drop from above, bounce settle, pause, repeat
        const landCycle = 3.5;
        const landT = t % landCycle;
        if (landT < 1.2) {
          const ease = 1 - Math.pow(1 - landT / 1.2, 3);
          obj.position.y = sp.y + (1 - ease) * 3;
        } else if (landT < 2.5) {
          const bounce = Math.abs(Math.sin((landT - 1.2) * 5))
            * 0.12 * Math.exp(-(landT - 1.2) * 3);
          obj.position.y = sp.y + bounce;
        } else {
          obj.position.y = sp.y;
        }
        break;
      }

      case 'rotate':
        obj.rotation.y = (obj.userData.animStartRotY || 0) + t * 0.6;
        break;

      case 'slide-in': {
        // Loop: enter from left, hold, exit right, repeat
        const slideCycle = 3.0;
        const slideT = t % slideCycle;
        if (slideT < 1.2) {
          const ease = 1 - Math.pow(1 - slideT / 1.2, 4);
          obj.position.x = sp.x + (1 - ease) * -4;
        } else if (slideT < 2.2) {
          obj.position.x = sp.x;
        } else {
          const exitT = (slideT - 2.2) / 0.8;
          const exitEase = Math.pow(exitT, 2);
          obj.position.x = sp.x + exitEase * 4;
        }
        break;
      }
    }
  });
}

// ---- Pipeline State ----
const pipelineState = {
  mp4Path: null,
  mp4Filename: null,
  referenceFrame: null,
  referenceImage: null,
  prompt: null,
  aiResultUrl: null,
  upscaleUrl: null,
  currentStep: 0
};

// ---- Scene Setup ----
const container = document.getElementById('viewport');
debug('Container element: ' + (container ? 'FOUND' : 'NULL'));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x080a0c);
debug('Scene created');

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(5, 5, 5);
debug('Camera created');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setClearColor(0x080a0c, 1);
debug('Renderer created, size: ' + window.innerWidth + 'x' + window.innerHeight);
try {
  container.appendChild(renderer.domElement);
  debug('Canvas appended to DOM');
} catch (e) {
  debug('ERROR appending canvas: ' + e.message);
}

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

const gridHelper = new THREE.GridHelper(20, 20, 0x252a32, 0x1a1e24);
scene.add(gridHelper);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(10, 20, 10);
scene.add(dirLight);

const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
fillLight.position.set(-10, -5, -10);
scene.add(fillLight);

// ---- Gizmo Setup ----
const gizmoScene = new THREE.Scene();
const gizmoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
gizmoCamera.position.set(0, 0, 5);
const gizmoRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
gizmoRenderer.setSize(80, 80);
gizmoRenderer.domElement.id = 'gizmo-canvas';
container.appendChild(gizmoRenderer.domElement);

const sunControlEl = document.createElement('div');
sunControlEl.id = 'sun-btn';
sunControlEl.style.cssText = 'position:absolute;left:16px;top:108px;width:64px;height:64px;z-index:100;cursor:crosshair;';
const sunPreviewCanvas = document.createElement('canvas');
sunPreviewCanvas.id = 'sun-preview';
sunPreviewCanvas.width = 64;
sunPreviewCanvas.height = 64;
sunPreviewCanvas.style.cssText = 'display:block;border-radius:50%;';
sunControlEl.appendChild(sunPreviewCanvas);
container.appendChild(sunControlEl);

const sunResetEl = document.createElement('div');
sunResetEl.id = 'sun-reset';
sunResetEl.setAttribute('data-i18n', 'resetLight');
sunResetEl.style.cssText = 'position:absolute;left:16px;top:182px;font-size:10px;color:#555;text-align:center;width:64px;cursor:pointer;z-index:100;';
container.appendChild(sunResetEl);

const origin = new THREE.Vector3(0, 0, 0);
gizmoScene.add(new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), origin, 0.8, 0xff0000, 0.2, 0.2));
gizmoScene.add(new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), origin, 0.8, 0x00ff00, 0.2, 0.2));
gizmoScene.add(new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), origin, 0.8, 0x0000ff, 0.2, 0.2));

function createTextSprite(text, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.font = 'Bold 48px Arial';
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.fillText(text, 32, 48);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  const spriteMaterial = new THREE.SpriteMaterial({ map: texture, depthTest: false });
  const sprite = new THREE.Sprite(spriteMaterial);
  sprite.scale.set(0.4, 0.4, 0.4);
  return sprite;
}

const spriteX = createTextSprite('X', '#ff0000');
spriteX.position.set(0.9, 0, 0);
gizmoScene.add(spriteX);

const spriteY = createTextSprite('Y', '#00ff00');
spriteY.position.set(0, 0.9, 0);
gizmoScene.add(spriteY);

const spriteZ = createTextSprite('Z', '#0000ff');
spriteZ.position.set(0, 0, 0.9);
gizmoScene.add(spriteZ);

let updateCameraAnimation = null;

function drawSunPreview() {
  const canvas = document.getElementById('sun-preview');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 64, 64);
  // Draw sphere
  const grad = ctx.createRadialGradient(26, 26, 2, 32, 32, 20);
  grad.addColorStop(0, '#555');
  grad.addColorStop(1, '#1a1a1a');
  ctx.beginPath();
  ctx.arc(32, 32, 20, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();
  // Project dirLight direction onto sphere surface
  const dir = dirLight.position.clone().normalize();
  const dotX = 32 + dir.x * 18;
  const dotY = 32 - dir.y * 18;
  // Draw light dot
  ctx.beginPath();
  ctx.arc(dotX, dotY, 5, 0, Math.PI * 2);
  ctx.fillStyle = '#ffe066';
  ctx.shadowColor = '#ffe066';
  ctx.shadowBlur = 8;
  ctx.fill();
  ctx.shadowBlur = 0;
}

function animate() {
  requestAnimationFrame(animate);
  // Per-frame object animations (templates) — runs every frame
  updateObjectAnimations(objAnimClock.getDelta());
  let animHandled = false;
  if (updateCameraAnimation) {
    animHandled = updateCameraAnimation();
  }
  if (!animHandled) {
    controls.update();
  }
  renderer.render(scene, camera);

  // FOV animation
  if (Math.abs(camera.fov - targetFov) > 0.01) {
    camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, 0.1);
    camera.updateProjectionMatrix();
  }

  // Sync Gizmo
  gizmoCamera.position.copy(camera.position);
  gizmoCamera.position.sub(controls.target);
  gizmoCamera.position.setLength(5);
  gizmoCamera.lookAt(0, 0, 0);
  gizmoRenderer.render(gizmoScene, gizmoCamera);
  drawSunPreview();
  updateTargetMarker();
}
debug('Calling animate()...');
try {
  animate();
  debug('animate() called successfully');
} catch (e) {
  debug('ERROR in animate(): ' + e.message);
}

window.addEventListener('resize', () => {
  const w = container.clientWidth || window.innerWidth;
  const h = container.clientHeight || window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
});

debug('Adding UI event listeners...');

// ---- UI Interaction ----

// Navigation Hint Overlay
try {
  document.getElementById('close-hint-btn').addEventListener('click', () => {
    document.getElementById('nav-hint').style.display = 'none';
  });
  debug('Navigation hint listener added');
} catch (e) {
  debug('ERROR adding navigation hint listener: ' + e.message);
}

// Target Lock
const targetGlyphMaterial = new THREE.LineBasicMaterial({ color: 0xffffff });
const glyphPoints = [];
const s = 0.2;
glyphPoints.push(new THREE.Vector3(-s, 0, 0), new THREE.Vector3(s, 0, 0));
glyphPoints.push(new THREE.Vector3(0, -s, 0), new THREE.Vector3(0, s, 0));
glyphPoints.push(new THREE.Vector3(0, 0, -s), new THREE.Vector3(0, 0, s));
const targetGlyph = new THREE.LineSegments(
  new THREE.BufferGeometry().setFromPoints(glyphPoints),
  targetGlyphMaterial
);
targetGlyph.visible = false;
scene.add(targetGlyph);

let isSettingTarget = false;
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const setTargetBtn = document.getElementById('set-target-btn');
const originalTargetPosition = new THREE.Vector3();

// Legacy target UI replaced by floating target popup — hide toolbar clear btn + center panel permanently
const _legacyClearTargetBtn = document.getElementById('clear-target-btn');
const _legacyTargetPanel = document.getElementById('target-panel');
if (_legacyClearTargetBtn) _legacyClearTargetBtn.style.display = 'none';
if (_legacyTargetPanel) _legacyTargetPanel.style.display = 'none';

setTargetBtn.addEventListener('click', () => {
  isSettingTarget = true;
  document.body.style.cursor = 'crosshair';
});

function showTargetPopup() {
  let popup = document.getElementById('target-popup');
  if (!popup) {
    popup = document.createElement('div');
    popup.id = 'target-popup';
    popup.className = 'object-popup';
    popup.style.cssText = 'position:absolute;z-index:500;width:220px;display:none;';
    popup.innerHTML = `
      <div class="object-popup-header">
        <span class="object-popup-name" style="color:var(--accent);">&#9678; Camera Target</span>
        <button id="target-delete-btn" title="Clear target"
          style="background:none;border:none;cursor:pointer;color:#555;font-size:22px;padding:0 2px;line-height:1;">&#128465;</button>
      </div>
      <div style="font-size:10px;color:var(--text-secondary);margin-bottom:6px;">Move target</div>
      <div class="popup-axis-row">
        <span class="axis-label">L/R</span>
        <input type="range" id="target-x" min="-2" max="2" step="0.001" value="0">
      </div>
      <div class="popup-axis-row">
        <span class="axis-label">U/D</span>
        <input type="range" id="target-y" min="-2" max="2" step="0.001" value="0">
      </div>
      <div class="popup-axis-row">
        <span class="axis-label">F/B</span>
        <input type="range" id="target-z" min="-2" max="2" step="0.001" value="0">
      </div>
      <div style="display:flex;gap:4px;margin-top:6px;">
        <button class="popup-reset-btn" id="target-reset-origin-btn" style="flex:1;">
          &#8634; Reset to Origin
        </button>
        <button class="popup-reset-btn" id="target-reset-center-btn" style="flex:1;">
          &#8857; Reset Set Position
        </button>
      </div>`;
    document.getElementById('viewport').appendChild(popup);

    document.getElementById('target-delete-btn').addEventListener('click', () => {
      clearCameraTarget();
    });

    document.getElementById('target-reset-origin-btn').addEventListener('click', () => {
      controls.target.set(0, 0, 0);
      controls.update();

      ['x', 'y', 'z'].forEach(axis => {
        const slider = document.getElementById(`target-${axis}`);
        if (slider) slider.value = 0;
      });

      requestAnimationFrame(() => {
        positionTargetPopup();
        updateTargetMarker();
      });

      markSceneModified();
    });

    document.getElementById('target-reset-center-btn').addEventListener('click', () => {
      controls.target.copy(originalTargetPosition);
      controls.update();
      updateTargetSliders();
      markSceneModified();
    });

    const targetSliderBase = {};
    ['x', 'y', 'z'].forEach(axis => {
      const slider = document.getElementById('target-' + axis);
      slider.addEventListener('mousedown', () => {
        targetSliderBase[axis] = controls.target[axis];
        slider.value = 0;
      });
      slider.addEventListener('input', () => {
        controls.target[axis] = (targetSliderBase[axis] || 0) + parseFloat(slider.value) * 0.3;
        controls.update();
        markSceneModified();
      });
    });
  }
  popup.style.display = 'block';
  positionTargetPopup();
}

function positionTargetPopup() {
  const popup = document.getElementById('target-popup');
  if (!popup || popup.style.display === 'none') return;
  const vector = controls.target.clone();
  vector.project(camera);
  const canvas = renderer.domElement;
  const vw = canvas.clientWidth;
  const vh = canvas.clientHeight;
  const x = (vector.x * 0.5 + 0.5) * vw;
  const y = (-vector.y * 0.5 + 0.5) * vh;
  const px = Math.min(x + 20, vw - 240);
  const py = Math.min(Math.max(y - 60, 40), vh - 300);
  popup.style.left = px + 'px';
  popup.style.top = py + 'px';
}

function updateTargetSliders() {
  ['x', 'y', 'z'].forEach(axis => {
    const slider = document.getElementById('target-' + axis);
    if (slider) slider.value = 0;
  });
}

function clearCameraTarget() {
  controls.target.set(0, 0, 0);
  controls.update();
  const popup = document.getElementById('target-popup');
  if (popup) popup.style.display = 'none';
  const marker = document.getElementById('target-marker');
  if (marker) marker.style.display = 'none';
  if (typeof targetGlyph !== 'undefined' && targetGlyph) targetGlyph.visible = false;
  markSceneModified();
}

function updateTargetMarker() {
  let marker = document.getElementById('target-marker');
  const popup = document.getElementById('target-popup');
  if (!popup || popup.style.display === 'none') {
    if (marker) marker.style.display = 'none';
    return;
  }
  if (!marker) {
    marker = document.createElement('div');
    marker.id = 'target-marker';
    marker.style.cssText = 'position:absolute;width:12px;height:12px;border:1.5px solid var(--accent);border-radius:50%;transform:translate(-50%,-50%);pointer-events:none;z-index:40;display:none;';
    document.getElementById('viewport').appendChild(marker);
  }
  const vector = controls.target.clone();
  vector.project(camera);
  const canvas = renderer.domElement;
  const x = (vector.x * 0.5 + 0.5) * canvas.clientWidth;
  const y = (-vector.y * 0.5 + 0.5) * canvas.clientHeight;
  marker.style.left = x + 'px';
  marker.style.top = y + 'px';
  marker.style.display = 'block';
}

let selectedObject = null;

// Mission E - object naming counters
let boxCount = 0;
let sphereCount = 0;

const scalePanel = document.getElementById('scale-panel');
// Mission E - permanently hide the legacy center-screen panel; popup replaces it
if (scalePanel) scalePanel.style.display = 'none';
const posX = document.getElementById('pos-x');
const posY = document.getElementById('pos-y');
const posZ = document.getElementById('pos-z');
const posXVal = document.getElementById('pos-x-val');
const posYVal = document.getElementById('pos-y-val');
const posZVal = document.getElementById('pos-z-val');
const posResetBtn = document.getElementById('pos-reset-btn');
const panelTitle = document.getElementById('panel-title');

const scaleX = document.getElementById('scale-x');
const scaleY = document.getElementById('scale-y');
const scaleZ = document.getElementById('scale-z');
const scaleXVal = document.getElementById('scale-x-val');
const scaleYVal = document.getElementById('scale-y-val');
const scaleZVal = document.getElementById('scale-z-val');
const scaleUniform = document.getElementById('scale-uniform');
const scaleResetBtn = document.getElementById('scale-reset-btn');

const updateTransformUI = () => {
  if (!selectedObject) return;
  
  const px = selectedObject.position.x;
  const py = selectedObject.position.y;
  const pz = selectedObject.position.z;
  posX.value = px; posY.value = py; posZ.value = pz;
  posXVal.innerText = px.toFixed(1);
  posYVal.innerText = py.toFixed(1);
  posZVal.innerText = pz.toFixed(1);

  const sx = selectedObject.scale.x;
  const sy = selectedObject.scale.y;
  const sz = selectedObject.scale.z;
  
  scaleX.value = sx;
  scaleY.value = sy;
  scaleZ.value = sz;
  scaleXVal.innerText = sx.toFixed(1);
  scaleYVal.innerText = sy.toFixed(1);
  scaleZVal.innerText = sz.toFixed(1);
  
  panelTitle.innerText = selectedObject.userData.modelName || "Object";
};

const handlePosInput = (axis, value) => {
  if (!selectedObject) return;
  let val = parseFloat(value);
  selectedObject.position[axis] = val;
  if (axis === 'x') posXVal.innerText = val.toFixed(1);
  if (axis === 'y') posYVal.innerText = val.toFixed(1);
  if (axis === 'z') posZVal.innerText = val.toFixed(1);
};

posX.addEventListener('input', (e) => handlePosInput('x', e.target.value));
posY.addEventListener('input', (e) => handlePosInput('y', e.target.value));
posZ.addEventListener('input', (e) => handlePosInput('z', e.target.value));

posResetBtn.addEventListener('click', () => {
  if (selectedObject) {
    selectedObject.position.set(0, 0, 0);
    updateTransformUI();
  }
});

const handleScaleInput = (axis, value) => {
  if (!selectedObject) return;
  let val = parseFloat(value);
  if (scaleUniform.checked) {
    selectedObject.scale.set(val, val, val);
    updateTransformUI();
  } else {
    selectedObject.scale[axis] = val;
    if (axis === 'x') scaleXVal.innerText = val.toFixed(1);
    if (axis === 'y') scaleYVal.innerText = val.toFixed(1);
    if (axis === 'z') scaleZVal.innerText = val.toFixed(1);
  }
};

scaleX.addEventListener('input', (e) => handleScaleInput('x', e.target.value));
scaleY.addEventListener('input', (e) => handleScaleInput('y', e.target.value));
scaleZ.addEventListener('input', (e) => handleScaleInput('z', e.target.value));

scaleResetBtn.addEventListener('click', () => {
  if (selectedObject) {
    selectedObject.scale.set(1, 1, 1);
    updateTransformUI();
  }
});

// ---- Mission E: Floating object popup ----
const objectPopup = document.createElement('div');
objectPopup.className = 'object-popup hidden';
objectPopup.id = 'object-popup';
objectPopup.innerHTML = `
  <div class="object-popup-header">
    <span class="object-popup-name" id="popup-name">Object</span>
    <button id="popup-delete" title="Delete object"
      style="background:none;border:none;cursor:pointer;color:#555;font-size:22px;padding:0 2px;">&#128465;</button>
  </div>
  <div id="popup-move-label" style="font-size:11px;color:#777;margin:8px 0 6px 0;">Move your object</div>
  <div class="popup-axis-row">
    <span class="axis-label">L/R</span>
    <input type="range" data-axis="x" data-type="position" min="-3" max="3" step="0.001" value="0">
  </div>
  <div class="popup-axis-row">
    <span class="axis-label">U/D</span>
    <input type="range" data-axis="y" data-type="position" min="-3" max="3" step="0.001" value="0">
  </div>
  <div class="popup-axis-row">
    <span class="axis-label">F/B</span>
    <input type="range" data-axis="z" data-type="position" min="-3" max="3" step="0.001" value="0">
  </div>
  <button class="popup-reset-btn" id="reset-position-btn"
    style="width:100%;margin:4px 0 8px 0;background:#1a1a1a;
    border:1px solid #333;border-radius:3px;color:#666;
    font-size:11px;padding:5px;cursor:pointer;">
    &#8634; Reset Position
  </button>
  <div id="popup-resize-label" style="font-size:11px;color:#777;margin:8px 0 6px 0;">Resize your object</div>
  <div class="popup-axis-row">
    <span class="axis-label">X</span>
    <input type="range" data-axis="x" data-type="scale" min="-3" max="3" step="0.001" value="0">
  </div>
  <div class="popup-axis-row">
    <span class="axis-label">Y</span>
    <input type="range" data-axis="y" data-type="scale" min="-3" max="3" step="0.001" value="0">
  </div>
  <div class="popup-axis-row">
    <span class="axis-label">Z</span>
    <input type="range" data-axis="z" data-type="scale" min="-3" max="3" step="0.001" value="0">
  </div>
  <button class="popup-reset-btn" id="reset-scale-btn"
    style="width:100%;margin:4px 0 0 0;background:#1a1a1a;
    border:1px solid #333;border-radius:3px;color:#666;
    font-size:11px;padding:5px;cursor:pointer;">
    &#8634; Reset Scale
  </button>
  <div id="popup-anim-section" style="border-top:1px solid #1e1e1e;margin-top:10px;padding-top:8px;">
    <div id="popup-anim-label" style="font-size:10px;color:#555;margin-bottom:6px;letter-spacing:1px;">ANIMATE</div>
    <div id="anim-btns" style="display:grid;grid-template-columns:1fr 1fr;gap:4px;">
      <button class="anim-btn" data-anim="none" style="grid-column:1/-1;">&#10005; No Animation</button>
      <button class="anim-btn" data-anim="float">&#11014; Float</button>
      <button class="anim-btn" data-anim="land">&#11015; Land</button>
      <button class="anim-btn" data-anim="rotate">&#8635; Rotate</button>
      <button class="anim-btn" data-anim="slide-in">&#8594; Slide In</button>
    </div>
    <button id="anim-preview-btn" style="width:100%;margin-top:6px;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:3px;color:#555;font-size:10px;padding:4px;cursor:pointer;display:none;">&#9654; Preview</button>
  </div>
`;
document.getElementById('viewport').appendChild(objectPopup);

// Localized popup labels - extracted into a function so language changes re-apply them
function _localizePopup() {
  const moveLbl = document.getElementById('popup-move-label');
  if (moveLbl) moveLbl.innerText = getTranslation('panelMove');
  const resizeLbl = document.getElementById('popup-resize-label');
  if (resizeLbl) resizeLbl.innerText = getTranslation('panelResize');
  const animLbl = document.getElementById('popup-anim-label');
  if (animLbl) animLbl.innerText = getTranslation('animate').toUpperCase();
  const animPrevBtn = document.getElementById('anim-preview-btn');
  if (animPrevBtn) animPrevBtn.innerHTML = '&#9654; ' + getTranslation('animPreview');
  const map = {
    none:       { key: 'animNone',    icon: '&#10005;' },
    float:      { key: 'animFloat',   icon: '&#11014;' },
    land:       { key: 'animLand',    icon: '&#11015;' },
    rotate:     { key: 'animRotate',  icon: '&#8635;' },
    'slide-in': { key: 'animSlideIn', icon: '&#8594;' }
  };
  document.querySelectorAll('.anim-btn').forEach(btn => {
    const m = map[btn.dataset.anim];
    if (m) btn.innerHTML = `${m.icon} ${getTranslation(m.key)}`;
  });
}
_localizePopup();

const popupSliders = objectPopup.querySelectorAll('input[type="range"]');
const sliderBaseValues = {};

objectPopup.querySelectorAll('[data-type="position"]').forEach(slider => {
  slider.addEventListener('mousedown', () => {
    if (!selectedObject) return;
    sliderBaseValues[slider.dataset.axis] = selectedObject.position[slider.dataset.axis];
    slider.value = 0;
  });
  slider.addEventListener('input', () => {
    if (!selectedObject) return;
    const base = sliderBaseValues[slider.dataset.axis] || 0;
    selectedObject.position[slider.dataset.axis] = base + parseFloat(slider.value) * 0.3;
    updateTransformUI();
    markSceneModified();
  });
});

objectPopup.querySelectorAll('[data-type="scale"]').forEach(slider => {
  slider.addEventListener('mousedown', () => {
    if (!selectedObject) return;
    sliderBaseValues['scale_' + slider.dataset.axis] = selectedObject.scale[slider.dataset.axis];
    slider.value = 0;
  });
  slider.addEventListener('input', () => {
    if (!selectedObject) return;
    const base = sliderBaseValues['scale_' + slider.dataset.axis] || 1;
    selectedObject.scale[slider.dataset.axis] = Math.max(0.01, base + parseFloat(slider.value) * 0.15);
    updateTransformUI();
    markSceneModified();
  });
});

const _popupDeleteEl = document.getElementById('popup-delete');
_popupDeleteEl.addEventListener('click', () => {
  deleteSelection();
});
_popupDeleteEl.addEventListener('mouseenter', (e) => e.target.style.color = '#cc4444');
_popupDeleteEl.addEventListener('mouseleave', (e) => e.target.style.color = '#555');

document.getElementById('reset-position-btn').addEventListener('click', () => {
  if (!selectedObject) return;
  selectedObject.position.set(0, 0, 0);
  objectPopup.querySelectorAll('[data-type="position"]').forEach(slider => {
    slider.value = 0;
  });
  updateTransformUI();
  markSceneModified();
});

document.getElementById('reset-scale-btn').addEventListener('click', () => {
  if (!selectedObject) return;
  selectedObject.scale.set(1, 1, 1);
  objectPopup.querySelectorAll('[data-type="scale"]').forEach(slider => {
    slider.value = 0;
  });
  updateTransformUI();
  markSceneModified();
});

// Animation template buttons (one click per template)
document.querySelectorAll('.anim-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (!selectedObject) return;
    const template = btn.dataset.anim;
    selectedObject.userData.animTemplate = template;
    selectedObject.userData.animStartPos = selectedObject.position.clone();
    selectedObject.userData.animStartScale = selectedObject.scale.clone();
    selectedObject.userData.animStartRotation = selectedObject.rotation.clone();
    selectedObject.userData.animStartRotY = selectedObject.rotation.y;
    selectedObject.userData.animTime = 0;

    document.querySelectorAll('.anim-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    const previewBtn = document.getElementById('anim-preview-btn');
    if (previewBtn) previewBtn.style.display = template === 'none' ? 'none' : 'block';

    markSceneModified();
  });
});

// Preview - reset time and snap back to start state
document.getElementById('anim-preview-btn').addEventListener('click', () => {
  if (!selectedObject || !selectedObject.userData.animTemplate || selectedObject.userData.animTemplate === 'none') return;
  selectedObject.userData.animTime = 0;
  if (selectedObject.userData.animStartPos) selectedObject.position.copy(selectedObject.userData.animStartPos);
  if (selectedObject.userData.animStartScale) selectedObject.scale.copy(selectedObject.userData.animStartScale);
  if (selectedObject.userData.animStartRotation) selectedObject.rotation.copy(selectedObject.userData.animStartRotation);
});

// Double-click rename - UUID-safe (popup may outlive selection changes mid-edit)
objectPopup.addEventListener('dblclick', (e) => {
  if (!e.target.classList || !e.target.classList.contains('object-popup-name')) return;
  const editingUuid = objectPopup.dataset.uuid;
  if (!editingUuid) return;
  let editingObj = null;
  scene.traverse(o => { if (o.uuid === editingUuid) editingObj = o; });
  if (!editingObj) return;
  const nameEl = e.target;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = editingObj.userData.name || '';
  input.className = 'object-popup-name editing';
  input.style.cssText = 'width:100px;font-size:12px;';
  nameEl.replaceWith(input);
  input.focus();
  input.select();
  let restored = false;
  const restore = (newName) => {
    if (restored) return;
    restored = true;
    let target = null;
    scene.traverse(o => { if (o.uuid === editingUuid) target = o; });
    if (target && newName !== null) {
      const trimmed = (newName || '').trim();
      target.userData.name = trimmed || target.userData.name;
    }
    nameEl.textContent = target ? target.userData.name : (newName || '');
    input.replaceWith(nameEl);
    updateLayersPanel();
    markSceneModified();
  };
  input.addEventListener('blur', () => restore(input.value));
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); restore(input.value); }
    else if (ev.key === 'Escape') { ev.preventDefault(); restore(null); }
  });
});

function showObjectPopup(obj) {
  if (!obj) return;
  objectPopup.classList.remove('hidden');
  objectPopup.dataset.uuid = obj.uuid;
  const nameEl = document.getElementById('popup-name');
  if (nameEl) nameEl.textContent = obj.userData.name || obj.userData.modelName || 'Object';
  // Delta-mode: sliders open centered; mousedown captures the live base value
  popupSliders.forEach(s => { s.value = 0; });
  // Sync animation buttons to the selected object's saved template
  const currentAnim = obj.userData.animTemplate || 'none';
  document.querySelectorAll('.anim-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.anim === currentAnim);
  });
  const _animPreview = document.getElementById('anim-preview-btn');
  if (_animPreview) _animPreview.style.display = currentAnim === 'none' ? 'none' : 'block';
  updatePopupPosition();
}

function hideObjectPopup() {
  objectPopup.classList.add('hidden');
}

function getScreenPosition(object) {
  const vector = new THREE.Vector3();
  object.getWorldPosition(vector);
  vector.project(camera);
  const rect = renderer.domElement.getBoundingClientRect();
  const x = (vector.x * 0.5 + 0.5) * rect.width;
  const y = (-vector.y * 0.5 + 0.5) * rect.height;
  return { x, y };
}

function updatePopupPosition() {
  if (!selectedObject || objectPopup.classList.contains('hidden')) return;
  const pos = getScreenPosition(selectedObject);
  const rect = renderer.domElement.getBoundingClientRect();
  const x = Math.min(pos.x + 20, rect.width - 240);
  const y = Math.min(Math.max(pos.y - 60, 40), rect.height - 300);
  objectPopup.style.left = x + 'px';
  objectPopup.style.top = y + 'px';
}

_popupReady = true;

// ---- Mission F: Layers panel ----
function _layersI18n(key) {
  const lang = localStorage.getItem('refluent_lang') || 'en';
  const strs = {
    layers:    { en: 'Layers',             kr: '레이어' },
    noObjects: { en: 'No objects in scene', kr: '씬에 오브젝트 없음' }
  };
  return (strs[key] && strs[key][lang]) || strs[key].en;
}

function _clearObjectHighlight(obj) {
  if (!obj) return;
  obj.traverse(child => {
    if (child.isMesh && child.material && child.userData.originalEmissive !== undefined) {
      child.material.emissive.setHex(child.userData.originalEmissive);
    }
  });
}

function _applyObjectHighlight(obj) {
  if (!obj) return;
  obj.traverse(child => {
    if (child.isMesh && child.material) {
      if (child.userData.originalEmissive === undefined) {
        child.userData.originalEmissive = child.material.emissive ? child.material.emissive.getHex() : 0x000000;
      }
      child.material.emissive.setHex(0x555555);
    }
  });
}

function selectObject(obj) {
  if (selectedObject && selectedObject !== obj) _clearObjectHighlight(selectedObject);
  selectedObject = obj;
  if (obj) {
    _applyObjectHighlight(obj);
    updateTransformUI();
  }
}

const layersPanel = document.createElement('div');
layersPanel.id = 'layers-panel';
layersPanel.innerHTML = `
  <div id="layers-header">${_layersI18n('layers')}</div>
  <div id="layers-list">
    <div id="layers-empty">${_layersI18n('noObjects')}</div>
  </div>`;
document.getElementById('viewport').appendChild(layersPanel);
layersPanel.style.top = '206px';

function updateLayersPanel() {
  const list = document.getElementById('layers-list');
  document.getElementById('layers-header').textContent = _layersI18n('layers');
  const sceneObjects = scene.children.filter(c => c.userData && c.userData.isUserObject);

  if (sceneObjects.length === 0) {
    list.innerHTML = `<div id="layers-empty">${_layersI18n('noObjects')}</div>`;
    return;
  }

  list.innerHTML = '';
  sceneObjects.forEach(obj => {
    const item = document.createElement('div');
    item.className = 'layer-item' + (obj === selectedObject ? ' selected' : '');
    item.dataset.uuid = obj.uuid;
    const nameSpan = document.createElement('span');
    nameSpan.className = 'layer-item-name';
    nameSpan.textContent = obj.userData.name || 'Object';
    const delBtn = document.createElement('button');
    delBtn.className = 'layer-item-delete';
    delBtn.title = 'Delete';
    delBtn.innerHTML = '&#128465;';
    item.appendChild(nameSpan);
    item.appendChild(delBtn);

    item.addEventListener('click', (e) => {
      if (e.target.classList.contains('layer-item-delete')) return;
      if (e.target.classList.contains('layer-item-name')) return;
      selectObject(obj);
      showObjectPopup(obj);
      updateLayersPanel();
    });

    nameSpan.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      const input = document.createElement('input');
      input.type = 'text';
      input.value = obj.userData.name || 'Object';
      input.style.cssText = 'width:120px;background:#1a1a1a;border:1px solid #555;border-radius:3px;color:#fff;font-size:11px;padding:1px 4px;outline:none;';
      nameSpan.replaceWith(input);
      input.focus();
      input.select();

      let done = false;
      const confirmRename = () => {
        if (done) return;
        done = true;
        const newName = input.value.trim();
        if (newName) {
          scene.traverse(sceneObj => {
            if (sceneObj.uuid === obj.uuid) {
              sceneObj.userData.name = newName;
            }
          });
          const popup = document.getElementById('object-popup');
          if (popup && popup.dataset.uuid === obj.uuid) {
            const popupName = document.getElementById('popup-name');
            if (popupName) popupName.textContent = newName;
          }
          markSceneModified();
        }
        updateLayersPanel();
      };

      input.addEventListener('blur', confirmRename);
      input.addEventListener('keydown', ev => {
        if (ev.key === 'Enter') { ev.preventDefault(); confirmRename(); }
        else if (ev.key === 'Escape') { ev.preventDefault(); done = true; updateLayersPanel(); }
      });
    });

    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      scene.remove(obj);
      if (selectedObject === obj) {
        selectedObject = null;
        hideObjectPopup();
      }
      updateLayersPanel();
      markSceneModified();
    });

    list.appendChild(item);
  });
}

updateLayersPanel();


let isSKeyDown = false;
let isGKeyDown = false;
let isTKeyDown = false;

function _isTypingTarget() {
  const ae = document.activeElement;
  if (!ae) return false;
  const tag = ae.tagName ? ae.tagName.toLowerCase() : '';
  return tag === 'input' || tag === 'textarea' || ae.isContentEditable;
}

window.addEventListener('keydown', (e) => {
  if (_isTypingTarget()) return;
  if (e.key.toLowerCase() === 's') {
    isSKeyDown = true;
    controls.enableZoom = false;
  }
  if (e.key.toLowerCase() === 'g') {
    isGKeyDown = true;
    controls.enableZoom = false;
  }
  if (e.key.toLowerCase() === 't') {
    isTKeyDown = true;
    controls.enableZoom = false;
  }
});
window.addEventListener('keyup', (e) => {
  if (_isTypingTarget()) return;
  if (e.key.toLowerCase() === 's') {
    isSKeyDown = false;
    if (!isGKeyDown && !isTKeyDown) controls.enableZoom = true;
  }
  if (e.key.toLowerCase() === 'g') {
    isGKeyDown = false;
    if (!isSKeyDown && !isTKeyDown) controls.enableZoom = true;
  }
  if (e.key.toLowerCase() === 't') {
    isTKeyDown = false;
    if (!isSKeyDown && !isGKeyDown) controls.enableZoom = true;
  }
});

renderer.domElement.addEventListener('wheel', (e) => {
  let handled = false;
  if (selectedObject) {
    if (isSKeyDown) {
      e.preventDefault();
      e.stopPropagation();
      const delta = e.deltaY < 0 ? 0.1 : -0.1;
      let newScale = selectedObject.scale.x + delta;
      newScale = Math.max(0.1, Math.min(10, newScale));
      selectedObject.scale.set(newScale, newScale, newScale);
      updateTransformUI();
      handled = true;
    } else if (isGKeyDown) {
      e.preventDefault();
      e.stopPropagation();
      const delta = e.deltaY < 0 ? 0.1 : -0.1;
      let newY = selectedObject.position.y + delta;
      newY = Math.max(-20, Math.min(20, newY));
      selectedObject.position.y = newY;
      updateTransformUI();
      handled = true;
    }
  }
  
  if (!handled && isTKeyDown && !selectedObject) {
    const _tgtPopup = document.getElementById('target-popup');
    if (_tgtPopup && _tgtPopup.style.display === 'block') {
      e.preventDefault();
      e.stopPropagation();
      const delta = e.deltaY < 0 ? 0.1 : -0.1;
      let newY = controls.target.y + delta;
      newY = Math.max(-20, Math.min(20, newY));
      controls.target.y = newY;
      targetGlyph.position.y = newY;
      controls.update();
      markSceneModified();
    }
  }
}, { passive: false });

const deleteSelection = () => {
  if (selectedObject) {
    scene.remove(selectedObject);
    selectedObject = null;
    scalePanel.classList.add('hidden');
    hideObjectPopup();
    updateLayersPanel();
    markSceneModified();
  }
};

window.addEventListener('keyup', (e) => {
  if (_isTypingTarget()) return;
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (!isSettingTarget) deleteSelection();
  }
});

document.getElementById('clear-scene-btn').addEventListener('click', () => {
  if (confirm(getTranslation('confirmClearScene'))) {
    const toRemove = scene.children.filter(c => c.userData.isUserObject);
    toRemove.forEach(obj => scene.remove(obj));
    if (selectedObject) {
      selectedObject = null;
      scalePanel.classList.add('hidden');
      hideObjectPopup();
    }
    const targetPopup = document.getElementById('target-popup');
    if (targetPopup) targetPopup.style.display = 'none';
    const targetMarker = document.getElementById('target-marker');
    if (targetMarker) targetMarker.style.display = 'none';
    updateLayersPanel();
    markSceneModified();
  }
});

function getMouseNDC(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * 2 - 1,
    y: -((event.clientY - rect.top) / rect.height) * 2 + 1
  };
}

renderer.domElement.addEventListener('pointerdown', (event) => {
  const ndc = getMouseNDC(event);
  mouse.x = ndc.x;
  mouse.y = ndc.y;

  raycaster.setFromCamera(mouse, camera);

  if (isSettingTarget) {
    const intersects = raycaster.intersectObjects(scene.children, true);
    
    let hitFound = false;
    for (let i = 0; i < intersects.length; i++) {
      // Ignore grid, glyph, and lights
      if (intersects[i].object !== targetGlyph && intersects[i].object !== gridHelper) {
        controls.target.copy(intersects[i].point);
        targetGlyph.position.copy(intersects[i].point);
        hitFound = true;
        break;
      }
    }
    
    // Fallback if we hit empty space or only grid/glyph
    if (!hitFound) {
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const intersectPoint = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(plane, intersectPoint)) {
        controls.target.copy(intersectPoint);
        targetGlyph.position.copy(intersectPoint);
        hitFound = true;
      }
    }

    if (hitFound) {
      originalTargetPosition.copy(controls.target);
      showTargetPopup();
    }

    isSettingTarget = false;
    document.body.style.cursor = 'default';
  } else {
    // Selection Mode
    const userMeshes = scene.children.filter(c => c.userData.isUserObject);
    const intersects = raycaster.intersectObjects(userMeshes, true);
    
    // Clear previous selection highlight
    if (selectedObject) {
      selectedObject.traverse(child => {
        if (child.isMesh && child.material && child.userData.originalEmissive !== undefined) {
          child.material.emissive.setHex(child.userData.originalEmissive);
        }
      });
      selectedObject = null;
    }
    
    if (intersects.length > 0) {
      let topUserObj = intersects[0].object;
      while (topUserObj && !topUserObj.userData?.isUserObject && topUserObj.parent) {
        topUserObj = topUserObj.parent;
      }
      
      if (topUserObj && topUserObj.userData.isUserObject) {
        selectedObject = topUserObj;
        
        selectedObject.traverse(child => {
          if (child.isMesh && child.material) {
            if (child.userData.originalEmissive === undefined) {
              child.userData.originalEmissive = child.material.emissive ? child.material.emissive.getHex() : 0x000000;
            }
            child.material.emissive.setHex(0x555555);
          }
        });
        
        updateTransformUI();
        showObjectPopup(selectedObject);
      }
      updateLayersPanel();
    } else {
      hideObjectPopup();
      updateLayersPanel();
    }
  }
});

document.getElementById('add-box-btn').addEventListener('click', () => {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshStandardMaterial({ color: 0x007bff, roughness: 0.4 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = 0.5;
  mesh.userData.isUserObject = true;
  mesh.userData.modelName = "Box";
  mesh.userData.type = "box";
  boxCount++;
  mesh.userData.name = "Box" + boxCount;
  scene.add(mesh);
  updateLayersPanel();
  markSceneModified();
});

document.getElementById('add-sphere-btn').addEventListener('click', () => {
  const geometry = new THREE.SphereGeometry(0.6, 32, 32);
  const material = new THREE.MeshStandardMaterial({ color: 0xff3366, roughness: 0.4 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = 0.6;
  mesh.position.x = 2;
  mesh.userData.isUserObject = true;
  mesh.userData.modelName = "Sphere";
  mesh.userData.type = "sphere";
  sphereCount++;
  mesh.userData.name = "Sphere" + sphereCount;
  scene.add(mesh);
  updateLayersPanel();
  markSceneModified();
});

const loadingOverlay = document.getElementById('loading-overlay');
const loadingText = document.getElementById('loading-text');

document.getElementById('import-model-btn').addEventListener('click', async () => {
  const filePath = await window.electronAPI.openModel();
  if (!filePath) return;

  loadingOverlay.classList.remove('hidden');
  loadingText.innerText = getTranslation('loadingModel');

  const ext = filePath.split('.').pop().toLowerCase();

  const fileUrl = encodeURI(`file:///${filePath.replace(/\\/g, '/')}`);

  const fileName = filePath.split('\\').pop().split('/').pop();
  const nameWithoutExt = fileName.substring(0, fileName.lastIndexOf('.'));

  // Mission H - capture file as base64 for scene save embedding
  let modelDataB64 = null;
  try {
    modelDataB64 = await window.electronAPI.readFileBase64(filePath);
  } catch (err) {
    console.warn('[Mission H] Could not read model file as base64:', err);
  }

  const onLoad = (object) => {
    const root = object.scene || object;
    
    // Auto-center and scale
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3()).length();
    const center = box.getCenter(new THREE.Vector3());
    
    // Center native bounds securely to pivot
    root.position.x -= center.x;
    root.position.y -= center.y;
    root.position.z -= center.z;
    
    const wrapper = new THREE.Group();
    wrapper.add(root);

    const scale =  5 / size;
    wrapper.scale.set(scale, scale, scale);
    wrapper.position.y += 2.5; 
    
    wrapper.userData.isUserObject = true;
    wrapper.userData.modelName = nameWithoutExt;
    wrapper.userData.type = 'imported';
    if (modelDataB64) {
      wrapper.userData.modelData = modelDataB64;
      wrapper.userData.modelFormat = ext;
    }
    wrapper.userData.name = nameWithoutExt
      ? nameWithoutExt.charAt(0).toUpperCase() + nameWithoutExt.slice(1)
      : 'Model';
    scene.add(wrapper);
    updateLayersPanel();
    markSceneModified();
    loadingOverlay.classList.add('hidden');
  };

  const onError = (e) => {
    console.error(e);
    loadingText.innerText = getTranslation('errorLoading');
    setTimeout(() => loadingOverlay.classList.add('hidden'), 2000);
  };

  if (ext === 'obj') {
    const loader = new OBJLoader();
    loader.load(fileUrl, onLoad, undefined, onError);
  } else if (ext === 'glb' || ext === 'gltf') {
    const loader = new GLTFLoader();
    loader.load(fileUrl, onLoad, undefined, onError);
  }
});

// ---- Recording Setup ----
let mediaRecorder = null;
let recordedChunks = [];
let recordingStartTime = 0;
let recordingInterval = null;

const buttonsToDisable = [
  'record-btn', 'stop-btn', 'add-box-btn', 'add-sphere-btn', 'import-model-btn', 'clear-scene-btn', 'set-target-btn', 'clear-target-btn', 'cam-play-btn', 'cam-stop-btn'
];

function disableButtons() {
  buttonsToDisable.forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.disabled = true;
  });
}

function enableButtons() {
  buttonsToDisable.forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.disabled = false;
  });
}

window.electronAPI.onProgress((event, percent) => {
  const fill = document.getElementById('export-progress-fill');
  const text = document.getElementById('export-progress-text');
  if (percent >= 0) {
    fill.style.width = percent + '%';
    fill.style.animation = 'none';
    text.textContent = Math.round(percent) + '%';
  } else {
    fill.style.width = '100%';
    fill.style.animation = 'pulse 1.5s ease-in-out infinite';
    text.textContent = '...';
  }
});

const recordBtn = document.getElementById('record-btn');
const stopBtn = document.getElementById('stop-btn');
const timeDisplay = document.getElementById('recording-time');

function resetRecordingTimer() {
  clearInterval(recordingInterval);
  recordingInterval = null;
  timeDisplay.textContent = '00:00';
}

// Mission G - persistent MP4 save folder
let mp4SaveFolder = localStorage.getItem('refluent_mp4_folder') || null;

window.electronAPI.onMp4FolderChanged((folder) => {
  if (folder) {
    mp4SaveFolder = folder;
    localStorage.setItem('refluent_mp4_folder', folder);
  }
});

async function ensureMp4Folder() {
  if (mp4SaveFolder) return mp4SaveFolder;
  const folder = await window.electronAPI.selectMp4Folder();
  if (folder) {
    mp4SaveFolder = folder;
    localStorage.setItem('refluent_mp4_folder', folder);
  }
  return folder;
}

function getNextMp4Filename() {
  const count = parseInt(localStorage.getItem('refluent_mp4_count') || '0', 10) + 1;
  localStorage.setItem('refluent_mp4_count', String(count));
  return `Refluent_${String(count).padStart(3, '0')}.mp4`;
}

function _missingFolderMessage() {
  const lang = localStorage.getItem('refluent_lang') || 'en';
  return lang === 'kr' ? '녹화하려면 저장 폴더를 선택해주세요.' : 'Please select a save folder to record.';
}

recordBtn.addEventListener('click', async () => {
  recordedChunks = [];

  const userObjects = scene.children.filter(c => c.userData.isUserObject);
  if (userObjects.length === 0) {
    alert(getTranslation('noObjectsWarning'));
    return;
  }

  const folder = await ensureMp4Folder();
  if (!folder) {
    alert(_missingFolderMessage());
    return;
  }
  
  // Save visibility states
  const gridWasVisible = gridHelper.visible;
  const glyphWasVisible = targetGlyph.visible;
  const gizmoDisplay = gizmoRenderer.domElement.style.display;
  
  // Hide elements for recording (safe-frame stays visible — DOM overlays
  // aren't captured by canvas.captureStream, and it serves as composition guide)
  gridHelper.visible = false;
  targetGlyph.visible = false;
  gizmoRenderer.domElement.style.display = 'none';
  
  const stream = renderer.domElement.captureStream(30); 
  
  const mimeType = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ].find(type => MediaRecorder.isTypeSupported(type));

  // Bulletproof helper restore — call from every exit path
  function _restoreRecordingHelpers() {
    if (gridHelper) gridHelper.visible = gridWasVisible;
    if (targetGlyph) targetGlyph.visible = glyphWasVisible;
    if (gizmoRenderer && gizmoRenderer.domElement) gizmoRenderer.domElement.style.display = gizmoDisplay;
  }

  try {
    mediaRecorder = new MediaRecorder(stream, {
      mimeType: mimeType,
      videoBitsPerSecond: 8000000
    });
  } catch (e) {
    console.error('MediaRecorder not supported', e);
    _restoreRecordingHelpers();
    alert(getTranslation('mediaRecNotSupported'));
    return;
  }

  mediaRecorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      recordedChunks.push(event.data);
      console.log('Chunk received, size:', event.data.size);
    }
  };

  mediaRecorder.onstop = async () => {
    resetRecordingTimer();

    // Restore helpers FIRST so they come back even on early-exit paths (no chunks, errors)
    _restoreRecordingHelpers();

    if (recordedChunks.length === 0) {
      console.log('No chunks recorded');
      return;
    }

    const blob = new Blob(recordedChunks, { type: mimeType });
    const arrayBuffer = await blob.arrayBuffer();
    
    const duration = (Date.now() - recordingStartTime) / 1000;
    disableButtons();
    document.getElementById('export-overlay').classList.remove('hidden');
    
    const outputFilename = getNextMp4Filename();
    const ratio = document.getElementById('ratio-select')?.value || '16:9';
    const result = await window.electronAPI.convertWebmToMp4({
      arrayBuffer,
      duration,
      outputFolder: mp4SaveFolder,
      outputFilename,
      ratio
    });
    
    document.getElementById('export-overlay').classList.add('hidden');
    enableButtons();
    
    if (result.success) {
      console.log('Saved to', result.filePath);
      pipelineState.mp4Path = result.filePath;
      pipelineState.mp4Filename = result.filePath.split(/[\\/]/).pop();
      const _s1c = document.querySelector('.step-card[data-step="0"] .step-content');
      if (_s1c) _s1c.innerHTML = `<div style="font-size:9px;color:#aaa;padding:4px;word-break:break-all;">${pipelineState.mp4Filename}</div>`;
      activateStep(1);
    } else {
      if (result.message !== 'Canceled by user') {
        alert(getTranslation('exportFailed') + result.message);
      }
    }
  };

  mediaRecorder.start(100);
  recordingStartTime = Date.now();
  console.log('MediaRecorder started');
  
  recordingInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
    const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const secs = String(elapsed % 60).padStart(2, '0');
    timeDisplay.textContent = `${mins}:${secs}`;
  }, 1000);

  recordBtn.classList.add('hidden');
  stopBtn.classList.remove('hidden');
  timeDisplay.classList.remove('hidden');
});

stopBtn.addEventListener('click', () => {
  if (!mediaRecorder || mediaRecorder.state === 'inactive') {
    return;
  }

  if (Date.now() - recordingStartTime < 1000) {
    alert(getTranslation('recordingTooShort'));
    recordedChunks = [];
    if (mediaRecorder.state !== 'inactive') {
      mediaRecorder.onstop = null;
      mediaRecorder.stop();
    }
  } else {
    if (mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
  }

  resetRecordingTimer();
  recordBtn.classList.remove('hidden');
  stopBtn.classList.add('hidden');
  timeDisplay.classList.add('hidden');
});

// ---- Camera Animation Setup ----
// Mission C: inject Dolly Zoom radio into the camera-type group
(function injectDollyZoomRadio() {
  const group = document.getElementById('cam-move-radios');
  if (!group || document.getElementById('cam-dolly-zoom')) return;
  const input = document.createElement('input');
  input.type = 'radio';
  input.id = 'cam-dolly-zoom';
  input.name = 'camType';
  input.value = 'dollyZoom';
  const lbl = document.createElement('label');
  lbl.setAttribute('for', 'cam-dolly-zoom');
  lbl.setAttribute('data-i18n', 'dollyZoom');
  lbl.innerText = getTranslation('dollyZoom');
  group.appendChild(input);
  group.appendChild(lbl);
})();

const camRadios = document.querySelectorAll('input[name="camType"]');
const camDirSection = document.getElementById('cam-dir-section');
const lblDir1 = document.getElementById('lbl-dir-1');
const lblDir2 = document.getElementById('lbl-dir-2');
const camDirBtn1 = document.getElementById('cam-dir-btn1');
const camDirBtn2 = document.getElementById('cam-dir-btn2');

const camSpeedSlider = document.getElementById('cam-speed');
const camSpeedVal = document.getElementById('cam-speed-val');
const camDurSlider = document.getElementById('cam-duration');
const camDurVal = document.getElementById('cam-duration-val');
const camLockTarget = document.getElementById('cam-lock-target');

const camPlayBtn = document.getElementById('cam-play-btn');
const camLoopBtn = document.getElementById('cam-loop-btn');
const camStopBtn = document.getElementById('cam-stop-btn');
const camStatus = document.getElementById('cam-status');

// --- Record with Movement toggle ---
let recordWithMovement = false;
const recWithMoveBtn = document.getElementById('rec-with-move-btn');

function updateRecWithMoveVisual() {
  if (recordWithMovement) {
    recWithMoveBtn.style.background = 'var(--danger)';
    recWithMoveBtn.style.borderColor = 'var(--danger)';
    recWithMoveBtn.style.color = '#fff';
    recWithMoveBtn.title = getTranslation('recWithMoveOn');
  } else {
    recWithMoveBtn.style.background = 'transparent';
    recWithMoveBtn.style.borderColor = 'transparent';
    recWithMoveBtn.style.color = 'var(--text-secondary)';
    recWithMoveBtn.title = getTranslation('recWithMoveOff');
  }
}
recWithMoveBtn.innerHTML = '&#9210; Auto-Recording';
recWithMoveBtn.title = getTranslation('recWithMoveOff');

recWithMoveBtn.addEventListener('click', () => {
  recordWithMovement = !recordWithMovement;
  updateRecWithMoveVisual();
});

camSpeedSlider.addEventListener('input', (e) => {
  camSpeedVal.innerText = parseFloat(e.target.value).toFixed(1);
});
camDurSlider.addEventListener('input', (e) => {
  camDurVal.innerText = e.target.value;
});

let currentCamType = 'pushIn';
camRadios.forEach(r => {
  r.addEventListener('change', (e) => {
    currentCamType = e.target.value;

    if (currentCamType === 'dollyZoom') {
      camSpeedSlider.max = '20.0';
    } else {
      camSpeedSlider.max = '5.0';
      if (parseFloat(camSpeedSlider.value) > 5.0) {
        camSpeedSlider.value = '5.0';
        camSpeedVal.innerText = '5.0';
      }
    }

    if (currentCamType === 'pushIn' || currentCamType === 'pullOut') {
      camDirSection.style.display = 'none';
    } else {
      camDirSection.style.display = 'flex';
      if (currentCamType === 'tilt') {
        lblDir1.innerText = getTranslation('up');
        lblDir1.setAttribute('data-i18n', 'up');
        lblDir2.innerText = getTranslation('down');
        lblDir2.setAttribute('data-i18n', 'down');
      } else if (currentCamType === 'dollyZoom') {
        lblDir1.innerText = getTranslation('inDir');
        lblDir1.setAttribute('data-i18n', 'inDir');
        lblDir2.innerText = getTranslation('outDir');
        lblDir2.setAttribute('data-i18n', 'outDir');
      } else {
        lblDir1.innerText = getTranslation('left');
        lblDir1.setAttribute('data-i18n', 'left');
        lblDir2.innerText = getTranslation('right');
        lblDir2.setAttribute('data-i18n', 'right');
      }
    }
  });
});

let camAnimState = 'idle'; // idle, playing, looping, stopping
let animClock = new THREE.Clock(false);
let animTimeElapsed = 0;
let animDuration = 5;

let animStartPos = new THREE.Vector3();
let animStartQuat = new THREE.Quaternion();
let animStartTarget = new THREE.Vector3();

let stopEaseTime = 0;
let stopEaseDuration = 0.5;
let stopStartPos = new THREE.Vector3();
let stopStartQuat = new THREE.Quaternion();

// Dolly Zoom state (Mission C)
let dzInitialized = false;
let dzStartFov = 0;
let dzTargetFovAnim = 0;
let dzStartPos = new THREE.Vector3();
let dzTargetPos = new THREE.Vector3();

function updateCamStatus() {
  if (recordWithMovement
      && (camAnimState === 'playing' || camAnimState === 'looping')
      && mediaRecorder && mediaRecorder.state === 'recording') {
    camStatus.innerText = '● ' + getTranslation('autoRecording');
    camStatus.style.color = 'var(--danger)';
    camStatus.removeAttribute('data-i18n');
    return;
  }
  camStatus.style.color = '';
  if (camAnimState === 'idle') {
    camStatus.innerText = getTranslation('ready');
    camStatus.setAttribute('data-i18n', 'ready');
  } else if (camAnimState === 'playing') {
    camStatus.innerText = getTranslation('playing');
    camStatus.setAttribute('data-i18n', 'playing');
  } else if (camAnimState === 'looping') {
    camStatus.innerText = getTranslation('looping');
    camStatus.setAttribute('data-i18n', 'looping');
  } else if (camAnimState === 'stopping') {
    camStatus.innerText = getTranslation('stopping');
    camStatus.setAttribute('data-i18n', 'stopping');
  }
}

let animIsLoop = false;
camLoopBtn.addEventListener('click', () => {
  animIsLoop = !animIsLoop;
  if (animIsLoop) camLoopBtn.classList.add('active');
  else camLoopBtn.classList.remove('active');
  
  if (camAnimState === 'playing' && animIsLoop) {
    camAnimState = 'looping';
    updateCamStatus();
  } else if (camAnimState === 'looping' && !animIsLoop) {
    camAnimState = 'playing';
    updateCamStatus();
  }
});

function startCameraMove() {
  if (camAnimState === 'idle' || camAnimState === 'stopping') {
    animStartPos.copy(camera.position);
    animStartQuat.copy(camera.quaternion);
    animStartTarget.copy(controls.target);
  }

  camera.position.copy(animStartPos);
  camera.quaternion.copy(animStartQuat);
  controls.target.copy(animStartTarget);
  controls.update();

  dzInitialized = false;

  animTimeElapsed = 0;
  animDuration = parseFloat(camDurSlider.value);
  animClock.start();
  
  camAnimState = animIsLoop ? 'looping' : 'playing';
  updateCamStatus();
  controls.enabled = false;
}

camPlayBtn.addEventListener('click', () => {
  if (recordWithMovement && (!mediaRecorder || mediaRecorder.state === 'inactive')) {
    recordBtn.click();
  }
  startCameraMove();
  updateCamStatus();
});

camStopBtn.addEventListener('click', () => {
  if (camAnimState !== 'idle' && camAnimState !== 'stopping') {
    stopStartPos.copy(camera.position);
    stopStartQuat.copy(camera.quaternion);
    stopEaseTime = 0;
    camAnimState = 'stopping';
    updateCamStatus();
  }
  if (recordWithMovement && mediaRecorder && mediaRecorder.state === 'recording') {
    setTimeout(() => {
      if (mediaRecorder && mediaRecorder.state === 'recording'
          && !stopBtn.classList.contains('hidden')) {
        stopBtn.click();
      }
    }, 500);
  }
});

function easeInOutQuad(t) {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

updateCameraAnimation = function() {
  if (camAnimState === 'idle') return false;
  
  if (camAnimState === 'stopping') {
    const delta = animClock.getDelta();
    stopEaseTime += delta;
    let t = stopEaseTime / stopEaseDuration;
    if (t >= 1) {
      t = 1;
      camAnimState = 'idle';
      controls.enabled = true;
      camera.position.copy(animStartPos);
      camera.quaternion.copy(animStartQuat);
      controls.target.copy(animStartTarget);
      controls.update();
      updateCamStatus();
      animClock.stop();
      if (recordWithMovement && mediaRecorder && mediaRecorder.state === 'recording') {
        setTimeout(() => {
          if (!stopBtn.classList.contains('hidden')) stopBtn.click();
        }, 500);
      }
      return false; // tell animate we are idle
    }
    const easeT = easeInOutQuad(t);
    camera.position.lerpVectors(stopStartPos, animStartPos, easeT);
    camera.quaternion.slerpQuaternions(stopStartQuat, animStartQuat, easeT);
    controls.update();
    return true;
  }
  
  const delta = animClock.getDelta();
  animTimeElapsed += delta;
  
  if (animTimeElapsed >= animDuration) {
    if (animIsLoop) {
      animTimeElapsed -= animDuration;
      camera.position.copy(animStartPos);
      camera.quaternion.copy(animStartQuat);
      controls.target.copy(animStartTarget);
      if (recordWithMovement && mediaRecorder && mediaRecorder.state === 'recording') {
        if (!stopBtn.classList.contains('hidden')) stopBtn.click();
        setTimeout(() => {
          if (recordWithMovement && (!mediaRecorder || mediaRecorder.state === 'inactive')) {
            recordBtn.click();
          }
        }, 1500);
      }
    } else {
      stopStartPos.copy(camera.position);
      stopStartQuat.copy(camera.quaternion);
      stopEaseTime = 0;
      camAnimState = 'stopping';
      updateCamStatus();
      return true;
    }
  }

  const speed = parseFloat(camSpeedSlider.value);
  const dirValue = parseFloat(document.querySelector('input[name="camDir"]:checked').value);
  
  let viewDir = new THREE.Vector3();
  camera.getWorldDirection(viewDir); // Normalized automatically
  
  let rightDir = new THREE.Vector3();
  rightDir.crossVectors(viewDir, camera.up).normalize();

  if (currentCamType === 'pushIn') {
    camera.position.addScaledVector(viewDir, speed * delta);
  } else if (currentCamType === 'pullOut') {
    camera.position.addScaledVector(viewDir, -speed * delta);
  } else if (currentCamType === 'dolly') {
    // dirValue: 1 (Left), -1 (Right)
    camera.position.addScaledVector(rightDir, -dirValue * speed * delta);
  } else if (currentCamType === 'pan') {
    if (camLockTarget.checked) {
      const target = controls.target.clone();
      const offset = camera.position.clone().sub(target);
      offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), dirValue * speed * delta);
      camera.position.copy(target).add(offset);
      camera.lookAt(target);
      controls.update();
    } else {
      const yAxis = new THREE.Vector3(0, 1, 0);
      camera.rotateOnWorldAxis(yAxis, dirValue * speed * delta);
    }
  } else if (currentCamType === 'tilt') {
    if (camLockTarget.checked) {
      const target = controls.target.clone();
      const offset = camera.position.clone().sub(target);
      const rightAxis = new THREE.Vector3().crossVectors(offset, camera.up).normalize();
      offset.applyAxisAngle(rightAxis, dirValue * speed * delta);
      camera.position.copy(target).add(offset);
      camera.lookAt(target);
      controls.update();
    } else {
      const xAxis = new THREE.Vector3(1, 0, 0);
      camera.rotateOnAxis(xAxis, dirValue * speed * delta);
    }
  } else if (currentCamType === 'dollyZoom') {
    if (!dzInitialized) {
      dzStartFov = camera.fov;
      dzStartPos.copy(camera.position);
      const targetVec = controls.target.clone();
      const startDist = camera.position.distanceTo(controls.target);
      const fovDelta = -25 * speed * dirValue;
      dzTargetFovAnim = THREE.MathUtils.clamp(dzStartFov + fovDelta, 5, 150);
      const fovRatio = Math.tan(THREE.MathUtils.degToRad(dzTargetFovAnim / 2)) /
                       Math.tan(THREE.MathUtils.degToRad(dzStartFov / 2));
      const targetDist = startDist * fovRatio;
      const moveDir = dzStartPos.clone().sub(targetVec).normalize();
      dzTargetPos.copy(targetVec).add(moveDir.multiplyScalar(targetDist));
      dzInitialized = true;
    }
    const t = Math.min(animTimeElapsed / animDuration, 1);
    const ease = easeInOutQuad(t);
    camera.fov = THREE.MathUtils.lerp(dzStartFov, dzTargetFovAnim, ease);
    targetFov = camera.fov;
    camera.position.lerpVectors(dzStartPos, dzTargetPos, ease);
    camera.updateProjectionMatrix();
  }

  if (camLockTarget.checked && currentCamType !== 'pan' && currentCamType !== 'tilt' && currentCamType !== 'dollyZoom') {
    camera.lookAt(controls.target);
    controls.update();
  }
  
  return true;
};

// ---- i18n application logic ----
function updateUIStrings() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        el.value = getTranslation(key);
    } else if (el.tagName === 'SPAN' && el.querySelector('.hint-icon')) {
        // preserve child elements if structured like hint row.
    } else {
        el.innerText = getTranslation(key);
    }
  });
  // Re-apply dynamically-built labels that don't carry data-i18n attributes
  if (typeof _localizePopup === 'function') _localizePopup();
  if (typeof updateLayersPanel === 'function') updateLayersPanel();
}

// Initial UI pass
updateUIStrings();

window.electronAPI.onSetLanguage((lang) => {
  setLanguage(lang);
  updateUIStrings();
});

// ---- Sun Light Drag Control ----
const sunBtn = document.getElementById('sun-preview');
const sunReset = document.getElementById('sun-reset');
let sunDragging = false;

const defaultLightPos = { x: 10, y: 20, z: 10 };

document.getElementById('sun-btn').title = getTranslation('sunTooltip');
sunReset.innerText = getTranslation('resetLight');

sunBtn.addEventListener('mousedown', () => {
  sunDragging = true;
  sunBtn.style.outline = '2px solid rgba(255,255,255,0.4)';
});

window.addEventListener('mousemove', (e) => {
  if (!sunDragging) return;
  const canvas = renderer.domElement;
  const rect = canvas.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
  const y = -((e.clientY - rect.top) / rect.height - 0.5) * 2;
  const vec = new THREE.Vector3(x * 10, y * 10, -1).normalize().multiplyScalar(10);
  dirLight.position.set(vec.x, vec.y, vec.z);
  dirLight.target.updateMatrixWorld();
});

window.addEventListener('mouseup', () => {
  if (sunDragging) markSceneModified();
  sunDragging = false;
  sunBtn.style.outline = 'none';
});

sunReset.addEventListener('click', () => {
  dirLight.position.set(defaultLightPos.x, defaultLightPos.y, defaultLightPos.z);
  dirLight.target.updateMatrixWorld();
});

// ---- Aspect Ratio Safe Frame ----
const _existingSafeFrame = document.getElementById('safe-frame-overlay');
if (_existingSafeFrame) _existingSafeFrame.remove();

const safeFrameOverlay = document.createElement('div');
safeFrameOverlay.id = 'safe-frame-overlay';
document.getElementById('viewport').appendChild(safeFrameOverlay);

function positionSafeFrameOverlay() {
  const overlay = document.getElementById('safe-frame-overlay');
  if (!overlay) return;
  const canvas = renderer.domElement;
  if (!canvas) return;

  const rect = canvas.getBoundingClientRect();

  // Subtract bottom toolbar so the overlay never covers Add Box / Import etc.
  let toolbarHeight = 0;
  const toolbarEl = document.querySelector('#viewport .toolbar');
  if (toolbarEl) {
    const tr = toolbarEl.getBoundingClientRect();
    // Only count it if the toolbar actually overlaps the canvas's bottom area
    if (tr.height > 0 && tr.bottom > rect.top && tr.top < rect.bottom) {
      toolbarHeight = Math.max(0, rect.bottom - tr.top + 4);
    }
  }

  // Fixed positioning at body level — sidesteps any nested stacking-context surprises
  overlay.style.position = 'fixed';
  overlay.style.left = rect.left + 'px';
  overlay.style.top = rect.top + 'px';
  overlay.style.width = rect.width + 'px';
  overlay.style.height = Math.max(0, rect.height - toolbarHeight) + 'px';
  overlay.style.pointerEvents = 'none';
  overlay.style.zIndex = '50';
  overlay.style.overflow = 'hidden';

  if (overlay.parentElement !== document.body) {
    document.body.appendChild(overlay);
  }
}

function updateSafeFrame() {
  const select = document.getElementById('ratio-select');
  const overlay = document.getElementById('safe-frame-overlay');
  if (!overlay || !select) return;

  positionSafeFrameOverlay();

  const ratio = RATIO_MAP[select.value];
  // Use the overlay's own dimensions — already excludes the bottom toolbar
  const vw = parseInt(overlay.style.width) || renderer.domElement.clientWidth;
  const vh = parseInt(overlay.style.height) || renderer.domElement.clientHeight;
  if (vw === 0 || vh === 0) return;
  const viewportRatio = vw / vh;

  if (Math.abs(viewportRatio - ratio) < 0.02) {
    overlay.innerHTML = '';
    return;
  }

  let safeW, safeH;
  if (ratio > viewportRatio) {
    safeW = vw;
    safeH = Math.round(vw / ratio);
  } else {
    safeH = vh;
    safeW = Math.round(vh * ratio);
  }

  const safeLeft = Math.round((vw - safeW) / 2);
  const safeTop = Math.round((vh - safeH) / 2);

  const teal = 'rgba(30,90,90,0.75)';
  overlay.innerHTML = `
    <div style="position:absolute;top:0;left:0;width:${vw}px;height:${safeTop}px;background:${teal};"></div>
    <div style="position:absolute;bottom:0;left:0;width:${vw}px;height:${safeTop}px;background:${teal};"></div>
    <div style="position:absolute;top:${safeTop}px;left:0;width:${safeLeft}px;height:${safeH}px;background:${teal};"></div>
    <div style="position:absolute;top:${safeTop}px;right:0;width:${safeLeft}px;height:${safeH}px;background:${teal};"></div>
    <div style="position:absolute;top:${safeTop}px;left:${safeLeft}px;width:${safeW}px;height:${safeH}px;border:1px solid rgba(255,255,255,0.2);box-sizing:border-box;"></div>
    <div style="position:absolute;top:${safeTop+8}px;left:${safeLeft+10}px;font-size:10px;color:rgba(255,255,255,0.3);font-family:monospace;letter-spacing:1px;pointer-events:none;">${select.value}</div>`;
}

document.getElementById('ratio-select').addEventListener('change', () => {
  updateSafeFrame();
  markSceneModified();
});
window.addEventListener('resize', () => {
  positionSafeFrameOverlay();
  updateSafeFrame();
});
positionSafeFrameOverlay();
updateSafeFrame();

// ---- Vignette + Lens HUD ----
const vignetteEl = document.createElement('div');
vignetteEl.id = 'vignette-overlay';
vignetteEl.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:10;border-radius:0;background:radial-gradient(ellipse at center, transparent 60%, rgba(0,0,0,1) 100%);opacity:0;';
document.getElementById('viewport').appendChild(vignetteEl);

const lensHudEl = document.createElement('div');
lensHudEl.id = 'lens-hud';
lensHudEl.style.cssText = 'position:absolute;top:80px;left:16px;font-size:11px;color:rgba(255,255,255,0.35);pointer-events:none;z-index:20;font-family:monospace;letter-spacing:1px;';
lensHudEl.innerText = 'Zeiss Milvus 35mm';
document.getElementById('viewport').appendChild(lensHudEl);

// ---- Lens Selector Handler ----
const lensSelect = document.getElementById('lens-select');
const lensMmInput = document.getElementById('lens-mm-input');

// Full-frame 35mm sensor diagonal = 43.27mm
function mmToFov(mm) {
  return 2 * Math.atan(21.634 / mm) * (180 / Math.PI);
}

function getLensMmFromName(name) {
  const m = name.match(/(\d+)mm/);
  return m ? parseInt(m[1]) : 50;
}

function getLensBaseName(name) {
  return name.replace(/\s*\d+mm.*$/, '').trim();
}

function updateLensHud(lens, mm) {
  document.getElementById('lens-hud').innerText = `${getLensBaseName(lens.name)} \u2014 ${mm}mm`;
}

lensSelect.addEventListener('change', () => {
  const lens = LENS_TEMPLATES[parseInt(lensSelect.value)];
  const mm = getLensMmFromName(lens.name);
  targetFov = lens.fov;
  camera.near = lens.near;
  camera.far = lens.far;
  camera.updateProjectionMatrix();
  lensMmInput.value = mm;
  updateLensHud(lens, mm);
  markSceneModified();
});

lensMmInput.addEventListener('change', () => {
  let mm = parseInt(lensMmInput.value);
  if (isNaN(mm)) mm = 35;
  mm = Math.max(8, Math.min(300, mm));
  lensMmInput.value = mm;
  targetFov = mmToFov(mm);
  const lens = LENS_TEMPLATES[parseInt(lensSelect.value)];
  updateLensHud(lens, mm);
  markSceneModified();
});

// ---- Mission 7: UX Pass ----

// 1. Welcome overlay (first launch)
const isFirstLaunch = !localStorage.getItem('refluent_lang');
if (isFirstLaunch) {
  showLanguageWelcome();
} else {
  const savedLang = localStorage.getItem('refluent_lang');
  if (savedLang) {
    setLanguage(savedLang);
    updateUIStrings();
  }
}

function showLanguageWelcome() {
  const overlay = document.createElement('div');
  overlay.id = 'lang-welcome-overlay';
  overlay.style.cssText = `
    position:fixed;top:0;left:0;width:100%;height:100%;
    background:rgba(0,0,0,0.95);z-index:2000;
    display:flex;align-items:center;justify-content:center;
    flex-direction:column;gap:32px;`;

  overlay.innerHTML = `
    <div style="text-align:center;">
      <div style="font-size:28px;font-weight:300;color:#fff;
        letter-spacing:4px;margin-bottom:8px;">REFLUENT</div>
      <div style="font-size:13px;color:#555;letter-spacing:2px;">
        CREATIVE VIEWPORT TOOL</div>
    </div>
    <div style="text-align:center;">
      <div style="font-size:14px;color:#888;margin-bottom:24px;">
        Please select your language / 언어를 선택하세요
      </div>
      <div style="display:flex;gap:16px;justify-content:center;">
        <button id="lang-en-btn" style="
          width:140px;height:56px;background:#1a1a1a;
          border:1px solid #444;border-radius:6px;
          color:#fff;font-size:14px;cursor:pointer;
          letter-spacing:1px;transition:border-color 0.2s;">
          English
        </button>
        <button id="lang-kr-btn" style="
          width:140px;height:56px;background:#1a1a1a;
          border:1px solid #444;border-radius:6px;
          color:#fff;font-size:14px;cursor:pointer;
          letter-spacing:1px;transition:border-color 0.2s;">
          한국어
        </button>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  document.getElementById('lang-en-btn').addEventListener('mouseenter', e => e.target.style.borderColor = '#fff');
  document.getElementById('lang-en-btn').addEventListener('mouseleave', e => e.target.style.borderColor = '#444');
  document.getElementById('lang-kr-btn').addEventListener('mouseenter', e => e.target.style.borderColor = '#fff');
  document.getElementById('lang-kr-btn').addEventListener('mouseleave', e => e.target.style.borderColor = '#444');

  document.getElementById('lang-en-btn').addEventListener('click', () => {
    localStorage.setItem('refluent_lang', 'en');
    setLanguage('en');
    updateUIStrings();
    overlay.remove();
    showWalkthrough();
  });

  document.getElementById('lang-kr-btn').addEventListener('click', () => {
    localStorage.setItem('refluent_lang', 'kr');
    setLanguage('kr');
    updateUIStrings();
    overlay.remove();
    showWalkthrough();
  });
}

function showWalkthrough() {
  let slide = 0;
  const slides = [
    {
      en: { title: 'Navigate the Viewport', body: 'Left click + drag to orbit. Right click + drag to pan. Scroll to zoom.' },
      kr: { title: '뷰포트 탐색', body: '좌클릭 + 드래그로 회전. 우클릭 + 드래그로 이동. 스크롤로 줌.' }
    },
    {
      en: { title: 'Add Objects', body: 'Click Add Box or Add Sphere to place objects. Click to select, then use sliders to move or resize.' },
      kr: { title: '오브젝트 추가', body: 'Add Box 또는 Add Sphere를 클릭하여 오브젝트를 배치하세요. 클릭하여 선택 후 슬라이더로 조정하세요.' }
    },
    {
      en: { title: 'Record & Render', body: 'Choose a lens and camera movement, press REC to record. Then use the timeline below to generate an AI render.' },
      kr: { title: '녹화 및 렌더', body: '렌즈와 카메라 움직임을 선택하고 REC를 눌러 녹화하세요. 아래 타임라인으로 AI 렌더를 생성하세요.' }
    },
    {
      en: {
        title: 'Set Your Save Folder',
        body: 'Choose a folder where your MP4 recordings will be saved automatically. You can change this anytime in Refluent → Preferences.',
        action: 'Choose Folder'
      },
      kr: {
        title: '저장 폴더 설정',
        body: 'MP4 녹화 파일이 자동으로 저장될 폴더를 선택하세요. Refluent → 환경설정에서 언제든지 변경할 수 있습니다.',
        action: '폴더 선택'
      }
    }
  ];

  const lang = localStorage.getItem('refluent_lang') || 'en';

  const overlay = document.createElement('div');
  overlay.id = 'walkthrough-overlay';
  overlay.style.cssText = `
    position:fixed;top:0;left:0;width:100%;height:100%;
    background:rgba(0,0,0,0.85);z-index:1999;
    display:flex;align-items:center;justify-content:center;`;

  function renderSlide() {
    const s = slides[slide][lang];
    overlay.innerHTML = `
      <div style="background:#111;border:1px solid #2a2a2a;border-radius:8px;
        padding:40px;width:440px;text-align:center;">
        <div style="font-size:11px;color:#444;letter-spacing:2px;margin-bottom:20px;">
          ${slide + 1} / ${slides.length}
        </div>
        <div style="font-size:18px;color:#fff;font-weight:300;margin-bottom:16px;">
          ${s.title}
        </div>
        <div style="font-size:13px;color:#777;line-height:1.6;margin-bottom:32px;">
          ${s.body}
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span id="wt-skip" style="font-size:11px;color:#444;cursor:pointer;
            text-decoration:underline;">
            ${lang === 'en' ? 'Skip' : '건너뛰기'}
          </span>
          <button id="wt-next" style="
            background:#1a1a1a;border:1px solid #555;border-radius:4px;
            color:#fff;font-size:12px;padding:8px 24px;cursor:pointer;">
            ${slide === slides.length - 1
              ? (s.action || (lang === 'en' ? 'Get Started' : '시작하기'))
              : (lang === 'en' ? 'Next →' : '다음 →')}
          </button>
        </div>
      </div>`;

    document.getElementById('wt-next').addEventListener('click', async () => {
      if (slide < slides.length - 1) {
        slide++;
        renderSlide();
      } else {
        const finalSlide = slides[slide][lang];
        if (finalSlide.action) {
          const folder = await window.electronAPI.selectMp4Folder();
          if (folder) {
            mp4SaveFolder = folder;
            localStorage.setItem('refluent_mp4_folder', folder);
          }
        }
        overlay.remove();
        localStorage.setItem('first_launch', 'done');
      }
    });

    document.getElementById('wt-skip').addEventListener('click', () => {
      overlay.remove();
      localStorage.setItem('first_launch', 'done');
    });
  }

  document.body.appendChild(overlay);
  renderSlide();
}

// ---- Mission I: Auto Save ----
let _autosaveTimer = null;
let sceneModifiedSinceLastSave = false;

function markSceneModified() {
  sceneModifiedSinceLastSave = true;
}

async function performAutosave() {
  if (!sceneModifiedSinceLastSave) return;
  const folder = localStorage.getItem('autosave_folder');
  if (!folder) return;

  const toast = showPersistentToast('Auto-saving...');

  try {
    renderer.render(scene, camera);
    const thumbnail = renderer.domElement.toDataURL('image/jpeg', 0.4);

    const objects = [];
    scene.children.filter(c => c.userData && c.userData.isUserObject).forEach(obj => {
      const entry = {
        uuid: obj.uuid,
        name: obj.userData.name || 'Object',
        type: obj.userData.type || 'box',
        position: obj.position.toArray(),
        scale: obj.scale.toArray(),
        rotation: [obj.rotation.x, obj.rotation.y, obj.rotation.z]
      };
      if (obj.material && obj.material.color) entry.color = obj.material.color.getHexString();
      if (obj.userData.modelData) {
        entry.modelData = obj.userData.modelData;
        entry.modelFormat = obj.userData.modelFormat;
      }
      objects.push(entry);
    });

    const sceneData = {
      version: '1.0',
      name: currentSceneName || 'Untitled',
      savedAt: new Date().toISOString(),
      isAutosave: true,
      thumbnail,
      camera: {
        position: camera.position.toArray(),
        target: controls.target.toArray(),
        fov: camera.fov
      },
      objects,
      lighting: {
        dirLightPosition: dirLight.position.toArray()
      }
    };

    const filename = `${currentSceneName || 'Untitled'}_autosave.ent.bak`;
    const filePath = folder.replace(/[\\/]+$/, '') + '/' + filename;
    await window.electronAPI.writeFile(filePath, JSON.stringify(sceneData, null, 2));
    sceneModifiedSinceLastSave = false;
    updateToast(toast, 'Auto-saved \u2713');
  } catch (err) {
    updateToast(toast, 'Auto-save failed');
    console.warn('[Autosave] failed silently:', err);
  }
}

function setupAutosave() {
  if (_autosaveTimer) { clearInterval(_autosaveTimer); _autosaveTimer = null; }
  const interval = parseInt(localStorage.getItem('autosave_interval') || '0', 10);
  if (interval <= 0) return;
  _autosaveTimer = setInterval(performAutosave, interval * 60 * 1000);
  console.log(`[Autosave] set to every ${interval} minutes`);
}
setupAutosave();

// Camera moves count as scene modifications
controls.addEventListener('change', markSceneModified);

// ---- Mission G ext: Preferences window ----
function showPreferences() {
  if (document.getElementById('prefs-overlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'prefs-overlay';
  overlay.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    background: rgba(0,0,0,0.7); z-index: 3000;
    display: flex; align-items: center; justify-content: center;`;

  overlay.innerHTML = `
    <div id="prefs-modal" style="
      width: 640px; height: 420px;
      background: #141414;
      border: 1px solid #2a2a2a;
      border-radius: 8px;
      display: flex;
      overflow: hidden;
      box-shadow: 0 20px 60px rgba(0,0,0,0.8);
      position: relative;">

      <div id="prefs-sidebar" style="
        width: 180px; background: #0f0f0f;
        border-right: 1px solid #1a1a1a;
        padding: 16px 0; flex-shrink: 0;">
        <div style="font-size:10px;color:#444;letter-spacing:2px;
          padding: 0 16px 12px 16px; text-transform:uppercase;">
          Preferences
        </div>
        <div class="prefs-category active" data-category="files">Files</div>
        <div class="prefs-category" data-category="autosave">Auto Save</div>
        <div class="prefs-category" data-category="display">Display</div>
      </div>

      <div id="prefs-content" style="flex:1; padding: 24px; overflow-y: auto;"></div>

      <button id="prefs-close" style="
        position: absolute; top: 12px; right: 16px;
        background: none; border: none; color: #555;
        font-size: 18px; cursor: pointer;">&#10005;</button>
    </div>`;

  document.body.appendChild(overlay);

  if (!document.getElementById('prefs-style')) {
    const style = document.createElement('style');
    style.id = 'prefs-style';
    style.textContent = `
      .prefs-category {
        padding: 8px 16px;
        font-size: 12px;
        color: #666;
        cursor: pointer;
        border-left: 2px solid transparent;
        transition: all 0.15s;
      }
      .prefs-category:hover { color: #aaa; background: #1a1a1a; }
      .prefs-category.active {
        color: #fff;
        background: #1a1a1a;
        border-left-color: #555;
      }
      .prefs-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 0;
        border-bottom: 1px solid #1a1a1a;
      }
      .prefs-label { font-size: 12px; color: #aaa; }
      .prefs-sublabel { font-size: 10px; color: #444; margin-top: 2px; }
      .prefs-section-title {
        font-size: 10px;
        color: #444;
        letter-spacing: 2px;
        text-transform: uppercase;
        margin-bottom: 16px;
      }
      .prefs-btn {
        background: #1a1a1a;
        border: 1px solid #333;
        border-radius: 4px;
        color: #aaa;
        font-size: 11px;
        padding: 5px 12px;
        cursor: pointer;
      }
      .prefs-btn:hover { border-color: #555; color: #fff; }
      .prefs-path {
        font-size: 10px;
        color: #444;
        margin-top: 4px;
        word-break: break-all;
      }
    `;
    document.head.appendChild(style);
  }

  const categories = {
    files: () => `
      <div class="prefs-section-title">Files</div>
      <div class="prefs-row">
        <div>
          <div class="prefs-label">MP4 Save Folder</div>
          <div class="prefs-sublabel">Where recordings are automatically saved</div>
          <div class="prefs-path" id="mp4-folder-display">
            ${localStorage.getItem('refluent_mp4_folder') || 'Not set'}
          </div>
        </div>
        <button class="prefs-btn" id="change-mp4-folder">Browse...</button>
      </div>`,

    autosave: () => `
      <div class="prefs-section-title">Auto Save</div>
      <div class="prefs-row">
        <div>
          <div class="prefs-label">Auto Save Interval</div>
          <div class="prefs-sublabel">How often your scene is automatically saved</div>
        </div>
        <select id="autosave-interval" style="
          background:#1a1a1a;border:1px solid #333;border-radius:4px;
          color:#aaa;font-size:11px;padding:5px 8px;">
          <option value="0" ${!localStorage.getItem('autosave_interval') || localStorage.getItem('autosave_interval')==='0' ? 'selected' : ''}>Off</option>
          <option value="5" ${localStorage.getItem('autosave_interval')==='5' ? 'selected' : ''}>Every 5 minutes</option>
          <option value="10" ${localStorage.getItem('autosave_interval')==='10' ? 'selected' : ''}>Every 10 minutes</option>
          <option value="30" ${localStorage.getItem('autosave_interval')==='30' ? 'selected' : ''}>Every 30 minutes</option>
        </select>
      </div>
      <div class="prefs-row">
        <div>
          <div class="prefs-label">Auto Save Folder</div>
          <div class="prefs-sublabel">Where backup scene files are saved</div>
          <div class="prefs-path" id="autosave-folder-display">
            ${localStorage.getItem('autosave_folder') || 'Not set'}
          </div>
        </div>
        <button class="prefs-btn" id="change-autosave-folder">Browse...</button>
      </div>`,

    display: () => `
      <div class="prefs-section-title">Display</div>
      <div class="prefs-row">
        <div>
          <div class="prefs-label">Default Layout</div>
          <div class="prefs-sublabel">Layout mode when app opens</div>
        </div>
        <select id="default-layout" style="
          background:#1a1a1a;border:1px solid #333;border-radius:4px;
          color:#aaa;font-size:11px;padding:5px 8px;">
          <option value="simple" ${(localStorage.getItem('layout_mode')||'simple')==='simple' ? 'selected':''}>Simple Mode</option>
          <option value="node" ${localStorage.getItem('layout_mode')==='node' ? 'selected':''}>Node Editor</option>
        </select>
      </div>`
  };

  function loadCategory(cat) {
    document.getElementById('prefs-content').innerHTML = categories[cat]();
    document.querySelectorAll('.prefs-category').forEach(el => {
      el.classList.toggle('active', el.dataset.category === cat);
    });

    const mp4Btn = document.getElementById('change-mp4-folder');
    if (mp4Btn) {
      mp4Btn.addEventListener('click', async () => {
        const folder = await window.electronAPI.selectMp4Folder();
        if (folder) {
          mp4SaveFolder = folder;
          localStorage.setItem('refluent_mp4_folder', folder);
          document.getElementById('mp4-folder-display').textContent = folder;
        }
      });
    }

    const intervalSelect = document.getElementById('autosave-interval');
    if (intervalSelect) {
      intervalSelect.addEventListener('change', () => {
        localStorage.setItem('autosave_interval', intervalSelect.value);
        setupAutosave();
      });
    }

    const autosaveBtn = document.getElementById('change-autosave-folder');
    if (autosaveBtn) {
      autosaveBtn.addEventListener('click', async () => {
        const folder = await window.electronAPI.selectMp4Folder();
        if (folder) {
          localStorage.setItem('autosave_folder', folder);
          document.getElementById('autosave-folder-display').textContent = folder;
        }
      });
    }

    const layoutSelect = document.getElementById('default-layout');
    if (layoutSelect) {
      layoutSelect.addEventListener('change', () => {
        localStorage.setItem('layout_mode', layoutSelect.value);
      });
    }
  }

  document.querySelectorAll('.prefs-category').forEach(el => {
    el.addEventListener('click', () => loadCategory(el.dataset.category));
  });

  loadCategory('files');

  document.getElementById('prefs-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
}

window.electronAPI.onOpenPreferences(() => showPreferences());

window.addEventListener('keydown', (e) => {
  if (_isTypingTarget()) return;
  if ((e.ctrlKey || e.metaKey) && e.key === ',') {
    e.preventDefault();
    showPreferences();
  }
});

// ---- Mission H: Scene save/load + recent projects ----
let currentSceneName = null;
let currentScenePath = null;

function updateWindowTitle() {
  const name = currentSceneName || 'Untitled';
  document.title = `${name} \u2014 Refluent`;
}
updateWindowTitle();

function showToast(message) {
  const toast = document.createElement('div');
  toast.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#1a1a1a;border:1px solid #333;border-radius:4px;color:#aaa;font-size:11px;padding:8px 16px;z-index:4000;pointer-events:none;opacity:1;transition:opacity 0.5s;';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 500); }, 2000);
}

function showPersistentToast(message) {
  const toast = document.createElement('div');
  toast.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#1a1a1a;border:1px solid #333;border-radius:4px;color:#aaa;font-size:11px;padding:8px 16px;z-index:4000;pointer-events:none;transition:opacity 0.5s;';
  toast.textContent = message;
  document.body.appendChild(toast);
  return toast;
}

function updateToast(toast, message) {
  toast.textContent = message;
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 500);
  }, 2000);
}

function addToRecentScenes(filePath, name, thumbnail) {
  let recents = [];
  try { recents = JSON.parse(localStorage.getItem('recent_scenes') || '[]'); } catch (e) {}
  recents = recents.filter(r => r.path !== filePath);
  recents.unshift({ path: filePath, name, thumbnail, date: new Date().toISOString() });
  recents = recents.slice(0, 8);
  try { localStorage.setItem('recent_scenes', JSON.stringify(recents)); } catch (e) {
    // Thumbnails may push us over the localStorage quota; drop them and retry once
    const stripped = recents.map(r => ({ ...r, thumbnail: null }));
    try { localStorage.setItem('recent_scenes', JSON.stringify(stripped)); } catch (e2) {}
  }
}

function _clearSceneSilently() {
  const toRemove = scene.children.filter(c => c.userData && c.userData.isUserObject);
  toRemove.forEach(obj => scene.remove(obj));
  if (selectedObject) {
    selectedObject = null;
    hideObjectPopup();
  }
  const targetPopup = document.getElementById('target-popup');
  if (targetPopup) targetPopup.style.display = 'none';
  const targetMarker = document.getElementById('target-marker');
  if (targetMarker) targetMarker.style.display = 'none';
  boxCount = 0;
  sphereCount = 0;
  updateLayersPanel();
}

function verifySaveData(sceneData) {
  const required = [
    'version', 'camera', 'lens', 'ratio', 'cameraMovement',
    'lighting', 'objects', 'layout', 'pipeline'
  ];
  const missing = required.filter(k => !(k in sceneData));
  if (missing.length > 0) {
    console.warn('[Save] Missing fields:', missing);
  } else {
    console.log('[Save] All fields present \u2713');
  }
}

async function saveScene(saveAs = false) {
  renderer.render(scene, camera);
  const thumbnail = renderer.domElement.toDataURL('image/jpeg', 0.6);

  const objects = [];
  scene.children.filter(c => c.userData && c.userData.isUserObject).forEach(obj => {
    const entry = {
      uuid: obj.uuid,
      name: obj.userData.name || 'Object',
      type: obj.userData.type || 'box',
      position: obj.position.toArray(),
      scale: obj.scale.toArray(),
      rotation: [obj.rotation.x, obj.rotation.y, obj.rotation.z]
    };
    if (obj.material && obj.material.color) entry.color = obj.material.color.getHexString();
    if (obj.userData.modelData) {
      entry.modelData = obj.userData.modelData;
      entry.modelFormat = obj.userData.modelFormat;
    }
    if (obj.userData.animTemplate && obj.userData.animTemplate !== 'none') {
      entry.animTemplate = obj.userData.animTemplate;
      entry.animStartPos = obj.userData.animStartPos ? obj.userData.animStartPos.toArray() : null;
      entry.animStartScale = obj.userData.animStartScale ? obj.userData.animStartScale.toArray() : null;
      if (typeof obj.userData.animStartRotY === 'number') entry.animStartRotY = obj.userData.animStartRotY;
      if (obj.userData.animStartRotation) {
        const r = obj.userData.animStartRotation;
        entry.animStartRotation = [r.x, r.y, r.z, r.order || 'XYZ'];
      }
    }
    objects.push(entry);
  });

  const lensSel = document.getElementById('lens-select');
  const camDirChecked = document.querySelector('input[name="camDir"]:checked');

  const ratioSel = document.getElementById('ratio-select');

  const sceneData = {
    version: '1.1',
    name: currentSceneName || 'Untitled',
    savedAt: new Date().toISOString(),
    thumbnail,
    ratio: ratioSel ? ratioSel.value : '16:9',
    targetVisible: document.getElementById('target-popup')?.style.display === 'block',
    originalTargetPosition: originalTargetPosition.toArray(),
    recordWithMovement: recordWithMovement,

    camera: {
      position: camera.position.toArray(),
      target: controls.target.toArray(),
      fov: camera.fov,
      near: camera.near,
      far: camera.far
    },

    lens: {
      templateIndex: lensSel ? lensSel.value : '3',
      templateName: lensSel ? lensSel.options[lensSel.selectedIndex]?.text : 'Zeiss Milvus 35mm',
      mm: parseInt(document.getElementById('lens-mm-input')?.value || '35', 10),
      targetFov: targetFov
    },

    cameraMovement: {
      preset: currentCamType,
      speed: camSpeedSlider ? camSpeedSlider.value : '1',
      duration: camDurSlider ? camDurSlider.value : '5',
      direction: camDirChecked ? camDirChecked.value : '1',
      lockToTarget: camLockTarget ? camLockTarget.checked : false
    },

    lighting: {
      dirLightPosition: dirLight.position.toArray(),
      dirLightIntensity: dirLight.intensity,
      fillLightPosition: fillLight ? fillLight.position.toArray() : [0, 0, 0],
      fillLightIntensity: fillLight ? fillLight.intensity : 0.3
    },

    objects,

    layout: {
      mode: localStorage.getItem('layout_mode') || 'simple',
      simpleModeState: { ...simpleModeState },
      nodeEditorState: { ...nodeEditorState },
      stepWorldPositions: JSON.parse(JSON.stringify(stepWorldPositions)),
      nodeBasePositions: JSON.parse(JSON.stringify(nodeBasePositions)),
      skippedSteps: Array.from(document.querySelectorAll('.step-card.skipped'))
        .map(c => c.dataset.stepKey || c.dataset.step),
      nodeConnections: nodeConnections.map(c => ({ fromNode: c.fromNode, toNode: c.toNode, id: c.id }))
    },

    pipeline: {
      currentStep: pipelineState.currentStep,
      mp4Path: pipelineState.mp4Path,
      mp4Filename: pipelineState.mp4Filename,
      referenceFrame: pipelineState.referenceFrame,
      referenceImage: pipelineState.referenceImage,
      prompt: pipelineState.prompt,
      aiResultUrl: pipelineState.aiResultUrl,
      upscaleUrl: pipelineState.upscaleUrl
    },

    counters: {
      boxCount: boxCount,
      sphereCount: sphereCount
    }
  };

  verifySaveData(sceneData);

  let savePath = currentScenePath;
  if (saveAs || !savePath) {
    savePath = await window.electronAPI.saveSceneDialog(currentSceneName || 'Untitled');
    if (!savePath) return;
    currentScenePath = savePath;
    currentSceneName = savePath.split(/[\\/]/).pop().replace(/\.ent$/i, '');
    sceneData.name = currentSceneName;
  }

  try {
    await window.electronAPI.writeFile(savePath, JSON.stringify(sceneData, null, 2));
    updateWindowTitle();
    addToRecentScenes(savePath, sceneData.name, thumbnail);
    sceneModifiedSinceLastSave = false;
    showToast(`Scene saved \u2014 ${sceneData.name}.ent`);
  } catch (err) {
    showToast('Save failed: ' + err.message);
  }
}

async function _loadModelFromBase64(base64, format) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Promise((resolve, reject) => {
    if (format === 'glb' || format === 'gltf') {
      const loader = new GLTFLoader();
      loader.parse(bytes.buffer, '', (gltf) => resolve(gltf.scene || gltf), reject);
    } else if (format === 'obj') {
      const loader = new OBJLoader();
      try { resolve(loader.parse(new TextDecoder().decode(bytes))); }
      catch (e) { reject(e); }
    } else {
      reject(new Error('Unsupported model format: ' + format));
    }
  });
}

async function loadScene(filePath) {
  let json;
  try { json = await window.electronAPI.readFile(filePath); }
  catch (err) { showToast('Open failed: ' + err.message); return; }
  let data;
  try { data = JSON.parse(json); }
  catch (err) { showToast('Invalid .ent file'); return; }

  _clearSceneSilently();

  // ---- Camera ----
  if (data.camera) {
    camera.position.fromArray(data.camera.position);
    controls.target.fromArray(data.camera.target);
    camera.fov = data.camera.fov;
    camera.near = data.camera.near != null ? data.camera.near : 0.1;
    camera.far = data.camera.far != null ? data.camera.far : 10000;
    camera.updateProjectionMatrix();
    targetFov = data.camera.fov;
    controls.update();
  }

  // ---- Record with Movement toggle ----
  if (typeof data.recordWithMovement === 'boolean') {
    recordWithMovement = data.recordWithMovement;
    updateRecWithMoveVisual();
  }

  // ---- Target popup visibility ----
  if (Array.isArray(data.originalTargetPosition)) {
    originalTargetPosition.fromArray(data.originalTargetPosition);
  }
  if (data.targetVisible) {
    showTargetPopup();
  } else {
    const _tp = document.getElementById('target-popup');
    if (_tp) _tp.style.display = 'none';
    const _tm = document.getElementById('target-marker');
    if (_tm) _tm.style.display = 'none';
  }

  // ---- Lens ----
  if (data.lens) {
    const lensSelect = document.getElementById('lens-select');
    if (lensSelect && data.lens.templateIndex != null) lensSelect.value = data.lens.templateIndex;
    const mmInput = document.getElementById('lens-mm-input');
    if (mmInput && data.lens.mm != null) mmInput.value = data.lens.mm;
    if (data.lens.targetFov != null) {
      targetFov = data.lens.targetFov;
      camera.fov = targetFov;
      camera.updateProjectionMatrix();
    }
    const lensHud = document.getElementById('lens-hud');
    if (lensHud && data.lens.templateIndex != null) {
      const lens = LENS_TEMPLATES[parseInt(data.lens.templateIndex, 10)];
      if (lens) lensHud.innerText = `${getLensBaseName(lens.name)} \u2014 ${data.lens.mm}mm`;
    }
  }

  // ---- Camera movement ----
  if (data.cameraMovement) {
    const cm = data.cameraMovement;
    const preset = cm.preset || 'pushIn';
    currentCamType = preset;
    const radio = document.querySelector(`input[name="camType"][value="${preset}"]`);
    if (radio) {
      radio.checked = true;
      radio.dispatchEvent(new Event('change'));
    }
    if (camSpeedSlider && cm.speed != null) {
      camSpeedSlider.value = cm.speed;
      if (camSpeedVal) camSpeedVal.innerText = parseFloat(cm.speed).toFixed(1);
    }
    if (camDurSlider && cm.duration != null) {
      camDurSlider.value = cm.duration;
      if (camDurVal) camDurVal.innerText = cm.duration;
    }
    if (cm.direction != null) {
      const dirRadio = document.querySelector(`input[name="camDir"][value="${cm.direction}"]`);
      if (dirRadio) dirRadio.checked = true;
    }
    if (camLockTarget && cm.lockToTarget != null) camLockTarget.checked = !!cm.lockToTarget;
  }

  // ---- Lighting ----
  if (data.lighting) {
    if (data.lighting.dirLightPosition) {
      dirLight.position.fromArray(data.lighting.dirLightPosition);
      dirLight.target.updateMatrixWorld();
    }
    if (data.lighting.dirLightIntensity != null) dirLight.intensity = data.lighting.dirLightIntensity;
    if (fillLight && data.lighting.fillLightPosition) fillLight.position.fromArray(data.lighting.fillLightPosition);
    if (fillLight && data.lighting.fillLightIntensity != null) fillLight.intensity = data.lighting.fillLightIntensity;
  }

  // ---- Objects ----
  for (const obj of (data.objects || [])) {
    let mesh = null;
    if (obj.type === 'box') {
      const geometry = new THREE.BoxGeometry(1, 1, 1);
      const material = new THREE.MeshStandardMaterial({ color: 0x007bff, roughness: 0.4 });
      mesh = new THREE.Mesh(geometry, material);
      mesh.userData.modelName = 'Box';
      boxCount++;
    } else if (obj.type === 'sphere') {
      const geometry = new THREE.SphereGeometry(0.6, 32, 32);
      const material = new THREE.MeshStandardMaterial({ color: 0xff3366, roughness: 0.4 });
      mesh = new THREE.Mesh(geometry, material);
      mesh.userData.modelName = 'Sphere';
      sphereCount++;
    } else if (obj.type === 'imported' && obj.modelData) {
      try {
        const root = await _loadModelFromBase64(obj.modelData, obj.modelFormat);
        const wrapper = new THREE.Group();
        wrapper.add(root);
        wrapper.userData.modelData = obj.modelData;
        wrapper.userData.modelFormat = obj.modelFormat;
        mesh = wrapper;
      } catch (err) {
        console.warn('[loadScene] Failed to restore imported model', obj.name, err);
        continue;
      }
    } else {
      continue;
    }
    mesh.userData.isUserObject = true;
    mesh.userData.type = obj.type;
    mesh.userData.name = obj.name;
    if (Array.isArray(obj.position)) mesh.position.fromArray(obj.position);
    if (Array.isArray(obj.scale)) mesh.scale.fromArray(obj.scale);
    if (Array.isArray(obj.rotation)) mesh.rotation.set(obj.rotation[0], obj.rotation[1], obj.rotation[2]);
    if (obj.color && mesh.material && mesh.material.color) mesh.material.color.set('#' + obj.color);
    if (obj.animTemplate && obj.animTemplate !== 'none') {
      mesh.userData.animTemplate = obj.animTemplate;
      mesh.userData.animStartPos = obj.animStartPos
        ? new THREE.Vector3().fromArray(obj.animStartPos)
        : mesh.position.clone();
      mesh.userData.animStartScale = obj.animStartScale
        ? new THREE.Vector3().fromArray(obj.animStartScale)
        : mesh.scale.clone();
      if (typeof obj.animStartRotY === 'number') mesh.userData.animStartRotY = obj.animStartRotY;
      if (Array.isArray(obj.animStartRotation)) {
        const r = obj.animStartRotation;
        mesh.userData.animStartRotation = new THREE.Euler(r[0] || 0, r[1] || 0, r[2] || 0, r[3] || 'XYZ');
      } else {
        mesh.userData.animStartRotation = mesh.rotation.clone();
      }
      mesh.userData.animTime = 0;
    }
    scene.add(mesh);
  }

  // Restore counters (overrides the per-object auto-increment from the loop above)
  if (data.counters) {
    if (typeof data.counters.boxCount === 'number') boxCount = data.counters.boxCount;
    if (typeof data.counters.sphereCount === 'number') sphereCount = data.counters.sphereCount;
  }

  if (data.ratio) {
    const ratioSelect = document.getElementById('ratio-select');
    if (ratioSelect) {
      ratioSelect.value = data.ratio;
      updateSafeFrame();
    }
  }

  // ---- Layout ----
  if (data.layout) {
    const l = data.layout;
    if (l.mode) setLayout(l.mode);
    if (l.simpleModeState) Object.assign(simpleModeState, l.simpleModeState);
    if (l.nodeEditorState) Object.assign(nodeEditorState, l.nodeEditorState);
    if (l.stepWorldPositions) Object.assign(stepWorldPositions, l.stepWorldPositions);
    if (l.nodeBasePositions) Object.assign(nodeBasePositions, l.nodeBasePositions);

    // Reset all skipped state, then re-apply saved
    document.querySelectorAll('.step-card.skipped').forEach(c => {
      c.classList.remove('skipped');
      const b = c.querySelector('.step-skip-btn');
      if (b) b.textContent = 'Skip';
    });
    if (Array.isArray(l.skippedSteps)) {
      l.skippedSteps.forEach(stepKey => {
        const card = document.querySelector(`.step-card[data-step-key="${stepKey}"]`)
          || document.querySelector(`.step-card[data-step="${stepKey}"]`);
        if (card) {
          card.classList.add('skipped');
          const btn = card.querySelector('.step-skip-btn');
          if (btn) btn.textContent = 'Include';
        }
      });
    }

    if (Array.isArray(l.nodeConnections)) {
      nodeConnections.length = 0;
      l.nodeConnections.forEach(c => nodeConnections.push({ ...c }));
    }

    updateNodePositions();
    updateStepPositions();
    redrawNodeConnections();
    drawSimpleConnections();
  }

  // ---- Pipeline ----
  if (data.pipeline) {
    const p = data.pipeline;
    Object.assign(pipelineState, p);
    activateStep(p.currentStep || 0);
    updateStepMediaPreviews();
    if (typeof updateNodeMediaPreviews === 'function') updateNodeMediaPreviews();

    if (p.prompt) {
      const promptStepContent = document.querySelector('.step-card[data-step-key="prompt"] .step-content');
      if (promptStepContent && !promptStepContent.querySelector('input, textarea, button')) {
        promptStepContent.innerHTML = `<div style="font-size:9px;color:#aaa;padding:4px;">${p.prompt}</div>`;
      }
      const promptNodeContent = document.querySelector('.node-card[data-node="prompt"] .node-content');
      if (promptNodeContent && !promptNodeContent.querySelector('input, textarea, button')) {
        promptNodeContent.innerHTML = `<span style="font-size:9px;color:#aaa;">${p.prompt}</span>`;
      }
    }
  }

  currentScenePath = filePath;
  currentSceneName = data.name || filePath.split(/[\\/]/).pop().replace(/\.ent$/i, '');
  updateWindowTitle();
  updateLayersPanel();
  syncNodeEditor();
  addToRecentScenes(filePath, currentSceneName, data.thumbnail);
  sceneModifiedSinceLastSave = false;
  showToast(`Scene loaded \u2014 ${currentSceneName}.ent`);
}

async function newScene() {
  _clearSceneSilently();
  currentScenePath = null;
  currentSceneName = null;
  updateWindowTitle();
}

async function openSceneFromDialog() {
  const path = await window.electronAPI.openSceneDialog();
  if (path) await loadScene(path);
}

function showRecentProjects() {
  let recents = [];
  try { recents = JSON.parse(localStorage.getItem('recent_scenes') || '[]'); } catch (e) {}
  if (recents.length === 0) return;

  if (document.getElementById('recent-overlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'recent-overlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.92);z-index:2000;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:24px;';

  const grid = recents.map(r => `
    <div class="recent-card" data-path="${encodeURIComponent(r.path)}">
      <div class="recent-thumb">
        ${r.thumbnail
          ? `<img src="${r.thumbnail}" style="width:100%;height:100%;object-fit:cover;border-radius:4px;">`
          : `<div style="width:100%;height:100%;background:#1a1a1a;border-radius:4px;"></div>`}
      </div>
      <div class="recent-name">${r.name}</div>
      <div class="recent-date">${new Date(r.date).toLocaleDateString()}</div>
    </div>`).join('');

  overlay.innerHTML = `
    <div style="text-align:center;">
      <div style="font-size:24px;font-weight:300;color:#fff;letter-spacing:4px;">REFLUENT</div>
      <div style="font-size:11px;color:#444;margin-top:4px;letter-spacing:2px;">RECENT PROJECTS</div>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:16px;justify-content:center;max-width:800px;">
      ${grid}
    </div>
    <div style="display:flex;gap:12px;">
      <button id="new-scene-btn" style="background:#1a1a1a;border:1px solid #444;border-radius:6px;color:#fff;font-size:12px;padding:10px 24px;cursor:pointer;">+ New Scene</button>
      <button id="open-scene-btn" style="background:#1a1a1a;border:1px solid #444;border-radius:6px;color:#aaa;font-size:12px;padding:10px 24px;cursor:pointer;">Open File...</button>
    </div>`;

  document.body.appendChild(overlay);

  if (!document.getElementById('recent-style')) {
    const style = document.createElement('style');
    style.id = 'recent-style';
    style.textContent = `
      .recent-card {
        width: 180px; cursor: pointer; border-radius: 6px;
        border: 1px solid #222; padding: 8px;
        background: #111; transition: border-color 0.2s;
      }
      .recent-card:hover { border-color: #555; }
      .recent-thumb { width:100%; height:100px; margin-bottom:8px; }
      .recent-name { font-size:12px; color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .recent-date { font-size:10px; color:#444; margin-top:2px; }
    `;
    document.head.appendChild(style);
  }

  overlay.querySelectorAll('.recent-card').forEach(card => {
    card.addEventListener('click', async () => {
      const filePath = decodeURIComponent(card.dataset.path);
      overlay.remove();
      await loadScene(filePath);
    });
  });

  document.getElementById('new-scene-btn').addEventListener('click', () => overlay.remove());
  document.getElementById('open-scene-btn').addEventListener('click', async () => {
    overlay.remove();
    await openSceneFromDialog();
  });
}

window.electronAPI.onNewScene(() => newScene());
window.electronAPI.onOpenScene(() => openSceneFromDialog());
window.electronAPI.onSaveScene(() => saveScene(false));
window.electronAPI.onSaveSceneAs(() => saveScene(true));

window.electronAPI.onOpenSceneFile(async (filePath) => {
  if (filePath && filePath.endsWith('.ent')) {
    await loadScene(filePath);
  }
});

document.addEventListener('dragover', (e) => {
  e.preventDefault();
  if (e.dataTransfer.items[0]?.type === '') {
    document.body.style.outline = '2px solid var(--accent)';
  }
});
document.addEventListener('dragleave', () => {
  document.body.style.outline = 'none';
});
document.addEventListener('drop', () => {
  document.body.style.outline = 'none';
});

window.addEventListener('keydown', (e) => {
  if (_isTypingTarget()) return;
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'S' || e.key === 's')) {
    e.preventDefault();
    saveScene(true);
  } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 's' || e.key === 'S')) {
    e.preventDefault();
    saveScene(false);
  } else if ((e.ctrlKey || e.metaKey) && (e.key === 'o' || e.key === 'O')) {
    e.preventDefault();
    openSceneFromDialog();
  } else if ((e.ctrlKey || e.metaKey) && (e.key === 'n' || e.key === 'N')) {
    e.preventDefault();
    newScene();
  }
});

// Show recent projects on launch (no-op when there are no recents)
showRecentProjects();

// 2. Tooltips
const _tooltipMap = {
  'add-box-btn': 'tooltipAddBox',
  'add-sphere-btn': 'tooltipAddSphere',
  'import-model-btn': 'tooltipImport',
  'clear-scene-btn': 'tooltipClearScene',
  'set-target-btn': 'tooltipSetTarget',
  'record-btn': 'tooltipRec',
  'lens-select': 'tooltipLens',
  'sun-btn': 'tooltipSun',
  'lang-en': 'tooltipLang',
  'lang-kr': 'tooltipLang',
  'cam-play-btn': 'tooltipPlay',
  'cam-loop-btn': 'tooltipLoop',
  'cam-stop-btn': 'tooltipStop',
};
Object.entries(_tooltipMap).forEach(([id, key]) => {
  const el = document.getElementById(id);
  if (el) el.title = getTranslation(key);
});

// 3. Camera movement descriptions
[
  ['cam-push-in', 'descPushIn'],
  ['cam-pull-out', 'descPullOut'],
  ['cam-dolly', 'descDolly'],
  ['cam-pan', 'descPan'],
  ['cam-tilt', 'descTilt'],
  ['cam-dolly-zoom', 'descDollyZoom'],
].forEach(([radioId, descKey]) => {
  const lbl = document.querySelector(`label[for="${radioId}"]`);
  if (lbl) {
    const span = document.createElement('span');
    span.setAttribute('data-i18n', descKey);
    span.style.cssText = 'display:block;font-size:10px;color:#888;line-height:1.3;margin-top:2px;font-weight:normal;white-space:normal;';
    span.innerText = getTranslation(descKey);
    lbl.appendChild(span);
  }
});

// 4. Panel descriptions + axis label replacement in #scale-panel
const _scalePanelEl = document.getElementById('scale-panel');
if (_scalePanelEl) {
  const _posTitleEl = _scalePanelEl.querySelector('.panel-section-title[data-i18n="position"]');
  if (_posTitleEl) {
    const d = document.createElement('div');
    d.setAttribute('data-i18n', 'panelMove');
    d.style.cssText = 'font-size:11px;color:#888;margin-bottom:4px;';
    d.innerText = getTranslation('panelMove');
    _posTitleEl.parentNode.insertBefore(d, _posTitleEl);
  }
  const _scaleTitleEl = _scalePanelEl.querySelector('.panel-section-title[data-i18n="scale"]');
  if (_scaleTitleEl) {
    const d = document.createElement('div');
    d.setAttribute('data-i18n', 'panelResize');
    d.style.cssText = 'font-size:11px;color:#888;margin-bottom:4px;';
    d.innerText = getTranslation('panelResize');
    _scaleTitleEl.parentNode.insertBefore(d, _scaleTitleEl);
  }
  [['pos-x','axisX'],['pos-y','axisY'],['pos-z','axisZ'],
   ['scale-x','axisX'],['scale-y','axisY'],['scale-z','axisZ']].forEach(([inputId, i18nKey]) => {
    const inp = document.getElementById(inputId);
    if (inp) {
      const row = inp.closest('.scale-row');
      const lbl = row && row.querySelector('label');
      if (lbl) {
        lbl.setAttribute('data-i18n', i18nKey);
        lbl.innerText = getTranslation(i18nKey);
        lbl.style.width = '72px';
        lbl.style.fontSize = '10px';
        lbl.style.color = '#aaa';
        lbl.style.whiteSpace = 'nowrap';
      }
    }
  });
}

// ---- Layout Shell ----
const appContainer = document.getElementById('app-container');
const simplePanel = document.getElementById('simple-panel');
const nodePanel = document.getElementById('node-panel');
const btnSimple = document.getElementById('btn-simple');
const btnNode = document.getElementById('btn-node');

function setLayout(mode) {
  const vp = document.getElementById('viewport');
  if (mode === 'simple') {
    appContainer.style.flexDirection = 'column';
    simplePanel.style.display = 'flex';
    nodePanel.style.display = 'none';
    if (btnSimple) { btnSimple.style.borderColor = '#fff'; btnSimple.style.opacity = '1'; }
    if (btnNode)   { btnNode.style.borderColor = '#444';   btnNode.style.opacity = '0.6'; }
    localStorage.setItem('layout_mode', 'simple');
  } else {
    appContainer.style.flexDirection = 'row';
    simplePanel.style.display = 'none';
    nodePanel.style.display = 'block';
    if (btnNode)   { btnNode.style.borderColor = '#fff';   btnNode.style.opacity = '1'; }
    if (btnSimple) { btnSimple.style.borderColor = '#444'; btnSimple.style.opacity = '0.6'; }
    localStorage.setItem('layout_mode', 'node');
  }
  // Defer resize until after the browser has recalculated flex layout
  requestAnimationFrame(() => {
    const w = vp.clientWidth;
    const h = vp.clientHeight;
    if (w > 0 && h > 0) {
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    }
    if (typeof positionSafeFrameOverlay === 'function') positionSafeFrameOverlay();
    if (typeof updateSafeFrame === 'function') updateSafeFrame();
    // Reposition object popup after viewport dimensions have settled
    if (selectedObject && !objectPopup.classList.contains('hidden')) {
      showObjectPopup(selectedObject);
    }
  });
}

function _layoutPostSwitch() {
  setTimeout(() => {
    if (typeof positionSafeFrameOverlay === 'function') positionSafeFrameOverlay();
    if (typeof updateSafeFrame === 'function') updateSafeFrame();
  }, 100);
}
if (btnSimple) btnSimple.addEventListener('click', () => { setLayout('simple'); _layoutPostSwitch(); });
if (btnNode)   btnNode.addEventListener('click',   () => { setLayout('node');   _layoutPostSwitch(); });

const savedLayout = localStorage.getItem('layout_mode') || 'simple';
setLayout(savedLayout);

// ---- Simple Mode Pipeline ----

function activateStep(stepIndex) {
  const cards = document.querySelectorAll('.step-card');
  cards.forEach((card, i) => {
    card.classList.remove('active', 'complete');
    if (i < stepIndex) card.classList.add('complete');
    if (i === stepIndex) card.classList.add('active');
  });
  pipelineState.currentStep = stepIndex;
  if (typeof syncNodeEditor === 'function') syncNodeEditor();
  if (typeof updateStepMediaPreviews === 'function') updateStepMediaPreviews();
  if (typeof drawSimpleConnections === 'function') drawSimpleConnections();
}

function resetPipeline() {
  pipelineState.mp4Path = null;
  pipelineState.mp4Filename = null;
  pipelineState.referenceFrame = null;
  pipelineState.referenceImage = null;
  pipelineState.prompt = null;
  pipelineState.aiResultUrl = null;
  pipelineState.upscaleUrl = null;
  pipelineState.currentStep = 0;
  document.querySelectorAll('.step-content').forEach(el => { el.innerHTML = ''; });
  const _s1c = document.querySelector('.step-card[data-step="0"] .step-content');
  if (_s1c) _s1c.innerHTML = '<span style="color:#555;font-size:9px;">recording.mp4</span>';
  activateStep(0);
}

async function triggerAIRender() {
  const step5Content = document.querySelector('.step-card[data-step="4"] .step-content');
  if (!step5Content) return;
  step5Content.innerHTML = `
    <div style="text-align:center;padding:8px;">
      <div style="font-size:9px;color:#888;">Rendering...</div>
      <div style="width:16px;height:16px;border:2px solid #333;border-top-color:#888;border-radius:50%;animation:spin 1s linear infinite;margin:4px auto;"></div>
    </div>`;
  try {
    const job = await window.electronAPI.aiVideoRender({
      mp4Path: pipelineState.mp4Path,
      prompt: pipelineState.prompt,
      referenceFrame: pipelineState.referenceFrame
    });
    if (!job.success) {
      step5Content.innerHTML = `<div style="font-size:9px;color:#c44;padding:4px;">${job.error || 'Something went wrong.'}</div>`;
      return;
    }
    const poll = setInterval(async () => {
      const status = await window.electronAPI.aiVideoStatus({ jobId: job.jobId });
      if (status.status === 'complete') {
        clearInterval(poll);
        pipelineState.aiResultUrl = status.videoUrl;
        step5Content.innerHTML = `
          <div style="font-size:9px;color:#aaa;padding:4px;text-align:center;">
            ✓ Render complete<br>
            <span style="color:#555;font-size:8px;">${status.videoUrl}</span>
          </div>`;
        activateStep(5);
      } else if (status.status === 'error') {
        clearInterval(poll);
        step5Content.innerHTML = `<div style="font-size:9px;color:#c44;padding:4px;">Something went wrong. Try again.</div>`;
      }
    }, 1000);
  } catch (err) {
    step5Content.innerHTML = `<div style="font-size:9px;color:#c44;padding:4px;">Something went wrong.</div>`;
  }
}

// ---- Mission K: Simple Mode rebuild ----
const simpleModeState = {
  offsetX: 0, offsetY: 0,
  scale: 1,
  minScale: 0.3, maxScale: 2.5,
  isDragging: false,
  lastMouseX: 0, lastMouseY: 0
};

const stepWorldPositions = {
  mp4:      { x: 20,  y: 20 },
  frame:    { x: 180, y: 20 },
  refimage: { x: 340, y: 20 },
  prompt:   { x: 500, y: 20 },
  render:   { x: 660, y: 20 },
  upscale:  { x: 820, y: 20 }
};

const stepDefs = [
  { id: 'mp4',      idx: 0, i18nKey: 'step1Label', fallback: 'MP4 Ready',         skippable: false },
  { id: 'frame',    idx: 1, i18nKey: 'step2Label', fallback: 'Select Frame',      skippable: true  },
  { id: 'refimage', idx: 2, i18nKey: 'step3Label', fallback: 'Reference Image',   skippable: true  },
  { id: 'prompt',   idx: 3, i18nKey: 'step4Label', fallback: 'Nanobanana Prompt', skippable: true  },
  { id: 'render',   idx: 4, i18nKey: 'step5Label', fallback: 'AI Render',         skippable: false },
  { id: 'upscale',  idx: 5, i18nKey: 'step6Label', fallback: 'Upscale',           skippable: true  }
];

function simpleWorldToScreen(wx, wy) {
  return {
    x: wx * simpleModeState.scale + simpleModeState.offsetX,
    y: wy * simpleModeState.scale + simpleModeState.offsetY
  };
}

function drawSimpleGrid() {
  // Mission K fix - grid removed, plain dark background only
  const canvas = document.getElementById('simple-grid-canvas');
  if (canvas) canvas.style.display = 'none';
}

function updateStepPositions() {
  const s = simpleModeState.scale;
  const BASE = 140;
  const scaledSize = BASE * s;
  Object.keys(stepWorldPositions).forEach(stepId => {
    const card = document.querySelector(`.step-card[data-step-key="${stepId}"]`);
    if (!card) return;
    const screen = simpleWorldToScreen(stepWorldPositions[stepId].x, stepWorldPositions[stepId].y);
    card.style.left = screen.x + 'px';
    card.style.top = screen.y + 'px';
    card.style.width = scaledSize + 'px';
    card.style.height = scaledSize + 'px';
    card.style.fontSize = Math.max(8, 11 * s) + 'px';
    card.style.borderRadius = Math.max(3, 8 * s) + 'px';

    const header = card.querySelector('.step-header');
    if (header) {
      header.style.padding = `${Math.max(3, 6 * s)}px ${Math.max(4, 8 * s)}px`;
      header.style.fontSize = Math.max(8, 11 * s) + 'px';
    }
  });
  drawSimpleConnections();
  drawSimpleGrid();
}

function makeStepDraggable(cardEl) {
  const stepId = cardEl.dataset.stepKey;
  if (!stepId || !stepWorldPositions[stepId]) return;
  let isDragging = false;
  let startMouseX, startMouseY, startWorldX, startWorldY;
  const header = cardEl.querySelector('.step-header');
  if (!header) return;

  header.addEventListener('mousedown', (e) => {
    if (e.target.classList && e.target.classList.contains('step-skip-btn')) return;
    e.stopPropagation();
    isDragging = true;
    startMouseX = e.clientX;
    startMouseY = e.clientY;
    startWorldX = stepWorldPositions[stepId].x;
    startWorldY = stepWorldPositions[stepId].y;
    cardEl.style.zIndex = '50';
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const s = simpleModeState.scale;
    stepWorldPositions[stepId].x = startWorldX + (e.clientX - startMouseX) / s;
    stepWorldPositions[stepId].y = startWorldY + (e.clientY - startMouseY) / s;
    const screen = simpleWorldToScreen(stepWorldPositions[stepId].x, stepWorldPositions[stepId].y);
    cardEl.style.left = screen.x + 'px';
    cardEl.style.top = screen.y + 'px';
    drawSimpleConnections();
  });

  window.addEventListener('mouseup', () => {
    if (isDragging) { isDragging = false; cardEl.style.zIndex = '10'; }
  });
}

function drawSimpleConnections() {
  const panel = document.getElementById('simple-panel');
  if (!panel) return;
  let svg = document.getElementById('simple-connections-svg');
  if (!svg) {
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = 'simple-connections-svg';
    svg.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:5;';
    panel.appendChild(svg);
  }
  // Reset with arrowhead marker defs
  svg.innerHTML = `
    <defs>
      <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
        <polygon points="0 0, 8 3, 0 6" fill="#555" opacity="0.8"/>
      </marker>
      <marker id="arrowhead-active" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
        <polygon points="0 0, 8 3, 0 6" fill="#888" opacity="1"/>
      </marker>
    </defs>`;
  const panelRect = panel.getBoundingClientRect();
  const stepOrder = ['mp4', 'frame', 'refimage', 'prompt', 'render', 'upscale'];

  const activeIds = stepOrder.filter(id => {
    const c = document.querySelector(`.step-card[data-step-key="${id}"]`);
    return c && !c.classList.contains('skipped');
  });

  for (let i = 0; i < activeIds.length - 1; i++) {
    const fromCard = document.querySelector(`.step-card[data-step-key="${activeIds[i]}"]`);
    const toCard = document.querySelector(`.step-card[data-step-key="${activeIds[i + 1]}"]`);
    if (!fromCard || !toCard) continue;
    const fr = fromCard.getBoundingClientRect();
    const tr = toCard.getBoundingClientRect();
    const x1 = fr.right - panelRect.left;
    const y1 = fr.top - panelRect.top + fr.height / 2;
    const x2 = tr.left - panelRect.left;
    const y2 = tr.top - panelRect.top + tr.height / 2;
    const cp = Math.abs(x2 - x1) * 0.2;
    const fromIdx = stepOrder.indexOf(activeIds[i]);
    const isActive = fromIdx < pipelineState.currentStep;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', `M ${x1} ${y1} C ${x1+cp} ${y1}, ${x2-cp} ${y2}, ${x2} ${y2}`);
    path.setAttribute('stroke', isActive ? '#667' : '#2a2a2a');
    path.setAttribute('stroke-width', isActive ? '1.5' : '1');
    path.setAttribute('fill', 'none');
    path.setAttribute('opacity', isActive ? '0.9' : '0.4');
    path.setAttribute('marker-end', isActive ? 'url(#arrowhead-active)' : 'url(#arrowhead)');
    svg.appendChild(path);
  }
}

function toggleSkipStep(stepId) {
  const card = document.querySelector(`.step-card[data-step-key="${stepId}"]`);
  if (!card) return;
  const isSkipped = card.classList.toggle('skipped');
  const btn = card.querySelector('.step-skip-btn');
  if (btn) btn.textContent = isSkipped ? 'Include' : 'Skip';
  console.log(`[Pipeline] Step ${stepId} ${isSkipped ? 'skipped' : 'restored'}`);
  drawSimpleConnections();
  updatePipelineFromSkips();
}

function updatePipelineFromSkips() {
  const allSteps = ['mp4', 'frame', 'refimage', 'prompt', 'render', 'upscale'];
  const activeSteps = allSteps.filter(id => {
    const card = document.querySelector(`.step-card[data-step-key="${id}"]`);
    return card && !card.classList.contains('skipped');
  });
  console.log('[Pipeline] active steps:', activeSteps);
}

function updateStepMediaPreviews() {
  if (pipelineState.mp4Path) {
    const content = document.querySelector('.step-card[data-step-key="mp4"] .step-content');
    if (content && !content.querySelector('input, textarea, button')) {
      const safe = `file:///${pipelineState.mp4Path.replace(/\\/g, '/')}`;
      content.innerHTML = `<video src="${safe}" style="width:100%;height:100%;object-fit:cover;" preload="metadata" muted playsinline></video>`;
      const v = content.querySelector('video');
      if (v) {
        v.addEventListener('loadedmetadata', () => { try { v.currentTime = 0.1; } catch (e) {} });
        v.addEventListener('mouseenter', () => { v.play().catch(() => {}); });
        v.addEventListener('mouseleave', () => { v.pause(); try { v.currentTime = 0.1; } catch (e) {} });
      }
    }
  }
  if (pipelineState.referenceImage) {
    const content = document.querySelector('.step-card[data-step-key="refimage"] .step-content');
    if (content && !content.querySelector('input, textarea, button')) {
      const safe = `file:///${pipelineState.referenceImage.replace(/\\/g, '/')}`;
      content.innerHTML = `<img src="${safe}" style="width:100%;height:100%;object-fit:cover;">`;
    }
  }
  if (pipelineState.aiResultUrl && !pipelineState.aiResultUrl.startsWith('mock://')) {
    const content = document.querySelector('.step-card[data-step-key="render"] .step-content');
    if (content && !content.querySelector('input, textarea, button')) {
      content.innerHTML = `<video src="${pipelineState.aiResultUrl}" style="width:100%;height:100%;object-fit:cover;" autoplay loop muted></video>`;
    }
  }
}

function rebuildSimplePanel() {
  const simplePanel = document.getElementById('simple-panel');
  if (!simplePanel) return;
  simplePanel.innerHTML = '';
  simplePanel.style.position = 'relative';

  // Grid canvas behind cards
  const gridCanvas = document.createElement('canvas');
  gridCanvas.id = 'simple-grid-canvas';
  gridCanvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:0;';
  simplePanel.appendChild(gridCanvas);

  // Build cards
  stepDefs.forEach(step => {
    const card = document.createElement('div');
    card.className = 'step-card';
    card.dataset.step = String(step.idx);
    card.dataset.stepKey = step.id;
    card.innerHTML = `
      <div class="step-header">
        <span class="step-name" data-i18n="${step.i18nKey}">${getTranslation(step.i18nKey) || step.fallback}</span>
        <div style="display:flex;align-items:center;gap:4px;">
          <span class="step-status-dot"></span>
          ${step.skippable ? '<button class="step-skip-btn" title="Toggle skip">Skip</button>' : ''}
        </div>
      </div>
      <div class="step-body"><div class="step-content">${step.id === 'mp4' ? '<span style="color:#555;font-size:9px;">recording.mp4</span>' : ''}</div></div>`;
    simplePanel.appendChild(card);
    makeStepDraggable(card);
    if (step.skippable) {
      const skipBtn = card.querySelector('.step-skip-btn');
      if (skipBtn) skipBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleSkipStep(step.id);
      });
    }
  });

  // Floating zoom controls + reset (reset preserves legacy id)
  const simpleControls = document.createElement('div');
  simpleControls.style.cssText = 'position:absolute;bottom:12px;right:12px;display:flex;gap:4px;z-index:200;';
  simpleControls.innerHTML = `
    <button class="node-ctrl-btn" id="simple-zoom-in" title="Zoom In">+</button>
    <button class="node-ctrl-btn" id="simple-zoom-out" title="Zoom Out">&#8722;</button>
    <button class="node-ctrl-btn" id="simple-center" title="Center All">&#8857;</button>
    <button class="node-ctrl-btn" id="pipeline-reset-btn" title="Reset pipeline">&#8634;</button>`;
  simplePanel.appendChild(simpleControls);

  document.getElementById('simple-zoom-in').addEventListener('click', () => {
    const rect = simplePanel.getBoundingClientRect();
    const cx = rect.width / 2, cy = rect.height / 2;
    const factor = 1.2;
    const newScale = Math.min(simpleModeState.maxScale, simpleModeState.scale * factor);
    const realFactor = newScale / simpleModeState.scale;
    simpleModeState.offsetX = cx - realFactor * (cx - simpleModeState.offsetX);
    simpleModeState.offsetY = cy - realFactor * (cy - simpleModeState.offsetY);
    simpleModeState.scale = newScale;
    updateStepPositions();
  });
  document.getElementById('simple-zoom-out').addEventListener('click', () => {
    const rect = simplePanel.getBoundingClientRect();
    const cx = rect.width / 2, cy = rect.height / 2;
    const factor = 0.8;
    const newScale = Math.max(simpleModeState.minScale, simpleModeState.scale * factor);
    const realFactor = newScale / simpleModeState.scale;
    simpleModeState.offsetX = cx - realFactor * (cx - simpleModeState.offsetX);
    simpleModeState.offsetY = cy - realFactor * (cy - simpleModeState.offsetY);
    simpleModeState.scale = newScale;
    updateStepPositions();
  });
  document.getElementById('simple-center').addEventListener('click', () => {
    simpleModeState.offsetX = 0;
    simpleModeState.offsetY = 0;
    simpleModeState.scale = 1;
    updateStepPositions();
  });

  // Pan from empty area
  simplePanel.addEventListener('mousedown', (e) => {
    if (e.target !== simplePanel && e.target !== gridCanvas) return;
    simpleModeState.isDragging = true;
    simpleModeState.lastMouseX = e.clientX;
    simpleModeState.lastMouseY = e.clientY;
    simplePanel.style.cursor = 'grabbing';
  });
  window.addEventListener('mousemove', (e) => {
    if (!simpleModeState.isDragging) return;
    simpleModeState.offsetX += e.clientX - simpleModeState.lastMouseX;
    simpleModeState.offsetY += e.clientY - simpleModeState.lastMouseY;
    simpleModeState.lastMouseX = e.clientX;
    simpleModeState.lastMouseY = e.clientY;
    updateStepPositions();
  });
  window.addEventListener('mouseup', () => {
    if (simpleModeState.isDragging) {
      simpleModeState.isDragging = false;
      simplePanel.style.cursor = 'default';
    }
  });

  // Cursor-anchored wheel zoom
  simplePanel.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.92 : 1.08;
    const newScale = Math.min(simpleModeState.maxScale,
      Math.max(simpleModeState.minScale, simpleModeState.scale * factor));
    const rect = simplePanel.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const worldX = (mouseX - simpleModeState.offsetX) / simpleModeState.scale;
    const worldY = (mouseY - simpleModeState.offsetY) / simpleModeState.scale;
    simpleModeState.scale = newScale;
    simpleModeState.offsetX = mouseX - worldX * newScale;
    simpleModeState.offsetY = mouseY - worldY * newScale;
    updateStepPositions();
  }, { passive: false });

  updateStepPositions();
  drawSimpleConnections();
}

rebuildSimplePanel();

// Step 2 — Select Frame
const _step2Card = document.querySelector('.step-card[data-step="1"]');
if (_step2Card) {
  _step2Card.addEventListener('click', () => {
    if (pipelineState.currentStep !== 1) return;
    const step2Content = _step2Card.querySelector('.step-content');
    step2Content.innerHTML = `
      <div style="padding:4px;">
        <div style="font-size:9px;color:#888;margin-bottom:3px;">Frame (seconds)</div>
        <input type="number" id="frame-input" min="0" step="0.1" value="0"
          style="width:60px;background:#222;border:1px solid #444;color:#fff;font-size:10px;padding:2px 4px;border-radius:3px;">
        <button id="confirm-frame"
          style="margin-left:4px;background:#2a2a2a;border:1px solid #555;color:#fff;font-size:9px;padding:2px 6px;border-radius:3px;cursor:pointer;">✓</button>
      </div>`;
    document.getElementById('confirm-frame').addEventListener('click', () => {
      pipelineState.referenceFrame = document.getElementById('frame-input').value;
      step2Content.innerHTML = `<div style="font-size:9px;color:#aaa;padding:4px;">Frame: ${pipelineState.referenceFrame}s</div>`;
      activateStep(2);
    });
  });
}

// Step 3 — Add Reference Image
const _step3Card = document.querySelector('.step-card[data-step="2"]');
if (_step3Card) {
  _step3Card.addEventListener('click', async () => {
    if (pipelineState.currentStep !== 2) return;
    const filePath = await window.electronAPI.openFileDialog({
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png'] }]
    });
    if (!filePath) return;
    pipelineState.referenceImage = filePath;
    const filename = filePath.split(/[\\/]/).pop();
    const step3Content = _step3Card.querySelector('.step-content');
    step3Content.innerHTML = `<div style="font-size:9px;color:#aaa;padding:4px;word-break:break-all;">${filename}</div>`;
    activateStep(3);
  });
}

// Step 4 — Prompt
const _step4Card = document.querySelector('.step-card[data-step="3"]');
if (_step4Card) {
  _step4Card.addEventListener('click', () => {
    if (pipelineState.currentStep !== 3) return;
    const step4Content = _step4Card.querySelector('.step-content');
    step4Content.innerHTML = `
      <div style="padding:4px;">
        <textarea id="prompt-input" rows="2" placeholder="Describe the scene..."
          style="width:100%;background:#222;border:1px solid #444;color:#fff;font-size:9px;padding:3px;border-radius:3px;resize:none;box-sizing:border-box;"></textarea>
        <button id="confirm-prompt"
          style="width:100%;margin-top:3px;background:#2a2a2a;border:1px solid #555;color:#fff;font-size:9px;padding:2px;border-radius:3px;cursor:pointer;">Generate →</button>
      </div>`;
    document.getElementById('confirm-prompt').addEventListener('click', () => {
      pipelineState.prompt = document.getElementById('prompt-input').value;
      if (!pipelineState.prompt.trim()) return;
      step4Content.innerHTML = `<div style="font-size:9px;color:#aaa;padding:4px;">${pipelineState.prompt}</div>`;
      activateStep(4);
      triggerAIRender();
    });
  });
}

// Step 6 — Upscale
const _step6Card = document.querySelector('.step-card[data-step="5"]');
if (_step6Card) {
  _step6Card.addEventListener('click', async () => {
    if (pipelineState.currentStep !== 5) return;
    const step6Content = _step6Card.querySelector('.step-content');
    step6Content.innerHTML = `
      <div style="text-align:center;padding:8px;">
        <div style="font-size:9px;color:#888;">Upscaling...</div>
        <div style="width:16px;height:16px;border:2px solid #333;border-top-color:#888;border-radius:50%;animation:spin 1s linear infinite;margin:4px auto;"></div>
      </div>`;
    try {
      const job = await window.electronAPI.aiUpscale({ inputPath: pipelineState.aiResultUrl, scale: 4 });
      if (!job.success) {
        step6Content.innerHTML = `<div style="font-size:9px;color:#c44;padding:4px;">${job.error || 'Upscale failed.'}</div>`;
        return;
      }
      const poll = setInterval(async () => {
        const status = await window.electronAPI.aiUpscaleStatus({ jobId: job.jobId });
        if (status.status === 'complete') {
          clearInterval(poll);
          pipelineState.upscaleUrl = status.outputUrl;
          step6Content.innerHTML = `
            <div style="font-size:9px;color:#aaa;padding:4px;text-align:center;">
              ✓ Upscale ready<br>
              <span style="color:#555;font-size:8px;">4K output</span>
            </div>`;
          activateStep(6);
        }
      }, 1000);
    } catch (err) {
      step6Content.innerHTML = `<div style="font-size:9px;color:#c44;padding:4px;">Something went wrong.</div>`;
    }
  });
}

// Pipeline Reset
const _pipelineResetBtn = document.getElementById('pipeline-reset-btn');
if (_pipelineResetBtn) _pipelineResetBtn.addEventListener('click', resetPipeline);

// ---- Node Editor ----

function syncNodeEditor() {
  const nodeIds = ['mp4', 'frame', 'refimage', 'prompt', 'render', 'upscale'];
  const nodeContents = [
    pipelineState.mp4Filename
      ? `<span style="font-size:9px;color:#aaa;">${pipelineState.mp4Filename}</span>`
      : '<span style="font-size:9px;color:#555;">Waiting for recording…</span>',
    pipelineState.referenceFrame !== null
      ? `<span style="font-size:9px;color:#aaa;">Frame: ${pipelineState.referenceFrame}s</span>`
      : '',
    pipelineState.referenceImage
      ? `<span style="font-size:9px;color:#aaa;">${pipelineState.referenceImage.split(/[\\/]/).pop()}</span>`
      : '',
    pipelineState.prompt
      ? `<span style="font-size:9px;color:#aaa;">${pipelineState.prompt}</span>`
      : '',
    pipelineState.aiResultUrl
      ? '<span style="font-size:9px;color:#aaa;">✓ Render complete</span>'
      : (pipelineState.currentStep === 4
          ? '<div style="width:14px;height:14px;border:2px solid #333;border-top-color:#888;border-radius:50%;animation:spin 1s linear infinite;margin:3px auto;"></div>'
          : ''),
    pipelineState.upscaleUrl
      ? '<span style="font-size:9px;color:#aaa;">✓ 4K ready</span>'
      : ''
  ];

  nodeIds.forEach((nodeId, i) => {
    const node = document.querySelector(`.node-card[data-node="${nodeId}"]`);
    if (!node) return;
    const dot = node.querySelector('.node-status-dot');
    const nodeContent = node.querySelector('.node-content');
    node.classList.remove('node-inactive', 'node-active', 'node-complete', 'node-error');
    if (i < pipelineState.currentStep) {
      node.classList.add('node-complete');
      if (dot) { dot.style.background = '#3a7a3a'; dot.style.animation = ''; }
    } else if (i === pipelineState.currentStep) {
      node.classList.add('node-active');
      if (dot) { dot.style.background = '#888'; dot.style.animation = 'pulse 2s infinite'; }
    } else {
      node.classList.add('node-inactive');
      if (dot) { dot.style.background = '#333'; dot.style.animation = ''; }
    }
    if (nodeContent) {
      const hasActiveForm = (i === pipelineState.currentStep) && nodeContent.querySelector('input, textarea, button');
      if (!hasActiveForm) nodeContent.innerHTML = nodeContents[i] || '';
    }
  });

  if (typeof updateNodeMediaPreviews === 'function') updateNodeMediaPreviews();
  if (typeof redrawNodeConnections === 'function') redrawNodeConnections();
}

function wireNodeInteractions() {
  // Node 1 — Select Frame
  const _nFrame = document.querySelector('.node-card[data-node="frame"]');
  if (_nFrame) {
    _nFrame.addEventListener('click', () => {
      if (pipelineState.currentStep !== 1) return;
      const nc = _nFrame.querySelector('.node-content');
      nc.innerHTML = `
        <div style="padding:2px 0;">
          <div style="font-size:9px;color:#888;margin-bottom:3px;">Frame (seconds)</div>
          <input type="number" id="node-frame-input" min="0" step="0.1" value="0"
            style="width:55px;background:#222;border:1px solid #444;color:#fff;font-size:10px;padding:2px 4px;border-radius:3px;">
          <button id="node-confirm-frame"
            style="margin-left:3px;background:#2a2a2a;border:1px solid #555;color:#fff;font-size:9px;padding:2px 5px;border-radius:3px;cursor:pointer;">✓</button>
        </div>`;
      document.getElementById('node-confirm-frame').addEventListener('click', () => {
        pipelineState.referenceFrame = document.getElementById('node-frame-input').value;
        nc.innerHTML = `<span style="font-size:9px;color:#aaa;">Frame: ${pipelineState.referenceFrame}s</span>`;
        const s2c = document.querySelector('.step-card[data-step="1"] .step-content');
        if (s2c) s2c.innerHTML = `<div style="font-size:9px;color:#aaa;padding:4px;">Frame: ${pipelineState.referenceFrame}s</div>`;
        activateStep(2);
      });
    });
  }

  // Node 2 — Reference Image
  const _nRef = document.querySelector('.node-card[data-node="refimage"]');
  if (_nRef) {
    _nRef.addEventListener('click', async () => {
      if (pipelineState.currentStep !== 2) return;
      const filePath = await window.electronAPI.openFileDialog({
        filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png'] }]
      });
      if (!filePath) return;
      pipelineState.referenceImage = filePath;
      const filename = filePath.split(/[\\/]/).pop();
      const nc = _nRef.querySelector('.node-content');
      nc.innerHTML = `<span style="font-size:9px;color:#aaa;">${filename}</span>`;
      const s3c = document.querySelector('.step-card[data-step="2"] .step-content');
      if (s3c) s3c.innerHTML = `<div style="font-size:9px;color:#aaa;padding:4px;word-break:break-all;">${filename}</div>`;
      activateStep(3);
    });
  }

  // Node 3 — Prompt
  const _nPrompt = document.querySelector('.node-card[data-node="prompt"]');
  if (_nPrompt) {
    _nPrompt.addEventListener('click', () => {
      if (pipelineState.currentStep !== 3) return;
      const nc = _nPrompt.querySelector('.node-content');
      nc.innerHTML = `
        <div style="padding:2px 0;">
          <textarea id="node-prompt-input" rows="2" placeholder="Describe the scene…"
            style="width:100%;background:#222;border:1px solid #444;color:#fff;font-size:9px;padding:3px;border-radius:3px;resize:none;box-sizing:border-box;"></textarea>
          <button id="node-confirm-prompt"
            style="width:100%;margin-top:3px;background:#2a2a2a;border:1px solid #555;color:#fff;font-size:9px;padding:2px;border-radius:3px;cursor:pointer;">Generate →</button>
        </div>`;
      document.getElementById('node-confirm-prompt').addEventListener('click', () => {
        pipelineState.prompt = document.getElementById('node-prompt-input').value;
        if (!pipelineState.prompt.trim()) return;
        nc.innerHTML = `<span style="font-size:9px;color:#aaa;">${pipelineState.prompt}</span>`;
        const s4c = document.querySelector('.step-card[data-step="3"] .step-content');
        if (s4c) s4c.innerHTML = `<div style="font-size:9px;color:#aaa;padding:4px;">${pipelineState.prompt}</div>`;
        activateStep(4);
        triggerAIRender();
      });
    });
  }

  // Node 5 — Upscale
  const _nUpscale = document.querySelector('.node-card[data-node="upscale"]');
  if (_nUpscale) {
    _nUpscale.addEventListener('click', async () => {
      if (pipelineState.currentStep !== 5) return;
      const nc = _nUpscale.querySelector('.node-content');
      nc.innerHTML = `
        <div style="text-align:center;">
          <div style="font-size:9px;color:#888;">Upscaling…</div>
          <div style="width:14px;height:14px;border:2px solid #333;border-top-color:#888;border-radius:50%;animation:spin 1s linear infinite;margin:3px auto;"></div>
        </div>`;
      const s6c = document.querySelector('.step-card[data-step="5"] .step-content');
      if (s6c) s6c.innerHTML = `
        <div style="text-align:center;padding:6px;">
          <div style="font-size:9px;color:#888;">Upscaling...</div>
          <div style="width:14px;height:14px;border:2px solid #333;border-top-color:#888;border-radius:50%;animation:spin 1s linear infinite;margin:3px auto;"></div>
        </div>`;
      try {
        const job = await window.electronAPI.aiUpscale({ inputPath: pipelineState.aiResultUrl, scale: 4 });
        if (!job.success) {
          nc.innerHTML = `<span style="font-size:9px;color:#c44;">${job.error || 'Upscale failed.'}</span>`;
          return;
        }
        const poll = setInterval(async () => {
          const status = await window.electronAPI.aiUpscaleStatus({ jobId: job.jobId });
          if (status.status === 'complete') {
            clearInterval(poll);
            pipelineState.upscaleUrl = status.outputUrl;
            nc.innerHTML = '<span style="font-size:9px;color:#aaa;">✓ 4K ready</span>';
            if (s6c) s6c.innerHTML = `<div style="font-size:9px;color:#aaa;padding:4px;text-align:center;">✓ Upscale ready<br><span style="color:#555;font-size:8px;">4K output</span></div>`;
            activateStep(6);
          }
        }, 1000);
      } catch (err) {
        nc.innerHTML = '<span style="font-size:9px;color:#c44;">Something went wrong.</span>';
      }
    });
  }
}

// ---- Mission J: Node Editor overhaul ----
const nodeEditorState = {
  offsetX: 0, offsetY: 0,
  scale: 1,
  minScale: 0.2, maxScale: 3,
  isDragging: false,
  lastMouseX: 0, lastMouseY: 0
};

// World-space positions — survive zoom/pan and update on drag
const nodeBasePositions = {
  mp4:      { x: 100, y: 60 },
  frame:    { x: 100, y: 260 },
  refimage: { x: 100, y: 460 },
  prompt:   { x: 100, y: 660 },
  render:   { x: 100, y: 860 },
  upscale:  { x: 100, y: 1060 }
};

function worldToScreen(worldX, worldY) {
  return {
    x: worldX * nodeEditorState.scale + nodeEditorState.offsetX,
    y: worldY * nodeEditorState.scale + nodeEditorState.offsetY
  };
}

function drawNodeGrid() {
  const canvas = document.getElementById('node-grid-canvas');
  if (!canvas) return;
  canvas.width = canvas.offsetWidth;
  canvas.height = canvas.offsetHeight;
  if (canvas.width === 0 || canvas.height === 0) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const gridSize = 24 * nodeEditorState.scale;
  if (gridSize < 4) return;
  const offsetX = ((nodeEditorState.offsetX % gridSize) + gridSize) % gridSize;
  const offsetY = ((nodeEditorState.offsetY % gridSize) + gridSize) % gridSize;

  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 0.5;
  for (let x = offsetX; x < canvas.width; x += gridSize) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
  }
  for (let y = offsetY; y < canvas.height; y += gridSize) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
  }

  const largeGrid = gridSize * 5;
  const largeOffsetX = ((nodeEditorState.offsetX % largeGrid) + largeGrid) % largeGrid;
  const largeOffsetY = ((nodeEditorState.offsetY % largeGrid) + largeGrid) % largeGrid;
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 0.8;
  for (let x = largeOffsetX; x < canvas.width; x += largeGrid) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
  }
  for (let y = largeOffsetY; y < canvas.height; y += largeGrid) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
  }
}

function updateNodePositions() {
  const s = nodeEditorState.scale;
  const BASE_SIZE = 160;
  const scaledSize = BASE_SIZE * s;

  Object.keys(nodeBasePositions).forEach(nodeId => {
    const node = document.querySelector(`.node-card[data-node="${nodeId}"]`);
    if (!node) return;

    const screen = worldToScreen(nodeBasePositions[nodeId].x, nodeBasePositions[nodeId].y);

    node.style.left = screen.x + 'px';
    node.style.top = screen.y + 'px';
    node.style.width = scaledSize + 'px';
    node.style.height = scaledSize + 'px';
    node.style.minHeight = 'unset';
    node.style.transform = 'none';
    node.style.fontSize = Math.max(8, 11 * s) + 'px';
    node.style.borderRadius = Math.max(3, 8 * s) + 'px';
    node.style.overflow = 'hidden';

    const titleBar = node.querySelector('.node-title-bar');
    if (titleBar) {
      titleBar.style.padding = `${Math.max(4, 8 * s)}px ${Math.max(6, 10 * s)}px`;
      titleBar.style.fontSize = Math.max(8, 11 * s) + 'px';
    }

    const body = node.querySelector('.node-body');
    if (body) {
      const titleH = titleBar ? titleBar.offsetHeight : Math.max(20, 28 * s);
      body.style.height = (scaledSize - titleH) + 'px';
      body.style.padding = Math.max(2, 6 * s) + 'px';
      body.style.boxSizing = 'border-box';
    }

    const preview = node.querySelector('.node-media-preview');
    if (preview) {
      preview.style.width = '100%';
      preview.style.height = '100%';
    }

    const portSize = Math.max(5, 9 * s);
    node.querySelectorAll('.node-port-in, .node-port-out').forEach(port => {
      port.style.width = portSize + 'px';
      port.style.height = portSize + 'px';
      port.style.pointerEvents = 'all';
      port.style.zIndex = '30';
    });

    const dot = node.querySelector('.node-status-dot');
    if (dot) {
      const dotSize = Math.max(4, 6 * s);
      dot.style.width = dotSize + 'px';
      dot.style.height = dotSize + 'px';
    }
  });

  redrawNodeConnections();
  drawNodeGrid();
}

// Mission J fix - real connectable ports
const nodeConnections = [];
let draggingConnection = null;
let selectedConnectionId = null;

function redrawNodeConnections() {
  const svg = document.getElementById('node-connections-svg');
  if (!svg) return;
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  svg.style.pointerEvents = 'none';
  const panel = document.getElementById('node-panel');
  if (!panel) return;
  const panelRect = panel.getBoundingClientRect();

  nodeConnections.forEach(conn => {
    const fromNode = document.querySelector(`.node-card[data-node="${conn.fromNode}"]`);
    const toNode = document.querySelector(`.node-card[data-node="${conn.toNode}"]`);
    if (!fromNode || !toNode) return;
    const fromPort = fromNode.querySelector('.node-port-out');
    const toPort = toNode.querySelector('.node-port-in');
    if (!fromPort || !toPort) return;

    const fr = fromPort.getBoundingClientRect();
    const tr = toPort.getBoundingClientRect();
    const x1 = fr.left - panelRect.left + fr.width / 2;
    const y1 = fr.top - panelRect.top + fr.height / 2;
    const x2 = tr.left - panelRect.left + tr.width / 2;
    const y2 = tr.top - panelRect.top + tr.height / 2;
    const cp = Math.abs(x2 - x1) * 0.5 + 60;
    const isSelected = conn.id === selectedConnectionId;
    const dStr = `M ${x1} ${y1} C ${x1+cp} ${y1}, ${x2-cp} ${y2}, ${x2} ${y2}`;

    // Wide invisible hit area for easier clicks
    const hitPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    hitPath.setAttribute('d', dStr);
    hitPath.setAttribute('stroke', 'transparent');
    hitPath.setAttribute('stroke-width', '12');
    hitPath.setAttribute('fill', 'none');
    hitPath.style.pointerEvents = 'visibleStroke';
    hitPath.style.cursor = 'pointer';

    hitPath.addEventListener('click', (e) => {
      e.stopPropagation();
      selectedConnectionId = isSelected ? null : conn.id;
      redrawNodeConnections();
    });

    hitPath.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const idx = nodeConnections.findIndex(c => c.id === conn.id);
      if (idx !== -1) nodeConnections.splice(idx, 1);
      const portRect = fromPort.getBoundingClientRect();
      const pr = panel.getBoundingClientRect();
      draggingConnection = {
        fromNode: conn.fromNode,
        startX: portRect.left - pr.left + portRect.width / 2,
        startY: portRect.top - pr.top + portRect.height / 2,
        currentX: e.clientX - pr.left,
        currentY: e.clientY - pr.top,
        type: 'reconnect'
      };
      selectedConnectionId = null;
      redrawNodeConnections();
      updatePipelineFromConnections();
    });

    svg.appendChild(hitPath);

    // Visible path
    const visPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    visPath.setAttribute('d', dStr);
    visPath.setAttribute('stroke', isSelected ? '#ffffff' : '#667');
    visPath.setAttribute('stroke-width', isSelected ? '2' : '1.5');
    visPath.setAttribute('fill', 'none');
    visPath.setAttribute('opacity', isSelected ? '1' : '0.7');
    visPath.style.pointerEvents = 'none';
    svg.appendChild(visPath);
  });

  // Drag preview
  if (draggingConnection) {
    const x1 = draggingConnection.startX;
    const y1 = draggingConnection.startY;
    const x2 = draggingConnection.currentX;
    const y2 = draggingConnection.currentY;
    const cp = Math.abs(x2 - x1) * 0.5 + 30;
    const preview = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    preview.setAttribute('d', `M ${x1} ${y1} C ${x1+cp} ${y1}, ${x2-cp} ${y2}, ${x2} ${y2}`);
    preview.setAttribute('stroke', '#aaa');
    preview.setAttribute('stroke-width', '1.2');
    preview.setAttribute('stroke-dasharray', '5 4');
    preview.setAttribute('fill', 'none');
    preview.setAttribute('opacity', '0.8');
    preview.style.pointerEvents = 'none';
    svg.appendChild(preview);
  }
}

function initNodePorts() {
  document.querySelectorAll('.node-port-out').forEach(port => {
    port.style.cursor = 'crosshair';
    port.style.pointerEvents = 'all';
    port.style.zIndex = '30';

    // Clone-replace removes any prior listeners so this is safe to call repeatedly
    const newPort = port.cloneNode(true);
    port.parentNode.replaceChild(newPort, port);

    newPort.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const panel = document.getElementById('node-panel');
      const panelRect = panel.getBoundingClientRect();
      const portRect = newPort.getBoundingClientRect();
      const fromNode = newPort.closest('.node-card').dataset.node;
      draggingConnection = {
        fromNode,
        startX: portRect.left - panelRect.left + portRect.width / 2,
        startY: portRect.top - panelRect.top + portRect.height / 2,
        currentX: portRect.left - panelRect.left + portRect.width / 2,
        currentY: portRect.top - panelRect.top + portRect.height / 2,
        type: 'new'
      };
      newPort.style.background = '#aaa';
    });
  });

  document.querySelectorAll('.node-port-in').forEach(port => {
    port.style.cursor = 'crosshair';
    port.style.pointerEvents = 'all';
    port.style.zIndex = '30';

    const newPort = port.cloneNode(true);
    port.parentNode.replaceChild(newPort, port);

    newPort.addEventListener('mouseenter', () => {
      if (draggingConnection) {
        newPort.style.background = '#4a9a4a';
        newPort.style.borderColor = '#4a9a4a';
      }
    });
    newPort.addEventListener('mouseleave', () => {
      newPort.style.background = '#444';
      newPort.style.borderColor = '#666';
    });
    newPort.addEventListener('mouseup', (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (!draggingConnection) return;
      const toNode = newPort.closest('.node-card').dataset.node;
      if (toNode === draggingConnection.fromNode) {
        draggingConnection = null;
        redrawNodeConnections();
        return;
      }
      const existingIdx = nodeConnections.findIndex(c => c.toNode === toNode);
      if (existingIdx !== -1) nodeConnections.splice(existingIdx, 1);
      nodeConnections.push({
        fromNode: draggingConnection.fromNode,
        toNode,
        id: Date.now() + Math.random()
      });
      draggingConnection = null;
      newPort.style.background = '#444';
      newPort.style.borderColor = '#666';
      redrawNodeConnections();
      updatePipelineFromConnections();
    });
  });
}

// Panel-level listeners for drag preview, drag cancel, deselect.
// Added once at module init since the panel element is stable.
(function _initNodePanelInteractions() {
  const panel = document.getElementById('node-panel');
  if (!panel || panel.dataset.connListenersWired === '1') return;
  panel.dataset.connListenersWired = '1';

  panel.addEventListener('mousemove', (e) => {
    if (!draggingConnection) return;
    const pr = panel.getBoundingClientRect();
    draggingConnection.currentX = e.clientX - pr.left;
    draggingConnection.currentY = e.clientY - pr.top;
    redrawNodeConnections();
  });

  panel.addEventListener('mouseup', () => {
    if (draggingConnection) {
      draggingConnection = null;
      document.querySelectorAll('.node-port-out, .node-port-in').forEach(p => {
        p.style.background = '#444';
        p.style.borderColor = '#666';
      });
      redrawNodeConnections();
    }
  });

  // Click on empty panel area deselects the active connection
  panel.addEventListener('click', (e) => {
    const grid = document.getElementById('node-grid-canvas');
    if (e.target !== panel && e.target !== grid) return;
    if (selectedConnectionId !== null) {
      selectedConnectionId = null;
      redrawNodeConnections();
    }
  });
})();

// Delete / Backspace removes the selected connection (separate from 3D-object delete on keyup)
window.addEventListener('keydown', (e) => {
  if (_isTypingTarget()) return;
  if ((e.key === 'Delete' || e.key === 'Backspace') && selectedConnectionId !== null) {
    const idx = nodeConnections.findIndex(c => c.id === selectedConnectionId);
    if (idx !== -1) {
      nodeConnections.splice(idx, 1);
      selectedConnectionId = null;
      redrawNodeConnections();
      updatePipelineFromConnections();
      e.preventDefault();
    }
  }
});

function updatePipelineFromConnections() {
  console.log('[NodeEditor] connections:', nodeConnections.map(c => `${c.fromNode} \u2192 ${c.toNode}`));
  syncNodeEditor();
}

function initDefaultConnections() {
  if (nodeConnections.length > 0) return;
  const defaultFlow = [
    { fromNode: 'mp4',      toNode: 'frame' },
    { fromNode: 'frame',    toNode: 'refimage' },
    { fromNode: 'refimage', toNode: 'prompt' },
    { fromNode: 'prompt',   toNode: 'render' },
    { fromNode: 'render',   toNode: 'upscale' }
  ];
  defaultFlow.forEach(c => nodeConnections.push({ ...c, id: Date.now() + Math.random() }));
  redrawNodeConnections();
}

function makeNodeDraggable(nodeEl) {
  const nodeId = nodeEl.dataset.node;
  if (!nodeId || !nodeBasePositions[nodeId]) return;
  let isDragging = false;
  let startMouseX, startMouseY;
  let startWorldX, startWorldY;
  const titleBar = nodeEl.querySelector('.node-title-bar');
  if (!titleBar) return;

  titleBar.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    isDragging = true;
    startMouseX = e.clientX;
    startMouseY = e.clientY;
    startWorldX = nodeBasePositions[nodeId].x;
    startWorldY = nodeBasePositions[nodeId].y;
    nodeEl.style.zIndex = '50';
    nodeEl.style.cursor = 'grabbing';
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const s = nodeEditorState.scale;
    const dx = (e.clientX - startMouseX) / s;
    const dy = (e.clientY - startMouseY) / s;
    nodeBasePositions[nodeId].x = startWorldX + dx;
    nodeBasePositions[nodeId].y = startWorldY + dy;
    const screen = worldToScreen(nodeBasePositions[nodeId].x, nodeBasePositions[nodeId].y);
    nodeEl.style.left = screen.x + 'px';
    nodeEl.style.top = screen.y + 'px';
    redrawNodeConnections();
  });

  window.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      nodeEl.style.zIndex = '10';
      nodeEl.style.cursor = 'default';
    }
  });
}

function updateNodeMediaPreviews() {
  if (pipelineState.mp4Path) {
    const mp4Content = document.querySelector('.node-card[data-node="mp4"] .node-content');
    if (mp4Content && !mp4Content.querySelector('input, textarea, button')) {
      const safeUrl = `file:///${pipelineState.mp4Path.replace(/\\/g, '/')}`;
      mp4Content.innerHTML = `
        <div class="node-media-preview">
          <video src="${safeUrl}" style="width:100%;height:100%;object-fit:cover;" preload="metadata" muted playsinline></video>
        </div>`;
      const video = mp4Content.querySelector('video');
      if (video) {
        video.addEventListener('loadedmetadata', () => { try { video.currentTime = 0.1; } catch (e) {} });
        video.addEventListener('mouseenter', () => { video.play().catch(() => {}); });
        video.addEventListener('mouseleave', () => { video.pause(); try { video.currentTime = 0.1; } catch (e) {} });
      }
    }
  }
  if (pipelineState.referenceImage) {
    const refContent = document.querySelector('.node-card[data-node="refimage"] .node-content');
    if (refContent && !refContent.querySelector('input, textarea, button')) {
      const safeUrl = `file:///${pipelineState.referenceImage.replace(/\\/g, '/')}`;
      refContent.innerHTML = `<div class="node-media-preview"><img src="${safeUrl}" alt="Reference"></div>`;
    }
  }
  if (pipelineState.aiResultUrl && !pipelineState.aiResultUrl.startsWith('mock://')) {
    const resultContent = document.querySelector('.node-card[data-node="render"] .node-content');
    if (resultContent && !resultContent.querySelector('input, textarea, button')) {
      resultContent.innerHTML = `<div class="node-media-preview"><video src="${pipelineState.aiResultUrl}" autoplay loop muted></video></div>`;
    }
  }
}

function _nodeCardHTML(id, title, subtitle, hasIn, hasOut, defaultContent) {
  return `
    <div class="node-card node-inactive" data-node="${id}">
      ${hasIn ? '<div class="node-port-in"></div>' : ''}
      ${hasOut ? '<div class="node-port-out"></div>' : ''}
      <div class="node-title-bar">
        <span>${title}${subtitle ? ` <span class="node-subtitle">${subtitle}</span>` : ''}</span>
        <span class="node-status-dot"></span>
      </div>
      <div class="node-body"><div class="node-content">${defaultContent || ''}</div></div>
    </div>`;
}

function buildNodeEditor() {
  const nodePanelEl = document.getElementById('node-panel');
  if (!nodePanelEl) return;

  nodePanelEl.innerHTML =
    _nodeCardHTML('mp4',      'MP4 Output',         'Step 1', false, true, '<span style="font-size:9px;color:#555;">Waiting for recording…</span>') +
    _nodeCardHTML('frame',    'Select Frame',       'Step 2', true,  true, '') +
    _nodeCardHTML('refimage', 'Reference Image',    'Step 3', true,  true, '') +
    _nodeCardHTML('prompt',   'Nanobanana Prompt',  'Step 4', true,  true, '') +
    _nodeCardHTML('render',   'AI Render',          'Step 5', true,  true, '') +
    _nodeCardHTML('upscale',  'Upscale',            'Step 6', true,  false, '');

  // Grid canvas behind nodes
  const gridCanvas = document.createElement('canvas');
  gridCanvas.id = 'node-grid-canvas';
  gridCanvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:0;';
  nodePanelEl.insertBefore(gridCanvas, nodePanelEl.firstChild);

  // SVG overlay for connections
  const connectionsSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  connectionsSvg.id = 'node-connections-svg';
  connectionsSvg.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:5;';
  nodePanelEl.appendChild(connectionsSvg);

  // Zoom controls
  const nodeControls = document.createElement('div');
  nodeControls.style.cssText = 'position:absolute;top:80px;right:16px;display:flex;flex-direction:column;gap:4px;z-index:999;pointer-events:all;';
  nodeControls.innerHTML = `
    <button class="node-ctrl-btn" id="node-zoom-in" title="Zoom In">+</button>
    <button class="node-ctrl-btn" id="node-zoom-out" title="Zoom Out">&#8722;</button>
    <button class="node-ctrl-btn" id="node-center" title="Center All Nodes">&#8857;</button>`;
  nodePanelEl.appendChild(nodeControls);

  document.getElementById('node-zoom-in').addEventListener('click', () => {
    const rect = nodePanelEl.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const factor = 1.2;
    const newScale = Math.min(nodeEditorState.maxScale, nodeEditorState.scale * factor);
    const realFactor = newScale / nodeEditorState.scale;
    nodeEditorState.offsetX = cx - realFactor * (cx - nodeEditorState.offsetX);
    nodeEditorState.offsetY = cy - realFactor * (cy - nodeEditorState.offsetY);
    nodeEditorState.scale = newScale;
    updateNodePositions();
  });
  document.getElementById('node-zoom-out').addEventListener('click', () => {
    const rect = nodePanelEl.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const factor = 0.8;
    const newScale = Math.max(nodeEditorState.minScale, nodeEditorState.scale * factor);
    const realFactor = newScale / nodeEditorState.scale;
    nodeEditorState.offsetX = cx - realFactor * (cx - nodeEditorState.offsetX);
    nodeEditorState.offsetY = cy - realFactor * (cy - nodeEditorState.offsetY);
    nodeEditorState.scale = newScale;
    updateNodePositions();
  });
  document.getElementById('node-center').addEventListener('click', () => {
    nodeEditorState.offsetX = 0;
    nodeEditorState.offsetY = 0;
    nodeEditorState.scale = 1;
    updateNodePositions();
  });

  // Pan: drag from empty panel space or grid canvas
  nodePanelEl.addEventListener('mousedown', (e) => {
    if (e.target !== nodePanelEl && e.target !== gridCanvas) return;
    nodeEditorState.isDragging = true;
    nodeEditorState.lastMouseX = e.clientX;
    nodeEditorState.lastMouseY = e.clientY;
    nodePanelEl.style.cursor = 'grabbing';
  });
  window.addEventListener('mousemove', (e) => {
    if (!nodeEditorState.isDragging) return;
    nodeEditorState.offsetX += e.clientX - nodeEditorState.lastMouseX;
    nodeEditorState.offsetY += e.clientY - nodeEditorState.lastMouseY;
    nodeEditorState.lastMouseX = e.clientX;
    nodeEditorState.lastMouseY = e.clientY;
    updateNodePositions();
    drawNodeGrid();
  });
  window.addEventListener('mouseup', () => {
    if (nodeEditorState.isDragging) {
      nodeEditorState.isDragging = false;
      nodePanelEl.style.cursor = 'default';
    }
  });

  // Zoom toward mouse cursor — keep the world point under the cursor fixed
  nodePanelEl.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.92 : 1.08;
    const newScale = Math.min(
      nodeEditorState.maxScale,
      Math.max(nodeEditorState.minScale, nodeEditorState.scale * factor)
    );
    const rect = nodePanelEl.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const worldX = (mouseX - nodeEditorState.offsetX) / nodeEditorState.scale;
    const worldY = (mouseY - nodeEditorState.offsetY) / nodeEditorState.scale;
    nodeEditorState.scale = newScale;
    nodeEditorState.offsetX = mouseX - worldX * newScale;
    nodeEditorState.offsetY = mouseY - worldY * newScale;
    updateNodePositions();
  }, { passive: false });

  // Make each node draggable by its title bar
  document.querySelectorAll('.node-card').forEach(node => makeNodeDraggable(node));

  wireNodeInteractions();
  updateNodePositions();
  drawNodeGrid();
  initNodePorts();
  initDefaultConnections();
  syncNodeEditor();
}

buildNodeEditor();

// Redraw grid + connections whenever the panel resizes (e.g. layout switch)
window.addEventListener('resize', () => {
  drawNodeGrid();
  redrawNodeConnections();
});

