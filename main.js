import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DecalGeometry } from 'three/examples/jsm/geometries/DecalGeometry.js';
import * as dat from 'dat.gui';

// Import assets with 'url:' prefix
import shirtGLB from 'url:./assets/shirt.glb';
import decalTextureURL from 'url:./assets/decal-texture.png';

// Scene Setup
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xdddddd);

// Camera Setup
const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);
camera.position.set(0, 1.6, 5);

// Renderer Setup
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

// Orbit Controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;

// Lighting Setup
const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
directionalLight.position.set(10, 10, 10);
directionalLight.castShadow = true;
scene.add(directionalLight);

// Helpers (Optional)
const axesHelper = new THREE.AxesHelper(5);
scene.add(axesHelper);

const gridHelper = new THREE.GridHelper(10, 10);
scene.add(gridHelper);

// Raycaster and Mouse Vector
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

// Decal Management
const decals = [];
let selectedDecal = null;
let draggedDecal = null;
let isDragging = false;
let wasDragging = false;
let dragOffset = new THREE.Vector3();

// Debounce Control
let canCreateDecal = true;
const clickDebounceTime = 200; // milliseconds
const maxDecals = 20; // Adjust as needed

// dat.GUI Setup
const gui = new dat.GUI({ autoPlace: false });
document.getElementById('gui-container').appendChild(gui.domElement);

const decalFolder = gui.addFolder('Decal Properties');
const decalProperties = {
  color: '#ff0000', // Start with red for visibility
  sizeX: 0.2,        // Further reduced size
  sizeY: 0.2,
  sizeZ: 0.01
};

decalFolder.addColor(decalProperties, 'color').name('Color').onChange((value) => {
  if (selectedDecal) {
    selectedDecal.material.color.set(value);
  }
});
decalFolder.add(decalProperties, 'sizeX', 0.05, 1).name('Size X').onChange(updateSelectedDecalSize);
decalFolder.add(decalProperties, 'sizeY', 0.05, 1).name('Size Y').onChange(updateSelectedDecalSize);
decalFolder.add(decalProperties, 'sizeZ', 0.005, 0.1).name('Size Z').onChange(updateSelectedDecalSize);
decalFolder.open();

const actions = {
  clearDecals: () => {
    decals.forEach(decal => scene.remove(decal));
    decals.length = 0;
    console.log('All decals cleared.');
  },
  undoDecal: () => {
    if (decals.length > 0) {
      const lastDecal = decals.pop();
      scene.remove(lastDecal);
      console.log('Last decal removed.');
    }
  }
};

gui.add(actions, 'clearDecals').name('Clear All Decals');
gui.add(actions, 'undoDecal').name('Undo Last Decal');

// GLTF Loader
const loader = new GLTFLoader();
let shirt;

loader.load(
  shirtGLB,
  (gltf) => {
    shirt = gltf.scene;
    console.log('Shirt model loaded:', shirt);

    // Traverse the model to find all meshes
    shirt.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        console.log('Mesh found:', child.name);
        console.log('Geometry attributes:', child.geometry.attributes);
      }
    });

    scene.add(shirt);

    // Optional: Add a Bounding Box Helper
    const bbox = new THREE.Box3().setFromObject(shirt);
    const bboxHelper = new THREE.Box3Helper(bbox, 0xff0000);
    scene.add(bboxHelper);

    // Optional: Add a test decal after ensuring the shirt is loaded
    const testPosition = bbox.getCenter(new THREE.Vector3()).clone();
    const testNormal = new THREE.Vector3(0, 1, 0); // Example normal; adjust based on your model
    const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), testNormal);
    const orientation = new THREE.Euler().setFromQuaternion(quaternion);
    const testSize = new THREE.Vector3(decalProperties.sizeX, decalProperties.sizeY, decalProperties.sizeZ);
    const testDecal = createDecal(testPosition, orientation, testSize);
    if (testDecal) decals.push(testDecal);

    // Load saved decals if any
    loadDecals();
  },
  (xhr) => {
    console.log(`${(xhr.loaded / xhr.total) * 100}% loaded`);
  },
  (error) => {
    console.error('An error occurred while loading the GLB file:', error);
  }
);

// Function to Create a Decal
function createDecal(position, orientation, size) {
  if (!shirt) {
    console.error('Shirt model is not loaded.');
    return null;
  }

  // Find the first mesh in the shirt group
  let mesh = null;
  shirt.traverse((child) => {
    if (child.isMesh) {
      mesh = child;
    }
  });

  if (!mesh) {
    console.error('No mesh found in the shirt model.');
    return null;
  }

  if (!mesh.geometry || !mesh.geometry.attributes.position || !mesh.geometry.attributes.normal) {
    console.error('Mesh geometry is missing required attributes.');
    return null;
  }

  // Create decal material
  const decalMaterial = new THREE.MeshPhongMaterial({
    color: decalProperties.color,
    map: new THREE.TextureLoader().load(decalTextureURL),
    transparent: false,       // Disable if not using transparent textures
    opacity: 1.0,             // Full opacity
    depthTest: false,         // Prevent decal from being hidden behind the mesh
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    shininess: 10,
    specular: 0x111111,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending // Change blending mode for better visibility
  });

  try {
    const decalGeometry = new DecalGeometry(
      mesh,
      position,
      orientation,
      size
    );

    const decal = new THREE.Mesh(decalGeometry, decalMaterial);
    decal.renderOrder = 1; // Ensure decals are rendered on top
    decal.userData.isDecal = true;
    scene.add(decal);

    console.log('Decal created at position:', position);
    console.log('Decal orientation:', orientation);
    console.log('Decal size:', size);

    return decal;
  } catch (error) {
    console.error('Error creating DecalGeometry:', error);
    return null;
  }
}

// Function to Update Decal Size
function updateSelectedDecalSize() {
  if (selectedDecal) {
    const newSize = new THREE.Vector3(decalProperties.sizeX, decalProperties.sizeY, decalProperties.sizeZ);
    const position = selectedDecal.position.clone();
    const orientation = new THREE.Euler().copy(selectedDecal.rotation);

    // Remove old decal
    scene.remove(selectedDecal);
    const index = decals.indexOf(selectedDecal);
    if (index > -1) decals.splice(index, 1);

    // Recreate decal with new size
    selectedDecal = createDecal(position, orientation, newSize);
    if (selectedDecal) {
      decals.push(selectedDecal);
    }
  }
}

// Mouse Event Handlers
window.addEventListener('mousedown', onMouseDownHandler, false);
window.addEventListener('mousemove', onMouseMoveHandler, false);
window.addEventListener('mouseup', onMouseUpHandler, false);
window.addEventListener('click', onClickHandler, false);
window.addEventListener('mousemove', onMouseHoverHandler, false); // For cursor change

// Variables to Track Mouse Movement for Drag vs. Click
let mouseDownPos = new THREE.Vector2();
const dragThreshold = 5; // Pixels

// Handle Mouse Down
function onMouseDownHandler(event) {
  // Record the initial mouse position
  mouseDownPos.set(event.clientX, event.clientY);

  // Set up the raycaster
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);

  // Check if a decal is clicked
  const intersects = raycaster.intersectObjects(decals, true);

  if (intersects.length > 0) {
    draggedDecal = intersects[0].object;
    isDragging = true;

    // Highlight the selected decal
    draggedDecal.material.emissive.setHex(0x444444);

    // Disable OrbitControls to prevent camera movement
    controls.enabled = false;

    // Change cursor to grabbing
    document.body.style.cursor = 'grabbing';

    // Calculate drag offset
    dragOffset.copy(draggedDecal.position).sub(intersects[0].point);
  }
}

// Handle Mouse Move
function onMouseMoveHandler(event) {
  if (isDragging && draggedDecal) {
    // Calculate distance moved
    const deltaX = event.clientX - mouseDownPos.x;
    const deltaY = event.clientY - mouseDownPos.y;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

    if (distance > dragThreshold) {
      wasDragging = true; // Movement exceeds threshold, consider it a drag

      // Update the raycaster
      mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
      mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);

      // Define a plane based on the decal's current orientation
      const decalNormal = new THREE.Vector3();
      draggedDecal.getWorldDirection(decalNormal);
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(decalNormal, draggedDecal.position);

      const intersection = new THREE.Vector3();
      raycaster.ray.intersectPlane(plane, intersection);

      if (intersection) {
        const newPosition = intersection.add(dragOffset);

        // Get shirt's bounding box
        const bbox = new THREE.Box3().setFromObject(shirt);

        if (bbox.containsPoint(newPosition)) {
          draggedDecal.position.copy(newPosition);
          // Maintain orientation
          draggedDecal.rotation.copy(new THREE.Euler().setFromQuaternion(
            new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), decalNormal)
          ));
          console.log('Decal moved to:', draggedDecal.position);
        } else {
          console.warn('Decal movement out of bounds.');
        }
      }
    }
  }
}

// Handle Mouse Up
function onMouseUpHandler(event) {
  if (isDragging && draggedDecal) {
    // Remove highlight from decal
    draggedDecal.material.emissive.setHex(0x000000);
  }

  if (isDragging && wasDragging) {
    // A drag occurred, prevent the click event from firing a new decal
    wasDragging = false;
    event.preventDefault();
    event.stopPropagation();
  }

  // Reset dragging state
  isDragging = false;
  draggedDecal = null;

  // Re-enable OrbitControls
  controls.enabled = true;

  // Reset cursor
  document.body.style.cursor = 'default';
}

// Handle Click
function onClickHandler(event) {
  if (!canCreateDecal || wasDragging || decals.length >= maxDecals) return;

  // Calculate mouse position in normalized device coordinates (-1 to +1)
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

  // Update the raycaster
  raycaster.setFromCamera(mouse, camera);

  // Calculate intersects with the shirt mesh
  const intersects = raycaster.intersectObject(shirt, true);

  if (intersects.length > 0) {
    const intersect = intersects[0];
    if (!intersect.object.userData.isDecal && intersect.face) { // Ensure it's not a decal and has a face

      const position = intersect.point.clone(); // Intersection point
      const normal = intersect.face.normal.clone(); // Surface normal

      if (!normal) {
        console.error('Intersected face has no normal.');
        return;
      }

      // Transform normal to world space
      const worldNormal = normal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(intersect.object.matrixWorld)).normalize();

      // Calculate orientation quaternion to align decal with the normal
      const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), worldNormal);
      const orientation = new THREE.Euler().setFromQuaternion(quaternion);

      // Define decal size (adjusted)
      const size = new THREE.Vector3(decalProperties.sizeX, decalProperties.sizeY, decalProperties.sizeZ);

      // Define an offset distance to place the decal outside the mesh
      const offsetDistance = 0.02; // Adjust as needed

      // Offset the position along the normal
      const decalPosition = position.clone().add(worldNormal.clone().multiplyScalar(offsetDistance));

      // Create the decal at the offset position
      const newDecal = createDecal(decalPosition, orientation, size);
      if (newDecal) {
        decals.push(newDecal);
        console.log('Decal placed at:', decalPosition);
      }
    } else {
      console.warn('Clicked on a decal or no valid face normal found.');
    }
  }

  // Debounce to prevent multiple decals from rapid clicks
  canCreateDecal = false;
  setTimeout(() => {
    canCreateDecal = true;
  }, clickDebounceTime);
}

// Handle Cursor Change on Hover
function onMouseHoverHandler(event) {
  if (isDragging) return; // Do not change cursor while dragging

  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);

  const intersects = raycaster.intersectObjects(decals, true);

  if (intersects.length > 0) {
    document.body.style.cursor = 'grab';
  } else {
    document.body.style.cursor = 'default';
  }
}

// Animation Loop
const animate = function () {
  requestAnimationFrame(animate);
  controls.update(); // Update controls
  renderer.render(scene, camera);
};

animate();

// Handle Window Resize
window.addEventListener(
  'resize',
  () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  },
  false
);

// Function to Save Decals
function saveDecals() {
  const decalData = decals.map(decal => ({
    position: decal.position.toArray(),
    rotation: [decal.rotation.x, decal.rotation.y, decal.rotation.z],
    scale: [decal.scale.x, decal.scale.y, decal.scale.z],
    color: decal.material.color.getHex()
  }));
  localStorage.setItem('decals', JSON.stringify(decalData));
  console.log('Decals saved.');
}

// Function to Load Decals
function loadDecals() {
  const decalData = JSON.parse(localStorage.getItem('decals'));
  if (decalData) {
    decalData.forEach(data => {
      const position = new THREE.Vector3().fromArray(data.position);
      const orientation = new THREE.Euler(...data.rotation);
      const size = new THREE.Vector3(...data.scale);
      const newDecal = createDecal(position, orientation, size);
      if (newDecal) {
        newDecal.material.color.setHex(data.color);
        decals.push(newDecal);
      }
    });
    console.log('Decals loaded.');
  }
}

// Save decals on window unload
window.addEventListener('beforeunload', saveDecals);

