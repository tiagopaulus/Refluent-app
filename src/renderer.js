import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { getTranslation, setLanguage } from './i18n.js';

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

// ---- Scene Setup ----
const container = document.getElementById('viewport');
debug('Container element: ' + (container ? 'FOUND' : 'NULL'));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a1a);
debug('Scene created');

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(5, 5, 5);
debug('Camera created');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
debug('Renderer created, size: ' + window.innerWidth + 'x' + window.innerHeight);
try {
  container.appendChild(renderer.domElement);
  debug('Canvas appended to DOM');
} catch (e) {
  debug('ERROR appending canvas: ' + e.message);
}

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

const gridHelper = new THREE.GridHelper(20, 20, 0x444444, 0x222222);
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
sunControlEl.style.cssText = 'position:absolute;top:60px;left:16px;width:64px;height:64px;z-index:100;cursor:crosshair;';
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
sunResetEl.style.cssText = 'position:absolute;top:128px;left:16px;font-size:10px;color:#555;text-align:center;width:64px;cursor:pointer;z-index:100;';
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
}
debug('Calling animate()...');
try {
  animate();
  debug('animate() called successfully');
} catch (e) {
  debug('ERROR in animate(): ' + e.message);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
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
const clearTargetBtn = document.getElementById('clear-target-btn');

const targetPanel = document.getElementById('target-panel');
const targetPosX = document.getElementById('target-pos-x');
const targetPosY = document.getElementById('target-pos-y');
const targetPosZ = document.getElementById('target-pos-z');
const targetPosXVal = document.getElementById('target-pos-x-val');
const targetPosYVal = document.getElementById('target-pos-y-val');
const targetPosZVal = document.getElementById('target-pos-z-val');
const targetResetBtn = document.getElementById('target-reset-btn');
const targetClearBtn = document.getElementById('target-clear-btn');

const updateTargetUI = () => {
  if (!targetGlyph.visible) return;
  const tx = controls.target.x;
  const ty = controls.target.y;
  const tz = controls.target.z;
  targetPosX.value = tx;
  targetPosY.value = ty;
  targetPosZ.value = tz;
  targetPosXVal.innerText = tx.toFixed(1);
  targetPosYVal.innerText = ty.toFixed(1);
  targetPosZVal.innerText = tz.toFixed(1);
};

const handleTargetInput = (axis, value) => {
  if (!targetGlyph.visible) return;
  let val = parseFloat(value);
  controls.target[axis] = val;
  targetGlyph.position[axis] = val;
  if (axis === 'x') targetPosXVal.innerText = val.toFixed(1);
  if (axis === 'y') targetPosYVal.innerText = val.toFixed(1);
  if (axis === 'z') targetPosZVal.innerText = val.toFixed(1);
};

targetPosX.addEventListener('input', (e) => handleTargetInput('x', e.target.value));
targetPosY.addEventListener('input', (e) => handleTargetInput('y', e.target.value));
targetPosZ.addEventListener('input', (e) => handleTargetInput('z', e.target.value));

targetResetBtn.addEventListener('click', () => {
  controls.target.set(0, 0, 0);
  targetGlyph.position.set(0, 0, 0);
  updateTargetUI();
});

const clearTargetAction = () => {
  controls.target.set(0, 0, 0);
  targetGlyph.visible = false;
  clearTargetBtn.classList.add('hidden');
  targetPanel.classList.add('hidden');
};

setTargetBtn.addEventListener('click', () => {
  isSettingTarget = true;
  document.body.style.cursor = 'crosshair';
});

clearTargetBtn.addEventListener('click', clearTargetAction);
targetClearBtn.addEventListener('click', clearTargetAction);

let selectedObject = null;

const scalePanel = document.getElementById('scale-panel');
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

let isSKeyDown = false;
let isGKeyDown = false;
let isTKeyDown = false;
window.addEventListener('keydown', (e) => {
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
  
  if (!handled && !targetPanel.classList.contains('hidden') && isTKeyDown) {
    if (!selectedObject) {
      e.preventDefault();
      e.stopPropagation();
      const delta = e.deltaY < 0 ? 0.1 : -0.1;
      let newY = controls.target.y + delta;
      newY = Math.max(-20, Math.min(20, newY));
      controls.target.y = newY;
      targetGlyph.position.y = newY;
      updateTargetUI();
    }
  }
}, { passive: false });

const deleteBtn = document.getElementById('delete-btn');
const deleteSelection = () => {
  if (selectedObject) {
    scene.remove(selectedObject);
    selectedObject = null;
    deleteBtn.classList.add('hidden');
    scalePanel.classList.add('hidden');
  }
};

deleteBtn.addEventListener('click', deleteSelection);
window.addEventListener('keyup', (e) => {
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
      deleteBtn.classList.add('hidden');
      scalePanel.classList.add('hidden');
    }
  }
});

renderer.domElement.addEventListener('pointerdown', (event) => {
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

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
      targetGlyph.visible = true;
      clearTargetBtn.classList.remove('hidden');
      updateTargetUI();
      targetPanel.classList.remove('hidden');
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
        
        deleteBtn.classList.remove('hidden');
        updateTransformUI();
        scalePanel.classList.remove('hidden');
      }
    } else {
      deleteBtn.classList.add('hidden');
      scalePanel.classList.add('hidden');
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
  scene.add(mesh);
});

document.getElementById('add-sphere-btn').addEventListener('click', () => {
  const geometry = new THREE.SphereGeometry(0.6, 32, 32);
  const material = new THREE.MeshStandardMaterial({ color: 0xff3366, roughness: 0.4 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = 0.6;
  mesh.position.x = 2;
  mesh.userData.isUserObject = true;
  mesh.userData.modelName = "Sphere";
  scene.add(mesh);
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
    scene.add(wrapper);
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
  'record-btn', 'stop-btn', 'add-box-btn', 'add-sphere-btn', 'import-model-btn', 'clear-scene-btn', 'set-target-btn', 'clear-target-btn', 'delete-btn', 'cam-play-btn', 'cam-stop-btn'
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

recordBtn.addEventListener('click', () => {
  recordedChunks = [];
  
  const userObjects = scene.children.filter(c => c.userData.isUserObject);
  if (userObjects.length === 0) {
    alert(getTranslation('noObjectsWarning'));
    return;
  }
  
  // Save visibility states
  const gridWasVisible = gridHelper.visible;
  const glyphWasVisible = targetGlyph.visible;
  const gizmoDisplay = gizmoRenderer.domElement.style.display;
  
  // Hide elements for recording
  gridHelper.visible = false;
  targetGlyph.visible = false;
  gizmoRenderer.domElement.style.display = 'none';
  
  const stream = renderer.domElement.captureStream(30); 
  
  const mimeType = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ].find(type => MediaRecorder.isTypeSupported(type));

  try {
    mediaRecorder = new MediaRecorder(stream, { 
      mimeType: mimeType,
      videoBitsPerSecond: 8000000 
    });
  } catch (e) {
    console.error('MediaRecorder not supported', e);
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

    if (recordedChunks.length === 0) {
      console.log('No chunks recorded');
      return;
    }

    const blob = new Blob(recordedChunks, { type: mimeType });
    const arrayBuffer = await blob.arrayBuffer();
    
    // Restore visibility after blob assembled
    gridHelper.visible = gridWasVisible;
    targetGlyph.visible = glyphWasVisible;
    gizmoRenderer.domElement.style.display = gizmoDisplay;
    
    const duration = (Date.now() - recordingStartTime) / 1000;
    disableButtons();
    document.getElementById('export-overlay').classList.remove('hidden');
    
    const result = await window.electronAPI.convertWebmToMp4({ arrayBuffer, duration });
    
    document.getElementById('export-overlay').classList.add('hidden');
    enableButtons();
    
    if (result.success) {
      console.log('Saved to', result.filePath);
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
    if (currentCamType === 'pushIn' || currentCamType === 'pullOut') {
      camDirSection.style.display = 'none';
    } else {
      camDirSection.style.display = 'flex';
      if (currentCamType === 'tilt') {
        lblDir1.innerText = getTranslation('up');
        lblDir1.setAttribute('data-i18n', 'up');
        lblDir2.innerText = getTranslation('down');
        lblDir2.setAttribute('data-i18n', 'down');
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

function updateCamStatus() {
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

  animTimeElapsed = 0;
  animDuration = parseFloat(camDurSlider.value);
  animClock.start();
  
  camAnimState = animIsLoop ? 'looping' : 'playing';
  updateCamStatus();
  controls.enabled = false;
}

camPlayBtn.addEventListener('click', startCameraMove);

camStopBtn.addEventListener('click', () => {
  if (camAnimState !== 'idle' && camAnimState !== 'stopping') {
    stopStartPos.copy(camera.position);
    stopStartQuat.copy(camera.quaternion);
    stopEaseTime = 0;
    camAnimState = 'stopping';
    updateCamStatus();
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
  }

  if (camLockTarget.checked && currentCamType !== 'pan' && currentCamType !== 'tilt') {
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
  sunDragging = false;
  sunBtn.style.outline = 'none';
});

sunReset.addEventListener('click', () => {
  dirLight.position.set(defaultLightPos.x, defaultLightPos.y, defaultLightPos.z);
  dirLight.target.updateMatrixWorld();
});

// ---- Vignette + Lens HUD ----
const vignetteEl = document.createElement('div');
vignetteEl.id = 'vignette-overlay';
vignetteEl.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:10;border-radius:0;background:radial-gradient(ellipse at center, transparent 60%, rgba(0,0,0,1) 100%);opacity:0.10;';
document.getElementById('viewport').appendChild(vignetteEl);

const lensHudEl = document.createElement('div');
lensHudEl.id = 'lens-hud';
lensHudEl.style.cssText = 'position:absolute;top:145px;left:16px;font-size:11px;color:rgba(255,255,255,0.5);pointer-events:none;z-index:20;font-family:monospace;';
lensHudEl.innerText = 'Zeiss Milvus 35mm';
document.getElementById('viewport').appendChild(lensHudEl);

// ---- Lens Selector Handler ----
const lensSelect = document.getElementById('lens-select');
lensSelect.addEventListener('change', () => {
  const lens = LENS_TEMPLATES[parseInt(lensSelect.value)];
  targetFov = lens.fov;
  camera.near = lens.near;
  camera.far = lens.far;
  camera.updateProjectionMatrix();
  document.getElementById('vignette-overlay').style.opacity = lens.vignette;
  document.getElementById('lens-hud').innerText = lens.name;
});

// ---- Mission 7: UX Pass ----

// 1. Welcome overlay (first launch)
if (!localStorage.getItem('first_launch')) {
  const wSlides = [
    { titleKey: 'slide1Title', bodyKey: 'slide1Body' },
    { titleKey: 'slide2Title', bodyKey: 'slide2Body' },
    { titleKey: 'slide3Title', bodyKey: 'slide3Body' },
  ];
  let wSlideIdx = 0;

  const wOverlay = document.createElement('div');
  wOverlay.id = 'welcome-overlay';
  wOverlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);z-index:1000;display:flex;align-items:center;justify-content:center;';

  const wCard = document.createElement('div');
  wCard.style.cssText = 'background:#1e1e1e;border:1px solid #444;border-radius:12px;width:480px;max-width:90vw;padding:40px;color:white;';

  const wCounter = document.createElement('div');
  wCounter.style.cssText = 'font-size:11px;color:#888;margin-bottom:12px;';

  const wTitle = document.createElement('h2');
  wTitle.style.cssText = 'margin:0 0 16px 0;font-size:22px;font-weight:600;';

  const wBody = document.createElement('p');
  wBody.style.cssText = 'margin:0 0 32px 0;font-size:14px;color:#ccc;line-height:1.6;';

  const wFooter = document.createElement('div');
  wFooter.style.cssText = 'display:flex;justify-content:space-between;align-items:center;';

  const wSkip = document.createElement('span');
  wSkip.style.cssText = 'font-size:12px;color:#555;cursor:pointer;text-decoration:underline;';
  wSkip.innerText = getTranslation('welcomeSkip');

  const wNext = document.createElement('button');
  wNext.style.cssText = 'background:#007bff;color:white;border:none;border-radius:6px;padding:10px 24px;font-size:14px;cursor:pointer;';

  wFooter.appendChild(wSkip);
  wFooter.appendChild(wNext);
  wCard.appendChild(wCounter);
  wCard.appendChild(wTitle);
  wCard.appendChild(wBody);
  wCard.appendChild(wFooter);
  wOverlay.appendChild(wCard);
  document.body.appendChild(wOverlay);

  const wDismiss = () => {
    localStorage.setItem('first_launch', 'done');
    wOverlay.style.display = 'none';
  };

  const wShowSlide = (idx) => {
    wCounter.innerText = `${idx + 1} / ${wSlides.length}`;
    wTitle.innerText = getTranslation(wSlides[idx].titleKey);
    wBody.innerText = getTranslation(wSlides[idx].bodyKey);
    wNext.innerText = idx === wSlides.length - 1 ? getTranslation('welcomeFinish') : getTranslation('welcomeNext');
  };

  wNext.addEventListener('click', () => {
    if (wSlideIdx < wSlides.length - 1) {
      wSlideIdx++;
      wShowSlide(wSlideIdx);
    } else {
      wDismiss();
    }
  });
  wSkip.addEventListener('click', wDismiss);
  wShowSlide(0);
}

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

