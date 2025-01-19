import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DecalGeometry } from 'three/examples/jsm/geometries/DecalGeometry.js';
import * as dat from 'dat.gui';

// Import assets
import shirtGLB from 'url:./assets/shirt.glb';
// Decal images will be loaded dynamically based on drag-and-drop

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
let draggedDecal = null;
let selectedDecal = null;

// Drag Offset
const dragOffset = new THREE.Vector3();

// Debounce Control
let canCreateDecal = true;
const clickDebounceTime = 200; // milliseconds
const maxDecals = 20; // Adjust as needed

// Drag State Flags
let isDragging = false;
let wasDragging = false;

// dat.GUI Setup
const gui = new dat.GUI({ autoPlace: false });
document.getElementById('gui-container').appendChild(gui.domElement);

const decalFolder = gui.addFolder('Decal Properties');
const decalProperties = {
  sizeX: 0.2,        // Adjusted size
  sizeY: 0.2,
  sizeZ: 0.01
};

decalFolder.add(decalProperties, 'sizeX', 0.05, 1).name('Size X').onChange(updateDecalSize);
decalFolder.add(decalProperties, 'sizeY', 0.05, 1).name('Size Y').onChange(updateDecalSize);
decalFolder.add(decalProperties, 'sizeZ', 0.005, 0.1).name('Size Z').onChange(updateDecalSize);
decalFolder.open();

// GUI Actions
const actions = {
  clearDecals: () => {
    decals.forEach(decal => scene.remove(decal));
    decals.length = 0;
    console.log('All decals cleared. Current decals array:', decals);
  },
  undoDecal: () => {
    if (decals.length > 0) {
      const lastDecal = decals.pop();
      scene.remove(lastDecal);
      console.log('Last decal removed. Current decals array:', decals);
    } else {
      console.log('No decals to undo.');
    }
  }
};

gui.add(actions, 'clearDecals').name('Clear All Decals');
gui.add(actions, 'undoDecal').name('Undo Last Decal');

// Load Shirt Model
const loader = new GLTFLoader();
let shirt;

loader.load(
  shirtGLB,
  (gltf) => {
    shirt = gltf.scene;
    console.log('Shirt model loaded:', shirt);

    // Enable shadows on all meshes
    shirt.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        console.log('Mesh found:', child.name);
      }
    });

    scene.add(shirt);

    // Optional: Add a Bounding Box Helper
    const bbox = new THREE.Box3().setFromObject(shirt);
    const bboxHelper = new THREE.Box3Helper(bbox, 0xff0000);
    scene.add(bboxHelper);

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
function createDecal(position, orientation, size, decalSrc) {
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

  // Load the decal texture based on the dragged image
  const decalTexture = new THREE.TextureLoader().load(decalSrc, () => {
    console.log('Decal texture loaded:', decalSrc);
  }, undefined, (error) => {
    console.error('Error loading decal texture:', error);
  });

  // Create decal material
  const decalMaterial = new THREE.MeshPhongMaterial({
    map: decalTexture,
    transparent: true,        // Enable transparency if decal has transparent parts
    depthTest: false,         // Prevent decal from being hidden behind the mesh
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    shininess: 10,
    specular: 0x111111,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending // Adjust blending mode as needed
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

    decals.push(decal);
    console.log('Decal created at position:', position);
    return decal;
  } catch (error) {
    console.error('Error creating DecalGeometry:', error);
    return null;
  }
}

// Function to Update Decal Size
function updateDecalSize() {
  if (selectedDecal) {
    const newSize = new THREE.Vector3(decalProperties.sizeX, decalProperties.sizeY, decalProperties.sizeZ);
    const position = selectedDecal.position.clone();
    const orientation = new THREE.Euler().copy(selectedDecal.rotation);

    // Remove old decal
    scene.remove(selectedDecal);
    const index = decals.indexOf(selectedDecal);
    if (index > -1) decals.splice(index, 1);

    // Recreate decal with new size
    selectedDecal = createDecal(position, orientation, newSize, selectedDecal.material.map.image.src);
    if (selectedDecal) {
      console.log('Decal size updated. New decals array:', decals);
    }
  }
}

// Event Listeners for Drag-and-Drop from Decal Panel
const decalPanel = document.getElementById('decal-panel');
const decalItems = document.querySelectorAll('.decal-item');

// Variable to store the current decal being dragged from the panel
let currentDecalImage = null;

// Handle Drag Start
decalItems.forEach(item => {
  item.addEventListener('dragstart', (event) => {
    currentDecalImage = event.target;
    event.target.classList.add('dragging');
    console.log('Decal dragged:', currentDecalImage.id);
  });
});

// Handle Drag End
decalItems.forEach(item => {
  item.addEventListener('dragend', (event) => {
    event.target.classList.remove('dragging');
    currentDecalImage = null;
  });
});

// Make the Three.js canvas a drop zone for decal placement
renderer.domElement.addEventListener('dragover', (event) => {
  event.preventDefault(); // Necessary to allow a drop
});

renderer.domElement.addEventListener('drop', (event) => {
  event.preventDefault();

  if (currentDecalImage) {
    if (decals.length >= maxDecals) {
      alert(`Maximum of ${maxDecals} decals reached.`);
      return;
    }

    // Get the mouse position relative to the canvas
    const rect = renderer.domElement.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    // Convert mouse position to normalized device coordinates (-1 to +1)
    mouse.x = (mouseX / renderer.domElement.clientWidth) * 2 - 1;
    mouse.y = - (mouseY / renderer.domElement.clientHeight) * 2 + 1;

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

        // Define decal size (adjust as needed)
        const size = new THREE.Vector3(decalProperties.sizeX, decalProperties.sizeY, decalProperties.sizeZ);

        // Define an offset distance to place the decal slightly above the mesh
        const offsetDistance = 0.005; // Fine-tuned for better alignment

        // Offset the position along the normal
        const decalPosition = position.clone().add(worldNormal.clone().multiplyScalar(offsetDistance));

        // Create the decal at the offset position using the dragged decal's image source
        const newDecal = createDecal(decalPosition, orientation, size, currentDecalImage.src);
        if (newDecal) {
          console.log('Decal placed via drag-and-drop at:', decalPosition);
        }
      } else {
        console.warn('Dropped on a decal or no valid face normal found.');
      }
    }

    // Reset the current decal image
    currentDecalImage = null;
  }
});

// Event Listeners for Selecting and Moving Existing Decals
renderer.domElement.addEventListener('mousedown', onCanvasMouseDown, false);
renderer.domElement.addEventListener('mousemove', onCanvasMouseMove, false);
renderer.domElement.addEventListener('mouseup', onCanvasMouseUp, false);

// Variables to Track Mouse Movement for Drag vs. Click
let canvasMouseDownPos = new THREE.Vector2();
const canvasDragThreshold = 5; // Pixels

// Handle Mouse Down on Canvas for Decal Selection
function onCanvasMouseDown(event) {
  event.preventDefault();
  canvasMouseDownPos.set(event.clientX, event.clientY);

  // Get mouse position relative to canvas
  const rect = renderer.domElement.getBoundingClientRect();
  const mouseX = event.clientX - rect.left;
  const mouseY = event.clientY - rect.top;

  // Convert mouse position to normalized device coordinates (-1 to +1)
  mouse.x = (mouseX / renderer.domElement.clientWidth) * 2 - 1;
  mouse.y = - (mouseY / renderer.domElement.clientHeight) * 2 + 1;

  // Update the raycaster
  raycaster.setFromCamera(mouse, camera);

  // Check for intersection with existing decals
  const intersects = raycaster.intersectObjects(decals, true);

  if (intersects.length > 0) {
    selectedDecal = intersects[0].object;
    isDragging = true;
    wasDragging = false;

    // Highlight the selected decal
    selectedDecal.material.emissive.setHex(0x444444);
    console.log('Decal selected for moving:', selectedDecal);

    // Disable OrbitControls to prevent camera movement during dragging
    controls.enabled = false;

    // Change cursor to grabbing
    document.body.style.cursor = 'grabbing';

    // Calculate drag offset
    dragOffset.copy(selectedDecal.position).sub(intersects[0].point);
    console.log('Drag offset calculated:', dragOffset);
  }
}

// Handle Mouse Move on Canvas for Decal Movement
function onCanvasMouseMove(event) {
  if (isDragging && selectedDecal) {
    // Calculate distance moved
    const deltaX = event.clientX - canvasMouseDownPos.x;
    const deltaY = event.clientY - canvasMouseDownPos.y;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

    if (distance > canvasDragThreshold) {
      wasDragging = true; // Movement exceeds threshold, consider it a drag

      // Get mouse position relative to canvas
      const rect = renderer.domElement.getBoundingClientRect();
      const mouseX = event.clientX - rect.left;
      const mouseY = event.clientY - rect.top;

      // Convert mouse position to normalized device coordinates (-1 to +1)
      mouse.x = (mouseX / renderer.domElement.clientWidth) * 2 - 1;
      mouse.y = - (mouseY / renderer.domElement.clientHeight) * 2 + 1;

      // Update the raycaster
      raycaster.setFromCamera(mouse, camera);

      // Define a plane based on the decal's current orientation
      const decalNormal = new THREE.Vector3();
      selectedDecal.getWorldDirection(decalNormal);
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(decalNormal, selectedDecal.position);

      const intersection = new THREE.Vector3();
      raycaster.ray.intersectPlane(plane, intersection);

      if (intersection) {
        // Calculate the new position using dragOffset
        const newPosition = intersection.clone().add(dragOffset);

        // Get shirt's bounding box
        const bbox = new THREE.Box3().setFromObject(shirt);

        if (bbox.containsPoint(newPosition)) {
          selectedDecal.position.copy(newPosition);
          // Maintain orientation
          selectedDecal.rotation.copy(new THREE.Euler().setFromQuaternion(
            new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), decalNormal)
          ));
          console.log('Decal moved to:', selectedDecal.position);
        } else {
          console.warn('Decal movement out of bounds.');
        }
      }
    }
  }
}

// Handle Mouse Up on Canvas to Finalize Decal Movement
function onCanvasMouseUp(event) {
  if (isDragging && selectedDecal) {
    // Remove highlight from decal
    selectedDecal.material.emissive.setHex(0x000000);
    console.log('Decal deselected after moving:', selectedDecal);
  }

  if (isDragging && wasDragging) {
    // A drag occurred, prevent the click event from firing a new decal
    wasDragging = false;
    event.preventDefault();
    event.stopPropagation();
    console.log('Decal movement completed.');
  }

  // Reset dragging state
  isDragging = false;
  selectedDecal = null;

  // Re-enable OrbitControls
  controls.enabled = true;

  // Reset cursor
  document.body.style.cursor = 'default';
}

// Handle Cursor Change on Hover Over Decals
renderer.domElement.addEventListener('mousemove', onCanvasMouseHover, false);

function onCanvasMouseHover(event) {
  if (isDragging) return; // Do not change cursor while dragging

  // Get mouse position relative to canvas
  const rect = renderer.domElement.getBoundingClientRect();
  const mouseX = event.clientX - rect.left;
  const mouseY = event.clientY - rect.top;

  // Convert mouse position to normalized device coordinates (-1 to +1)
  mouse.x = (mouseX / renderer.domElement.clientWidth) * 2 - 1;
  mouse.y = - (mouseY / renderer.domElement.clientHeight) * 2 + 1;

  // Update the raycaster
  raycaster.setFromCamera(mouse, camera);

  // Check for intersection with existing decals
  const intersects = raycaster.intersectObjects(decals, true);

  if (intersects.length > 0) {
    document.body.style.cursor = 'grab';
    // Optional: Highlight decal on hover
    if (!isDragging && intersects[0].object !== selectedDecal) {
      // Reset emissive color for all decals except the selected one
      decals.forEach(decal => {
        if (decal !== intersects[0].object) {
          decal.material.emissive.setHex(0x000000);
        }
      });
      // Highlight hovered decal
      intersects[0].object.material.emissive.setHex(0x333333);
    }
  } else {
    document.body.style.cursor = 'default';
    // Reset emissive color for all decals
    decals.forEach(decal => {
      decal.material.emissive.setHex(0x000000);
    });
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
    console.log('Window resized. Renderer and camera updated.');
  },
  false
);

// Function to Save Decals
function saveDecals() {
  const decalData = decals.map(decal => ({
    position: decal.position.toArray(),
    rotation: [decal.rotation.x, decal.rotation.y, decal.rotation.z],
    scale: [decal.scale.x, decal.scale.y, decal.scale.z],
    textureSrc: decal.material.map.image.src
  }));
  localStorage.setItem('decals', JSON.stringify(decalData));
  console.log('Decals saved to localStorage.');
}

// Function to Load Decals
function loadDecals() {
  const decalData = JSON.parse(localStorage.getItem('decals'));
  if (decalData) {
    decalData.forEach(data => {
      const position = new THREE.Vector3().fromArray(data.position);
      const orientation = new THREE.Euler(...data.rotation);
      const size = new THREE.Vector3(...data.scale);
      const newDecal = createDecal(position, orientation, size, data.textureSrc);
      if (newDecal) {
        console.log('Decal loaded from localStorage:', newDecal);
      }
    });
    console.log('All decals loaded from localStorage. Current decals array:', decals);
  } else {
    console.log('No decals found in localStorage.');
  }
}

// Save decals on window unload
window.addEventListener('beforeunload', saveDecals);
