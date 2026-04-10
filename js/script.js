// creadit : https://codepen.io/sabosugi/pen/JoRpVeO
import * as THREE from 'three';
        import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
        import GUI from 'lil-gui';
        import { addWaveControls } from '../lil-gui/wave-controls.js';
        import { addZoomControls } from '../lil-gui/zoom-controls.js';
        import { devMode } from '../lil-gui/gui-config.js';
    import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
    import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
    import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

        // --- Core Variables ---
        let scene, camera, renderer, controls;
        let sceneRoot;
        let ambientLight, dirLight, backLight;
        let instancedMesh;
        let composer, renderPass, bloomPass;
        let currentImage = null;
        let imgData = null;
        let gridW = 0, gridH = 0;
        let positions = []; // Store base positions of instances
        const dummy = new THREE.Object3D();
        const clock = new THREE.Clock();
        let baseCameraDistance = 0; // world-size-derived camera distance used for zoom calculations

        // --- Configuration object (editable) ---
        // Edit `config` directly to change defaults without touching GUI code.
        const config = {
            defaultResolution: 150,
            maxResolution: 200,
            defaultImagePath: '../image/logo-menu-pc.svg',
            defaultBgColor: '#111111'
        };

        // --- Configuration / GUI Parameters ---
        const params = {
            uploadImage: () => document.getElementById('fileInput').click(),
            resolution: config.defaultResolution, // Maximum grid size (default from config)
            shape: 'Cube',
            shapeScale: 0.75, // Pixel shape size
            rotationSpeed: 0.5,
            bgColor: '#111111',
            // Lighting parameters
            ambientIntensity: 0.8,
            ambientColor: '#ffffff',
            dirIntensity: 0.75,
            dirColor: '#ffffff',
            backIntensity: 0.3,
            backColor: '#545454'
            ,
            // Wave / ripple parameters
            waveEnabled: true,
            waveAmplitude: 4.5,
            waveFrequency: 0.115,
            waveSpeed: 1.6
            ,
            
            // Zoom controls (center expressed as fraction of grid size, -0.5..0.5)
                zoomEnabled: true,
                zoomFactor: 1.5,
            zoomCenterX: 0.0,
            zoomCenterY: 0.0,
            // Image upscaling options
            upscaleEnabled: false,
            upscaleFactor: 2,
            imageSmoothing: false
            ,
            // Bloom / postprocessing
            bloomStrength: 0.9,
            bloomRadius: 0.4,
            bloomThreshold: 0.05
        };

        // --- Geometries Dictionary ---
        // Setup predefined geometries
        const geometries = {};
        
        // 1. Cube
        geometries['Cube'] = new THREE.BoxGeometry(1, 1, 1);
        
        // 2. Pyramid
        const pyramidGeo = new THREE.CylinderGeometry(0, 0.7, 1, 4);
        pyramidGeo.rotateY(Math.PI / 4); // Align faces
        geometries['Pyramid'] = pyramidGeo;
        
        // 3. Vertical 3D Hexagon
        geometries['Hexagon'] = new THREE.CylinderGeometry(0.6, 0.6, 1, 6);
        
        // 4. Octahedron
        geometries['Octahedron'] = new THREE.OctahedronGeometry(0.7);
        
        // 5. Ring
        geometries['Ring'] = new THREE.TorusGeometry(0.5, 0.2, 16, 32);
        
        // 6. Diamond (stretched octahedron)
        const diamondGeo = new THREE.OctahedronGeometry(0.5);
        diamondGeo.scale(1, 2, 1); // Make it taller on the Y axis
        geometries['Diamond'] = diamondGeo;

        // Shared material
        const material = new THREE.MeshStandardMaterial({
            roughness: 0.3,
            metalness: 0.2
        });

        // --- Initialization ---
        init();
        // Load the SVG logo with a white background as the default image.
        // Keeps createDefaultImage() as an alternative fallback.
        loadDefaultSVG(config.defaultImagePath);
        setupGUI();
        setupDragAndDrop();
        animate();

        function init() {
            const container = document.getElementById('canvas-container');

            // Scene setup
            scene = new THREE.Scene();
            // Root group so we can rotate the whole scene as a fallback for forced landscape
            sceneRoot = new THREE.Group();
            scene.add(sceneRoot);
            scene.background = new THREE.Color(params.bgColor);

            // Camera setup
            camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
            camera.position.set(0, 0, 75); // Moved back slightly from 60

            // Renderer setup
            renderer = new THREE.WebGLRenderer({ antialias: true });
            renderer.setSize(window.innerWidth, window.innerHeight);
            renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
            container.appendChild(renderer.domElement);

            // Postprocessing composer + bloom
            try {
                renderPass = new RenderPass(scene, camera);
                bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), params.bloomStrength, params.bloomRadius, params.bloomThreshold);
                composer = new EffectComposer(renderer);
                composer.addPass(renderPass);
                composer.addPass(bloomPass);
            } catch (e) {
                console.warn('Postprocessing not available:', e);
                composer = null;
            }

            // Camera controls (orbital)
            controls = new OrbitControls(camera, renderer.domElement);
            controls.enableDamping = true;
            controls.dampingFactor = 0.05;

            // Lighting
            ambientLight = new THREE.AmbientLight(params.ambientColor, params.ambientIntensity);
            sceneRoot.add(ambientLight);

            dirLight = new THREE.DirectionalLight(params.dirColor, params.dirIntensity);
            dirLight.position.set(20, 20, 30);
            sceneRoot.add(dirLight);

            backLight = new THREE.DirectionalLight(params.backColor, params.backIntensity);
            backLight.position.set(-20, -20, -30);
            sceneRoot.add(backLight);

            // Window resize handler
            window.addEventListener('resize', onWindowResize);
            // Orientation change for mobile devices
            window.addEventListener('orientationchange', checkRotateOverlay);
            
            // File selection handler
            document.getElementById('fileInput').addEventListener('change', handleFileUpload);

            // Initial check for rotate overlay on load
            checkRotateOverlay();
        }

        // Apply zoom: set controls.target to requested center and move camera closer by zoomFactor
        function applyZoom() {
            if (!camera || !controls) return;

            // Compute target in world coords based on center percent and current grid size
            const cellSize = 1.0; // layout scale removed; world cell size is 1
            const targetX = params.zoomCenterX * gridW * cellSize;
            const targetY = params.zoomCenterY * gridH * cellSize;

            // Set target
            controls.target.set(targetX, targetY, 0);

            // Direction from target to current camera
            const dir = new THREE.Vector3().subVectors(camera.position, controls.target).normalize();

            // Compute new camera distance
            const distance = baseCameraDistance / Math.max(0.0001, params.zoomFactor);

            const newPos = new THREE.Vector3().copy(controls.target).addScaledVector(dir, distance);
            camera.position.copy(newPos);
            controls.update();
        }

        function resetZoom() {
            // reset zoom params
            params.zoomFactor = 1.0;
            params.zoomCenterX = 0.0;
            params.zoomCenterY = 0.0;
            // reset camera to base position (rebuildGrid will recalc baseCameraDistance and set camera)
            rebuildGrid();
        }

        function setupGUI() {
            const gui = new GUI({ title: 'Effect Settings' });

            if (!devMode) {
                // Minimal user UI: only Upload, Shape, Wave, Zoom
                const fileFolder = gui.addFolder('Image Loading');
                fileFolder.add(params, 'uploadImage').name('Upload Local Image');

                const shapeFolder = gui.addFolder('Shape Properties');
                shapeFolder.add(params, 'shape', ['Cube', 'Pyramid', 'Hexagon', 'Octahedron', 'Ring', 'Diamond'])
                           .name('Shape Type').onChange(rebuildGrid);
                shapeFolder.add(params, 'shapeScale', 0.1, 2.0, 0.05).name('Shape Size');
                shapeFolder.add(params, 'rotationSpeed', 0.0, 2.0, 0.1).name('Rotation Speed');

                addWaveControls(gui, params);
                addZoomControls(gui, params, { apply: applyZoom, reset: resetZoom });
                // Postprocessing controls (minimal)
                const postFolder = gui.addFolder('Post Processing');
                postFolder.add(params, 'bloomStrength', 0, 3, 0.01).name('Bloom Strength').onChange(v => { if (bloomPass) bloomPass.strength = v; });
                postFolder.add(params, 'bloomRadius', 0, 1, 0.01).name('Bloom Radius').onChange(v => { if (bloomPass) bloomPass.radius = v; });
                postFolder.add(params, 'bloomThreshold', 0, 1, 0.01).name('Bloom Threshold').onChange(v => { if (bloomPass) bloomPass.threshold = v; });
            } else {
                // Developer/full UI: all folders and controls
                const fileFolder = gui.addFolder('Image Loading');
                fileFolder.add(params, 'uploadImage').name('Upload Local Image');
                fileFolder.add(params, 'resolution', 10, config.maxResolution, 1).name('Grid Resolution').onChange(rebuildGrid);
                fileFolder.add(params, 'upscaleEnabled').name('Upscale Small Image').onChange(rebuildGrid);
                fileFolder.add(params, 'upscaleFactor', 1, 8, 1).name('Upscale Factor').onChange(rebuildGrid);
                fileFolder.add(params, 'imageSmoothing').name('Smooth Upscale').onChange(rebuildGrid);

                const shapeFolder = gui.addFolder('Shape Properties');
                shapeFolder.add(params, 'shape', ['Cube', 'Pyramid', 'Hexagon', 'Octahedron', 'Ring', 'Diamond'])
                           .name('Shape Type').onChange(rebuildGrid);
                shapeFolder.add(params, 'shapeScale', 0.1, 2.0, 0.05).name('Shape Size');
                shapeFolder.add(params, 'rotationSpeed', 0.0, 2.0, 0.1).name('Rotation Speed');

                const colorFolder = gui.addFolder('Colors');
                colorFolder.addColor(params, 'bgColor').name('Background').onChange(v => scene.background.set(v));

                const lightFolder = gui.addFolder('Lighting');
                lightFolder.add(params, 'ambientIntensity', 0, 3, 0.1).name('Ambient Intensity').onChange(v => ambientLight.intensity = v);
                lightFolder.addColor(params, 'ambientColor').name('Ambient Color').onChange(v => ambientLight.color.set(v));
                lightFolder.add(params, 'dirIntensity', 0, 1, 0.01).name('Main Light Intensity').onChange(v => dirLight.intensity = v);
                lightFolder.addColor(params, 'dirColor').name('Main Light Color').onChange(v => dirLight.color.set(v));
                lightFolder.add(params, 'backIntensity', 0, 1, 0.01).name('Back Light Intensity').onChange(v => backLight.intensity = v);
                lightFolder.addColor(params, 'backColor').name('Back Light Color').onChange(v => backLight.color.set(v));

                addWaveControls(gui, params);
                addZoomControls(gui, params, { apply: applyZoom, reset: resetZoom });
                // Postprocessing controls (developer)
                const postFolder = gui.addFolder('Post Processing');
                postFolder.add(params, 'bloomStrength', 0, 3, 0.01).name('Bloom Strength').onChange(v => { if (bloomPass) bloomPass.strength = v; });
                postFolder.add(params, 'bloomRadius', 0, 1, 0.01).name('Bloom Radius').onChange(v => { if (bloomPass) bloomPass.radius = v; });
                postFolder.add(params, 'bloomThreshold', 0, 1, 0.01).name('Bloom Threshold').onChange(v => { if (bloomPass) bloomPass.threshold = v; });
            }
        }

        // --- Core Logic: Image and Grid Processing ---
        function rebuildGrid() {
            if (!currentImage) return;

            // 1. Calculate grid dimensions preserving proportions
            // Determine target raster resolution (gridW x gridH)
            // Start from user-chosen base resolution
            let maxRes = params.resolution;

            // If upscale enabled, consider the uploaded image's natural size multiplied by factor
            if (params.upscaleEnabled && currentImage) {
                const naturalMax = Math.max(currentImage.width, currentImage.height) * params.upscaleFactor;
                maxRes = Math.max(maxRes, Math.floor(naturalMax));
            }

            const aspect = currentImage.width / currentImage.height;

            if (currentImage.width > currentImage.height) {
                gridW = maxRes;
                gridH = Math.floor(maxRes / aspect);
            } else {
                gridH = maxRes;
                gridW = Math.floor(maxRes * aspect);
            }

            // 2. Draw image on hidden canvas to extract pixels
            const canvas = document.createElement('canvas');
            canvas.width = gridW;
            canvas.height = gridH;
            const ctx = canvas.getContext('2d');
            // Control smoothing when scaling small images up. For pixel-art look, disable smoothing.
            ctx.imageSmoothingEnabled = !!params.imageSmoothing;
            ctx.drawImage(currentImage, 0, 0, gridW, gridH);
            imgData = ctx.getImageData(0, 0, gridW, gridH).data;

            // 3. Clear existing InstancedMesh (remove from sceneRoot if present)
            if (instancedMesh) {
                if (typeof sceneRoot !== 'undefined' && sceneRoot && sceneRoot.children.includes(instancedMesh)) {
                    sceneRoot.remove(instancedMesh);
                } else if (scene && scene.children.includes(instancedMesh)) {
                    scene.remove(instancedMesh);
                }
                try { instancedMesh.dispose(); } catch (e) { /* ignore if not supported */ }
            }

            // 4. Create new InstancedMesh
            const instanceCount = gridW * gridH;
            const geo = geometries[params.shape];
            instancedMesh = new THREE.InstancedMesh(geo, material, instanceCount);
            
            // 5. Calculate offset to center the grid
            // cellSize uses default world unit (1) — layout/scale removed
            const cellSize = 1.0;
            const offsetX = (gridW * cellSize) / 2 - (cellSize / 2);
            const offsetY = (gridH * cellSize) / 2 - (cellSize / 2);

            positions = [];
            let idx = 0;

            for (let y = 0; y < gridH; y++) {
                for (let x = 0; x < gridW; x++) {
                    // Position mapping: WebGL Y is up, Canvas Y is down
                    const posX = x * cellSize - offsetX;
                    const posY = -(y * cellSize - offsetY);
                    
                    positions.push(new THREE.Vector3(posX, posY, 0));
                    
                    // Initial transformations (rotation and scale are updated in the animation loop)
                    dummy.position.set(posX, posY, 0);
                    dummy.updateMatrix();
                    instancedMesh.setMatrixAt(idx, dummy.matrix);
                    
                    idx++;
                }
            }

            sceneRoot.add(instancedMesh);
            
            // 6. Apply colors and setup camera
            updateColors();
            
            const maxDim = Math.max(gridW, gridH);
            // Position camera based on world size (respecting gridScale)
            // Set camera offset so the initial view is tilted/angled similar to the screenshot
            const baseZ = maxDim * 1.15; // Camera distance scales with grid world size (cellSize = 1)
            baseCameraDistance = baseZ;
            const camOffsetX = -maxDim * 0.35; // move left
            const camOffsetY = maxDim * 0.12; // move slightly up
            camera.position.set(camOffsetX, camOffsetY, baseZ);
            // Ensure controls target is centered and update controls
            if (controls) {
                controls.target.set(0, 0, 0);
                controls.update();
            }
            // If zoom is enabled by default, apply initial zoom so view opens zoomed-in
            if (params.zoomEnabled) {
                applyZoom();
            }
        }

        // --- Update Colors ---
        function updateColors() {
            if (!instancedMesh || !imgData) return;
            
            let idx = 0;
            const tempColor = new THREE.Color();

            for (let y = 0; y < gridH; y++) {
                for (let x = 0; x < gridW; x++) {
                    // Extract pixel colors from image data
                    const pixelIndex = (y * gridW + x) * 4;
                    const r = imgData[pixelIndex] / 255;
                    const g = imgData[pixelIndex + 1] / 255;
                    const b = imgData[pixelIndex + 2] / 255;
                    
                    // Set color and convert from sRGB to Linear 
                    // for correct rendering in Three.js 0.160+
                    tempColor.setRGB(r, g, b);
                    tempColor.convertSRGBToLinear();
                    
                    instancedMesh.setColorAt(idx, tempColor);
                    idx++;
                }
            }
            // Notify Three.js about color changes
            instancedMesh.instanceColor.needsUpdate = true;
        }

        // --- Animation Loop ---
        function animate() {
            requestAnimationFrame(animate);

            const time = clock.getElapsedTime();

            // Update rotation for all instances
            if (instancedMesh && positions.length > 0) {
                for (let i = 0; i < positions.length; i++) {
                    dummy.position.copy(positions[i]);
                    
                    // Rotate shapes based on time
                    // Add a slight offset by index 'i' to make rotation look organic
                    dummy.rotation.x = time * params.rotationSpeed + i * 0.001;
                    dummy.rotation.y = time * params.rotationSpeed + i * 0.002;
                    dummy.rotation.z = time * (params.rotationSpeed * 0.5);
                    
                    // Apply dynamic scale
                    dummy.scale.setScalar(params.shapeScale);

                    // Wave / ripple displacement (Z axis)
                    // distance from center
                    const dx = positions[i].x;
                    const dy = positions[i].y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    let z = 0;
                    if (params.waveEnabled) {
                        z = params.waveAmplitude * Math.sin(dist * params.waveFrequency - time * params.waveSpeed);
                    }
                    dummy.position.z = z;
                    
                    dummy.updateMatrix();
                    instancedMesh.setMatrixAt(i, dummy.matrix);
                }
                // Notify Three.js about transformation matrix changes
                instancedMesh.instanceMatrix.needsUpdate = true;
            }

            controls.update();
            if (composer) composer.render(); else renderer.render(scene, camera);
        }

        // --- Event Handlers and Utilities ---
        function onWindowResize() {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
            if (composer) composer.setSize(window.innerWidth, window.innerHeight);
            // Check whether to show rotate overlay on small screens
            checkRotateOverlay();
        }

        function handleImageSource(src) {
            const img = new Image();
            img.crossOrigin = "Anonymous"; // Required to read pixel data from external URLs (CORS)
            img.onload = () => {
                currentImage = img;
                rebuildGrid();
            };
            img.onerror = () => {
                console.error("Failed to load image. CORS policy might be blocking it.");
            };
            img.src = src;
        }

        function handleFileUpload(e) {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (event) => handleImageSource(event.target.result);
                reader.readAsDataURL(file);
            }
        }

        function setupDragAndDrop() {
            const overlay = document.getElementById('dragOverlay');
            
            window.addEventListener('dragover', (e) => {
                e.preventDefault();
                overlay.classList.add('active');
            });
            
            window.addEventListener('dragleave', (e) => {
                e.preventDefault();
                if(e.relatedTarget === null) overlay.classList.remove('active');
            });
            
            window.addEventListener('drop', (e) => {
                e.preventDefault();
                overlay.classList.remove('active');
                
                if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                    const file = e.dataTransfer.files[0];
                    if (file.type.startsWith('image/')) {
                        const reader = new FileReader();
                        reader.onload = (event) => handleImageSource(event.target.result);
                        reader.readAsDataURL(file);
                    }
                }
            });
        }

        // Load an SVG file and rasterize it onto a white canvas, then use it as the image source.
        // This ensures the SVG background is white for correct pixel extraction.
        function loadDefaultSVG(path) {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                // Create a canvas matching the SVG rasterized size
                const canvas = document.createElement('canvas');
                canvas.width = img.naturalWidth || 512;
                canvas.height = img.naturalHeight || 512;
                const ctx = canvas.getContext('2d');

                // Fill white background
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                // Draw SVG on top
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

                // Use the rasterized image as the source for the grid
                handleImageSource(canvas.toDataURL());
            };
            img.onerror = (err) => {
                console.error('Failed to load default SVG, falling back to generated image.', err);
                createDefaultImage();
            };
            img.src = path;
        }

        // Generate default color pattern on load
        function createDefaultImage() {
            const canvas = document.createElement('canvas');
            canvas.width = 512;
            canvas.height = 512;
            const ctx = canvas.getContext('2d');
            
            // Background gradient
            const gradient = ctx.createLinearGradient(0, 0, 512, 512);
            gradient.addColorStop(0, '#ff2a5f');
            gradient.addColorStop(0.5, '#00d0ff');
            gradient.addColorStop(1, '#ffc800');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, 512, 512);

            // Central circle
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(256, 256, 120, 0, Math.PI * 2);
            ctx.fill();

            // Text
            ctx.fillStyle = '#111111';
            ctx.font = 'bold 40px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('THREE.JS', 256, 240);
            ctx.fillText('PIXELS', 256, 290);

            handleImageSource(canvas.toDataURL());
        }

        // Show a rotate-to-landscape overlay for narrow portrait screens
        function checkRotateOverlay() {
            const overlay = document.getElementById('rotateOverlay');
            if (!overlay) return;

            // Prefer visualViewport when available (handles mobile browser UI more accurately)
            const vw = window.visualViewport || { width: window.innerWidth, height: window.innerHeight };
            const isSmall = Math.min(vw.width, vw.height) <= 720;
            const isPortrait = vw.height > vw.width;

            const guiEl = document.querySelector('.lil-gui');
            const container = document.getElementById('canvas-container');

            if (isSmall && isPortrait) {
                overlay.classList.add('is-visible');
                overlay.setAttribute('aria-hidden', 'false');
                // hide floating lil-gui for mobile portrait
                if (guiEl) guiEl.classList.add('mobile-ui');

                // Compute a fit-to-screen zoom so the entire grid is visible vertically
                if (typeof gridH === 'number' && gridH > 0 && camera) {
                    const cellSize = 1.0;
                    // desired world height to fit (add small margin)
                    const desiredHeight = gridH * cellSize * 1.05;
                    const fovRad = (camera.fov * Math.PI) / 180;
                    const desiredDistance = (desiredHeight / 2) / Math.tan(fovRad / 2);
                    // compute zoomFactor that will place camera at desiredDistance
                    if (baseCameraDistance > 0 && isFinite(desiredDistance) && desiredDistance > 0) {
                        const newZoomFactor = baseCameraDistance / desiredDistance;
                        // avoid extreme values
                        params.zoomFactor = Math.max(0.2, Math.min(newZoomFactor, 4.0));
                        // apply immediately
                        applyZoom();
                    }
                }

                // allow controls so user can interact immediately
                if (controls) controls.enabled = true;
            } else {
                overlay.classList.remove('is-visible');
                overlay.setAttribute('aria-hidden', 'true');
                if (guiEl) guiEl.classList.remove('mobile-ui');

                // restore default zoom (rebuildGrid will reapply base camera if needed)
                if (params.zoomEnabled) applyZoom();
            }
        }

        async function tryLockOrientation() {
            const win = window;
            const sc = win.screen || win.screenorientation || null;
            const orientation = win.screen && win.screen.orientation ? win.screen.orientation : null;
            if (orientation && typeof orientation.lock === 'function') {
                try {
                    await orientation.lock('landscape-primary');
                    return true;
                } catch (e) {
                    console.warn('Orientation lock rejected:', e);
                    return false;
                }
            }
            // older prefixed APIs not widely supported; return false
            return false;
        }

        function createRotateUnlockButton() {
            if (document.getElementById('rotateUnlockBtn')) return;
            const btn = document.createElement('button');
            btn.id = 'rotateUnlockBtn';
            btn.className = 'rotate-unlock-btn';
            btn.type = 'button';
            btn.textContent = 'เปิดการโต้ตอบ';
            btn.addEventListener('click', async () => {
                // Try to request native orientation lock (requires user gesture and secure context)
                const locked = await tryLockOrientation();
                if (locked) {
                    const overlay = document.getElementById('rotateOverlay');
                    if (overlay) {
                        overlay.classList.remove('is-visible');
                        overlay.setAttribute('aria-hidden', 'true');
                    }
                    removeRotateUnlockButton();
                    return;
                }

                // If native lock failed, just hide the overlay and keep the scene rotated visually
                const overlay = document.getElementById('rotateOverlay');
                if (overlay) {
                    overlay.classList.remove('is-visible');
                    overlay.setAttribute('aria-hidden', 'true');
                }
                if (controls) controls.enabled = true;
                removeRotateUnlockButton();
            });
            document.body.appendChild(btn);
        }

        function removeRotateUnlockButton() {
            const existing = document.getElementById('rotateUnlockBtn');
            if (existing) existing.remove();
        }

        // fitGridToScreen removed — layout/scale GUI is no longer used
