import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';

import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { GammaCorrectionShader } from 'three/examples/jsm/shaders/GammaCorrectionShader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { ACESFilmicToneMappingShader } from 'three/examples/jsm/Addons.js';
import * as dat from 'lil-gui';
import { Stats } from "./stats.js";

import { AssetManager } from './AssetManager.js';
import { EffectShader } from "./EffectShader.js";
import {     
    MeshBVH,
    MeshBVHHelper,
    MeshBVHUniformStruct,
    FloatVertexAttributeTexture,
    shaderStructs,
    shaderIntersectFunction,
    SAH
} from 'three-mesh-bvh';

// Base
const gui = new dat.GUI();
const canvas = document.querySelector('canvas.webgl');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x222222);

const stats = new Stats();
stats.showPanel(0);
document.body.appendChild(stats.dom);

// Loaders
const rgbeLoader = new RGBELoader();
rgbeLoader.load("/env-metal-1.hdr", (texture) => {
  texture.mapping = THREE.EquirectangularReflectionMapping;
  scene.environment = texture;

  scene.environmentIntensity = 6.3;
//   scene.background = texture
});



// Sizes
const sizes = {
    width: window.innerWidth,
    height: window.innerHeight
};
window.addEventListener('resize', () => {
    sizes.width = window.innerWidth;
    sizes.height = window.innerHeight;
    camera.aspect = sizes.width / sizes.height;
    camera.updateProjectionMatrix();
    renderer.setSize(sizes.width, sizes.height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    effectComposer.setSize(sizes.width, sizes.height);
    effectComposer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
});

// Camera
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(50, 75, 20);
scene.add(camera);

// Controls
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;

// Renderer
const renderer = new THREE.WebGLRenderer({
    canvas: canvas,
    antialias: true
});
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.physicallyCorrectLights = true;
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ReinhardToneMapping;
renderer.toneMappingExposure = 1.5;
renderer.setSize(sizes.width, sizes.height);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

   // Skybox
const environment = await new THREE.CubeTextureLoader().loadAsync([
    "skybox/Box_Right.bmp",
    "skybox/Box_Left.bmp",
    "skybox/Box_Top.bmp",
    "skybox/Box_Bottom.bmp",
    "skybox/Box_Front.bmp",
    "skybox/Box_Back.bmp"
]);

environment.encoding = THREE.sRGBEncoding;
const clientWidth = window.innerWidth * 0.99;
const clientHeight = window.innerHeight * 0.98;


// Models
let diamondGeo = (await AssetManager.loadGLTFAsync("diamond.glb")).scene.children[0].children[0].children[0].children[0].children[0].geometry;
diamondGeo.scale(40, 40, 40);
diamondGeo.translate(0, 5, 0);
const cubeRenderTarget = new THREE.WebGLCubeRenderTarget(256, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
const cubeCamera = new THREE.CubeCamera(1, 100000, cubeRenderTarget);
scene.add(cubeCamera);
cubeCamera.position.set(0, 5, 0);
cubeCamera.update(renderer, scene);
//scene.background = cubeRenderTarget.texture;
const effectController = {
    bounces: 3.0,
    ior: 2.4,
    correctMips: true,
    chromaticAberration: true,
    aberrationStrength: 0.01
};
const makeDiamond = (geo, {
        color = new THREE.Color(1, 1, 1),
        ior = 2.4
    } = {}) => {
        const mergedGeometry = geo;
        mergedGeometry.boundsTree = new MeshBVH(mergedGeometry.toNonIndexed(), { lazyGeneration: false, strategy: SAH });
        const collider = new THREE.Mesh(mergedGeometry);
        collider.material.wireframe = true;
        collider.material.opacity = 0.5;
        collider.material.transparent = true;
        collider.visible = false;
        collider.boundsTree = mergedGeometry.boundsTree;
        scene.add(collider);
        const visualizer = new MeshBVHHelper(collider, 20);
        visualizer.visible = false;
        visualizer.update();
        scene.add(visualizer);
        
          
        const diamond = new THREE.Mesh(geo, new THREE.ShaderMaterial({
            uniforms: {
                envMap: { value: environment },
                bvh: { value: new MeshBVHUniformStruct() },
                bounces: { value: 3 },
                color: { value: color },
                ior: { value: ior },
                correctMips: { value: true },
                projectionMatrixInv: { value: camera.projectionMatrixInverse },
                viewMatrixInv: { value: camera.matrixWorld },
                chromaticAberration: { value: true },
                aberrationStrength: { value: 0.01 },
                resolution: { value: new THREE.Vector2(clientWidth, clientHeight) }
            },
            vertexShader: /*glsl*/ `
        varying vec3 vWorldPosition;
        varying vec3 vNormal;
        uniform mat4 viewMatrixInv;
        void main() {
            vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
            vNormal = (viewMatrixInv * vec4(normalMatrix * normal, 0.0)).xyz;
            gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
        }
        `,
            fragmentShader: /*glsl*/ `
        precision highp isampler2D;
        precision highp usampler2D;
        varying vec3 vWorldPosition;
        varying vec3 vNormal;
        uniform samplerCube envMap;
        uniform float bounces;
        ${ shaderStructs }
        ${ shaderIntersectFunction }
        uniform BVH bvh;
        uniform float ior;
        uniform vec3 color;
        uniform bool correctMips;
        uniform bool chromaticAberration;
        uniform mat4 projectionMatrixInv;
        uniform mat4 viewMatrixInv;
        uniform mat4 modelMatrix;
        uniform vec2 resolution;
        uniform bool chromaticAbberation;
        uniform float aberrationStrength;
        vec3 totalInternalReflection(vec3 ro, vec3 rd, vec3 normal, float ior, mat4 modelMatrixInverse) {
            vec3 rayOrigin = ro;
            vec3 rayDirection = rd;
            rayDirection = refract(rayDirection, normal, 1.0 / ior);
            rayOrigin = vWorldPosition + rayDirection * 0.001;
            rayOrigin = (modelMatrixInverse * vec4(rayOrigin, 1.0)).xyz;
            rayDirection = normalize((modelMatrixInverse * vec4(rayDirection, 0.0)).xyz);
            for(float i = 0.0; i < bounces; i++) {
                uvec4 faceIndices = uvec4( 0u );
                vec3 faceNormal = vec3( 0.0, 0.0, 1.0 );
                vec3 barycoord = vec3( 0.0 );
                float side = 1.0;
                float dist = 0.0;
                bvhIntersectFirstHit( bvh, rayOrigin, rayDirection, faceIndices, faceNormal, barycoord, side, dist );
                vec3 hitPos = rayOrigin + rayDirection * max(dist - 0.001, 0.0);
               // faceNormal *= side;
                vec3 tempDir = refract(rayDirection, faceNormal, ior);
                if (length(tempDir) != 0.0) {
                    rayDirection = tempDir;
                    break;
                }
                rayDirection = reflect(rayDirection, faceNormal);
                rayOrigin = hitPos + rayDirection * 0.01;
            }
            rayDirection = normalize((modelMatrix * vec4(rayDirection, 0.0)).xyz);
            return rayDirection;
        }
        void main() {
            mat4 modelMatrixInverse = inverse(modelMatrix);
            vec2 uv = gl_FragCoord.xy / resolution;
            vec3 directionCamPerfect = (projectionMatrixInv * vec4(uv * 2.0 - 1.0, 0.0, 1.0)).xyz;
            directionCamPerfect = (viewMatrixInv * vec4(directionCamPerfect, 0.0)).xyz;
            directionCamPerfect = normalize(directionCamPerfect);
            vec3 normal = vNormal;
            vec3 rayOrigin = cameraPosition;
            vec3 rayDirection = normalize(vWorldPosition - cameraPosition);
            vec3 finalColor;
            if (chromaticAberration) {
            vec3 rayDirectionR = totalInternalReflection(rayOrigin, rayDirection, normal, max(ior * (1.0 - aberrationStrength), 1.0), modelMatrixInverse);
            vec3 rayDirectionG = totalInternalReflection(rayOrigin, rayDirection, normal, max(ior, 1.0), modelMatrixInverse);
            vec3 rayDirectionB = totalInternalReflection(rayOrigin, rayDirection, normal, max(ior * (1.0 + aberrationStrength), 1.0), modelMatrixInverse);
            float finalColorR = textureGrad(envMap, rayDirectionR, dFdx(correctMips ? directionCamPerfect: rayDirection), dFdy(correctMips ? directionCamPerfect: rayDirection)).r;
            float finalColorG = textureGrad(envMap, rayDirectionG, dFdx(correctMips ? directionCamPerfect: rayDirection), dFdy(correctMips ? directionCamPerfect: rayDirection)).g;
            float finalColorB = textureGrad(envMap, rayDirectionB, dFdx(correctMips ? directionCamPerfect: rayDirection), dFdy(correctMips ? directionCamPerfect: rayDirection)).b;
            finalColor = vec3(finalColorR, finalColorG, finalColorB) * color;
            } else {
                rayDirection = totalInternalReflection(rayOrigin, rayDirection, normal, max(ior, 1.0), modelMatrixInverse);
                finalColor = textureGrad(envMap, rayDirection, dFdx(correctMips ? directionCamPerfect: rayDirection), dFdy(correctMips ? directionCamPerfect: rayDirection)).rgb;
                finalColor *= color;
            }
            gl_FragColor = vec4(vec3(finalColor), 1.0);
        }
        `
        }));
        diamond.material.uniforms.bvh.value.updateFrom(collider.boundsTree);
        diamond.castShadow = true;
        diamond.receiveShadow = true;
        return diamond;
    }
 
const diamond = makeDiamond(diamondGeo);
scene.add(diamond);

// Render Targets
const defaultTexture = new THREE.WebGLRenderTarget(clientWidth, clientHeight, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.NearestFilter
});
defaultTexture.depthTexture = new THREE.DepthTexture(clientWidth, clientHeight, THREE.FloatType);

    

// Post processing
const renderTarget = new THREE.WebGLRenderTarget(800, 600, { samples: 2 });
const effectComposer = new EffectComposer(renderer, renderTarget);
effectComposer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
effectComposer.setSize(sizes.width, sizes.height);

// Render pass
const renderPass = new RenderPass(scene, camera);
effectComposer.addPass(renderPass);


const effectPass = new ShaderPass(EffectShader);
effectComposer.addPass(effectPass);

// ACESFILMIC  pass
const ACESFilmShiftPass = new ShaderPass(ACESFilmicToneMappingShader);
ACESFilmShiftPass.enabled = true;
effectComposer.addPass(ACESFilmShiftPass);

// Gamma correction pass
const gammaCorrectionPass = new ShaderPass(GammaCorrectionShader);
effectComposer.addPass(gammaCorrectionPass);

// Antialias pass
if(renderer.getPixelRatio() === 1 && !renderer.capabilities.isWebGL2) {
    const smaaPass = new SMAAPass();
    effectComposer.addPass(smaaPass);
}

//GUI
gui.add(effectController, "bounces", 1.0, 10.0, 1.0).name("Bounces");
gui.add(effectController, "ior", 1.0, 5.0, 0.01).name("IOR");
gui.add(effectController, "correctMips");
gui.add(effectController, "chromaticAberration");
gui.add(effectController, "aberrationStrength", 0.00, 1.0, 0.0001).name("Aberration Strength");


// Animate
const clock = new THREE.Clock();
const tick = () => {
    diamond.material.uniforms.bounces.value = effectController.bounces;
    diamond.material.uniforms.ior.value = effectController.ior;
    diamond.material.uniforms.correctMips.value = effectController.correctMips;
    diamond.material.uniforms.chromaticAberration.value = effectController.chromaticAberration;
    diamond.material.uniforms.aberrationStrength.value = effectController.aberrationStrength;
    diamond.rotation.y += 0.01;
    diamond.updateMatrix();
    diamond.updateMatrixWorld();
    renderer.setRenderTarget(defaultTexture);
    renderer.clear();
    renderer.render(scene, camera);
    effectPass.uniforms["sceneDiffuse"].value = defaultTexture.texture;
 
    const elapsedTime = clock.getElapsedTime();
    stats.update();
    controls.update();
    effectComposer.render();
    window.requestAnimationFrame(tick);
};

tick();

// Function to update all materials
const updateAllMaterials = () => {
    scene.traverse((child) => {
        if(child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
            child.material.envMapIntensity = 8.5;
            child.material.needsUpdate = true;
            child.castShadow = true;
            child.receiveShadow = true;
        }
    });
};
