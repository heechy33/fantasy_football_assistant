import { useEffect, useRef } from 'react';
// Type-only imports: every runtime three import stays dynamic below so three never enters the
// initial bundle or the vitest graph.
import type { Material } from 'three';
import type * as THREE from 'three';

/**
 * Persistent cinematic WORLD behind the whole landing page (fixed full-viewport layer): the
 * page scrolls the camera through one continuous dark trophy room shared by every section:
 *
 *   hero       the Lombardi center-stage on its plinth under hard studio light banks
 *   chapter I  a high wide pull-back that drifts the trophy to the right of the frame while
 *              the editorial facts own the left
 *   chapter II a low close angle from stage left — the chrome looms behind the frosted
 *              provider panels
 *   finale     a slow settle back to center stage for the sign-off
 *
 * Trophy realism: a licensed `.glb` model is loaded from `public/models/` when present,
 * normalized into the scene and given the full PBR treatment. Until it lands — or forever, if
 * it never does — a procedural Lombardi-style fallback renders instead, so nothing breaks.
 * Both paths share: a procedural stadium-light environment map (bright emissive "light bank"
 * planes baked through PMREMGenerator — the long specular streaks that make curved metal read
 * as photographed metal, with no HDR download honoring the $0/static-hosting target), ACES
 * filmic tone mapping, UnrealBloom hot-highlight rolloff, a soft contact shadow, and a faded
 * mirror reflection grounding the object on the floor.
 *
 * Degradations, in order:
 * - `prefers-reduced-motion`: a static lit hero frame — no animation, no camera travel.
 * - No WebGL context (headless browsers, jsdom, blocked GPU): the canvas stays transparent and
 *   the CSS glow/vignette/grain layers carry the scene, so the page never looks broken.
 * - Tab hidden: the render loop pauses via the visibility guard inside the frame callback.
 */

/** Where the optional bundled trophy model lives (`frontend/public/models/`). */
const TROPHY_MODEL_URL = '/models/trophy.glb';

/** World floor height — everything stands on this plane (trophy and its plinth slab). */
const FLOOR_Y = -1.79;

/**
 * Camera waypoints keyed by whole-page scroll progress (0 = hero, 1 = footer). One continuous
 * shot through one continuous world. Plain number arrays so the table hoists at module scope
 * without pulling three into it.
 */
const CAMERA_KEYS = [
  { p: 0.0, pos: [0, 0.72, 6.9], look: [0, 0.18, 0] },
  { p: 0.32, pos: [0, 2.4, 9.4], look: [-1.7, -0.05, 0] },
  { p: 0.68, pos: [-2.6, -0.5, 4.9], look: [0.5, 0.5, 0] },
  { p: 1.0, pos: [0, 0.55, 6.6], look: [0, 0.12, 0] },
] as const;

export function LandingHeroCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    let cleanup: (() => void) | undefined;

    void Promise.all([
      import('three'),
      import('three/examples/jsm/loaders/GLTFLoader.js'),
      import('three/examples/jsm/postprocessing/EffectComposer.js'),
      import('three/examples/jsm/postprocessing/RenderPass.js'),
      import('three/examples/jsm/postprocessing/UnrealBloomPass.js'),
      import('three/examples/jsm/postprocessing/OutputPass.js'),
    ]).then(([THREE, { GLTFLoader }, { EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }]) => {
      if (disposed) return;
      const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
      if (!gl) return; // No WebGL: leave the canvas empty; CSS atmosphere stands in.

      const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.8));
      // Filmic tone mapping + a characterful environment map are what turn flat metal into
      // believable polished silver — reflections carry the shape, not the base color.
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;

      const scene = new THREE.Scene();
      // Dense air: the fog is what keeps the plinth grounded in photographed depth instead of
      // floating in a void.
      scene.fog = new THREE.FogExp2(0x06070b, 0.016);
      const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 160);

      // ---- Procedural stadium-light environment (the realism backbone) --------------------
      // A dark room ringed with over-bright emissive "light bank" planes, PMREM-baked once.
      // Curved metal is ~90% reflection: hard rectangular banks give long specular streaks,
      // the black room keeps contrast, warm/cool split fakes floodlight color temperature.
      const envScene = new THREE.Scene();
      envScene.add(
        new THREE.Mesh(
          new THREE.SphereGeometry(24, 16, 16),
          new THREE.MeshBasicMaterial({ color: 0x0a0c12, side: THREE.BackSide }),
        ),
      );
      const addBank = (
        size: [number, number],
        pos: [number, number, number],
        rot: [number, number, number],
        color: number,
        boost: number,
      ) => {
        const bank = new THREE.Mesh(
          new THREE.PlaneGeometry(size[0], size[1]),
          new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(boost) }),
        );
        bank.position.set(...pos);
        bank.rotation.set(...rot);
        envScene.add(bank);
      };
      addBank([12, 2], [0, 10, 0], [Math.PI / 2, 0, 0], 0xffffff, 3.8); // overhead flood strip
      addBank([3, 9], [-9, 3, 2], [0, Math.PI / 2, 0], 0xbfd4ff, 2.2); // cool left bank
      addBank([3, 9], [9, 3, -1], [0, -Math.PI / 2, 0], 0xffd9a0, 1.8); // warm right bank
      addBank([14, 6], [0, 2, 10], [0, Math.PI, 0], 0xdfe8ff, 0.8); // soft frontal fill

      const pmrem = new THREE.PMREMGenerator(renderer);
      const environment = pmrem.fromScene(envScene, 0.04).texture;
      scene.environment = environment;
      pmrem.dispose();
      envScene.traverse((obj) => {
        const disposable = obj as unknown as { geometry?: { dispose(): void }; material?: Material };
        disposable.geometry?.dispose();
        disposable.material?.dispose();
      });
      const chrome = new THREE.MeshStandardMaterial({
        color: 0xe8edf2,
        metalness: 1,
        roughness: 0.07,
        envMapIntensity: 0.95,
      });
      chrome.userData.baseEnv = 0.95;
      const stitch = new THREE.MeshStandardMaterial({
        color: 0xdde5ee,
        metalness: 1,
        roughness: 0.16,
        envMapIntensity: 0.85,
      });
      stitch.userData.baseEnv = 0.85;
      // Every silver material, tracked so the scroll dimming also reaches GLB-upgraded ones.
      const silverMats: THREE.MeshStandardMaterial[] = [chrome, stitch];

      const disposeDeep = (root: THREE.Object3D) => {
        root.traverse((obj) => {
          if (obj instanceof THREE.Mesh || obj instanceof THREE.Points) {
            obj.geometry.dispose();
            const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
            mats.forEach((m) => m.dispose());
          }
        });
      };

      // ---- Trophy: bundled GLB model with a procedural fallback ---------------------------
      const buildFallbackTrophy = () => {
        // Lombardi silhouette as one lathe profile: pointed plinth, concave column narrowing
        // upward, then the collar that seats the ball.
        const stemProfile = [
          new THREE.Vector2(0.001, -1.78),
          new THREE.Vector2(0.6, -1.78),
          new THREE.Vector2(0.74, -1.66),
          new THREE.Vector2(0.5, -1.56),
          new THREE.Vector2(0.17, -1.0),
          new THREE.Vector2(0.13, -0.4),
          new THREE.Vector2(0.16, 0.05),
          new THREE.Vector2(0.28, 0.38),
          new THREE.Vector2(0.26, 0.52),
          new THREE.Vector2(0.001, 0.54),
        ];
        const g = new THREE.Group();
        g.add(new THREE.Mesh(new THREE.LatheGeometry(stemProfile, 96), chrome));

        // The ball: a prolate spheroid tilted like the real trophy's football, with laces raised
        // along the top seam.
        const football = new THREE.Group();
        football.position.y = 1.06;
        football.rotation.z = -0.16;
        const ball = new THREE.Mesh(new THREE.SphereGeometry(0.58, 64, 48), chrome);
        ball.scale.set(1.32, 0.88, 0.82);
        football.add(ball);
        for (let i = 0; i < 7; i++) {
          const u = (i / 6 - 0.5) * 1.24; // position along the long axis
          const apexY = Math.cos((u / 0.77) * 1.25) * 0.51; // upper-surface curve of the spheroid
          const knot = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.02, 0.2), stitch);
          knot.position.set(u, apexY + 0.02, 0);
          football.add(knot);
        }
        g.add(football);
        return g;
      };

      const trophy = buildFallbackTrophy();
      const holder = new THREE.Group(); // scroll choreography drives this node only
      trophy.traverse((obj) => {
        if (obj instanceof THREE.Mesh) obj.castShadow = true;
      });
      holder.add(trophy);
      scene.add(holder);

      // When a model is bundled at public/models/trophy.glb it swaps in: normalized into the
      // fallback's exact footprint with its authored materials gently unified toward house PBR
      // silver, so the environment-map streaks hold regardless of how the asset was authored.
      new GLTFLoader().load(
        TROPHY_MODEL_URL,
        (gltf) => {
          if (disposed) {
            disposeDeep(gltf.scene);
            return;
          }
          const model = gltf.scene;
          const box = new THREE.Box3().setFromObject(model);
          const size = new THREE.Vector3();
          box.getSize(size);
          model.scale.setScalar(2.32 / Math.max(size.y, 0.0001)); // match the fallback height
          box.setFromObject(model);
          const center = new THREE.Vector3();
          box.getCenter(center);
          model.position.x -= center.x; // center on the plinth axis
          model.position.z -= center.z;
          model.position.y += -1.78 - box.min.y; // stand exactly where the fallback stood
          model.traverse((obj) => {
            if (!(obj instanceof THREE.Mesh)) return;
            obj.castShadow = true;
            const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
            let upgraded = false;
            mats.forEach((mat) => {
              if (
                mat instanceof THREE.MeshStandardMaterial ||
                mat instanceof THREE.MeshPhysicalMaterial
              ) {
                mat.metalness = Math.max(mat.metalness, 0.92);
                mat.roughness = Math.min(mat.roughness, 0.13);
                mat.envMapIntensity = 0.95;
                // Gentle pull toward house silver: keep most of the authored albedo (the bundled
                // model ships decent materials) while unifying highlights with the fallback.
                mat.color.lerp(new THREE.Color(0xeef2f7), 0.25);
                mat.userData.baseEnv = 0.95;
                silverMats.push(mat as THREE.MeshStandardMaterial);
                upgraded = true;
              }
            });
            if (!upgraded) obj.material = chrome; // unshaded junk: use the house silver
          });
          trophy.visible = false;
          holder.add(model);
        },
        undefined,
        () => {
          /* No model bundled yet (or it failed to parse) — the fallback stays; nothing breaks. */
        },
      );

      // ---- Ground ---------------------------------------------------------------------------
      // One vast dark floor so the room never ends at a visible wall — floating props are what
      // kill immersion. The polished slab pools env streaks under the trophy.
      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(240, 240),
        new THREE.MeshStandardMaterial({ color: 0x101216, roughness: 0.6, metalness: 0.3 }),
      );
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = FLOOR_Y;
      floor.receiveShadow = true;
      scene.add(floor);
      const slab = new THREE.Mesh(
        new THREE.CircleGeometry(2.6, 64),
        new THREE.MeshStandardMaterial({
          color: 0x0b0d11,
          roughness: 0.12,
          metalness: 0.8,
          envMapIntensity: 1.4,
        }),
      );
      slab.rotation.x = -Math.PI / 2;
      slab.position.y = FLOOR_Y + 0.005;
      slab.receiveShadow = true;
      scene.add(slab);
      // Soft contact shadow on top — the final grounding cue.
      const contact = new THREE.Mesh(
        new THREE.CircleGeometry(1.9, 48),
        new THREE.ShadowMaterial({ opacity: 0.42 }),
      );
      contact.rotation.x = -Math.PI / 2;
      contact.position.y = FLOOR_Y + 0.01;
      contact.receiveShadow = true;
      scene.add(contact);

      const key = new THREE.DirectionalLight(0xfff2dc, 1.35);
      key.position.set(4, 9, 5);
      key.castShadow = true;
      key.shadow.mapSize.set(2048, 2048);
      key.shadow.camera.left = key.shadow.camera.bottom = -7;
      key.shadow.camera.right = key.shadow.camera.top = 7;
      key.shadow.camera.near = 0.5;
      key.shadow.camera.far = 32;
      scene.add(key);
      const rim = new THREE.DirectionalLight(0xbcd2ff, 0.9);
      rim.position.set(-6, 3.5, -6);
      scene.add(rim);

      // ---- Stadium bowl: distant silhouette + crowd lights + drifting haze ------------------
      // The old room was infinite black — a place with no walls reads as void. A fog-swallowed
      // bowl ring gives every shot a horizon and depth without ever resolving into detail.
      const bowl = new THREE.Mesh(
        new THREE.CylinderGeometry(24, 30, 12, 64, 1, true),
        new THREE.MeshStandardMaterial({
          color: 0x0a0c11,
          roughness: 0.95,
          metalness: 0,
          side: THREE.BackSide, // viewed from inside
        }),
      );
      bowl.position.y = FLOOR_Y + 6;
      scene.add(bowl);
      // Crowd lights: tiny cool speckles scattered across the upper bowl — the "city at night"
      // texture that makes the darkness feel inhabited rather than empty.
      const crowdCount = 700;
      const crowdPositions = new Float32Array(crowdCount * 3);
      for (let i = 0; i < crowdCount; i++) {
        const angle = Math.random() * Math.PI * 2;
        const radius = 22 + Math.random() * 6;
        crowdPositions[i * 3] = Math.cos(angle) * radius;
        crowdPositions[i * 3 + 1] = FLOOR_Y + 2.5 + Math.random() * 7;
        crowdPositions[i * 3 + 2] = Math.sin(angle) * radius;
      }
      const crowdGeometry = new THREE.BufferGeometry();
      crowdGeometry.setAttribute('position', new THREE.BufferAttribute(crowdPositions, 3));
      const crowdMaterial = new THREE.PointsMaterial({
        color: 0x8fa3c8,
        size: 0.09,
        transparent: true,
        opacity: 0.4,
        sizeAttenuation: true,
        depthWrite: false,
      });
      const crowd = new THREE.Points(crowdGeometry, crowdMaterial);
      scene.add(crowd);
      // Haze: sparse dust motes drifting near the stage so light has something to catch.
      const hazeCount = 140;
      const hazePositions = new Float32Array(hazeCount * 3);
      for (let i = 0; i < hazeCount; i++) {
        const angle = Math.random() * Math.PI * 2;
        const radius = 2 + Math.random() * 10;
        hazePositions[i * 3] = Math.cos(angle) * radius;
        hazePositions[i * 3 + 1] = FLOOR_Y + Math.random() * 5;
        hazePositions[i * 3 + 2] = Math.sin(angle) * radius;
      }
      const hazeGeometry = new THREE.BufferGeometry();
      hazeGeometry.setAttribute('position', new THREE.BufferAttribute(hazePositions, 3));
      const hazeMaterial = new THREE.PointsMaterial({
        color: 0xc6ceda,
        size: 0.05,
        transparent: true,
        opacity: 0.28,
        sizeAttenuation: true,
        depthWrite: false,
      });
      const haze = new THREE.Points(hazeGeometry, hazeMaterial);
      scene.add(haze);

      // No visible light props: the environment map lights the metal through reflections alone,
      // and a clean dark backdrop (CSS glow + vignette) carries the room.

      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const pointer = { x: 0, y: 0 };
      const onPointerMove = (event: PointerEvent) => {
        pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
        pointer.y = (event.clientY / window.innerHeight) * 2 - 1;
      };
      if (!reduceMotion) window.addEventListener('pointermove', onPointerMove);

      // Post chain: render → bloom rolloff on the hot sources → output (tone mapping applies
      // here now that the composer owns the final buffer).
      const bloom = new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        0.14, // strength — halved twice from the original blaze; highlights roll off, not flare
        0.75,
        0.88, // threshold — only the hottest env streaks bloom at all now
      );
      const composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      composer.addPass(bloom);
      composer.addPass(new OutputPass());

      // Fixed full-viewport layer: size to the visual viewport, not a parent box.
      const resize = () => {
        const w = window.innerWidth;
        const h = Math.max(window.innerHeight, 1);
        renderer.setSize(w, h, false);
        composer.setSize(w, h);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      };
      resize();
      window.addEventListener('resize', resize);

      const smoothstep = (x: number) => x * x * (3 - 2 * x);
      const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
      /** Sample a `[p, …values]` key track at whole-page progress `p` (smoothstepped segments). */
      const sampleTrack = <T extends number[]>(track: readonly { p: number; v: T }[], p: number): T => {
        let i = 0;
        while (i < track.length - 2 && p > track[i + 1]!.p) i++;
        const a = track[i]!;
        const b = track[i + 1]!;
        const t = smoothstep(Math.min(Math.max((p - a.p) / (b.p - a.p || 1), 0), 1));
        const out = [] as unknown as T;
        a.v.forEach((av, j) => {
          (out as number[])[j] = lerp(av, b.v[j]!, t);
        });
        return out;
      };
      const cameraTrack = CAMERA_KEYS.map(
        (k): { p: number; v: [number, number, number, number, number, number] } => ({
          p: k.p,
          v: [...k.pos, ...k.look],
        }),
      );
      // Trophy travel: center stage → carried right while the wide shot holds the facts left →
      // looming close behind the provider panels → home to center stage for the finale.
      // v = [x, y, z, scale, spin].
      const trophyTrack: { p: number; v: [number, number, number, number, number] }[] = [
        { p: 0.0, v: [0, 0, 0, 1, 0] },
        { p: 0.32, v: [2.4, 0, -1.4, 0.85, 1.9] },
        { p: 0.68, v: [-0.6, 0.08, -0.6, 1.02, 4.1] },
        { p: 1.0, v: [0, 0, 0, 1, 6.28] },
      ];

      let raf = 0;
      const clock = new THREE.Clock();
      const frame = () => {
        raf = requestAnimationFrame(frame);
        if (document.hidden) return;
        const t = clock.getElapsedTime();

        // Whole-page scroll progress drives ONE continuous camera shot through the world.
        const doc = document.documentElement;
        const maxScroll = Math.max(doc.scrollHeight - window.innerHeight, 1);
        const p = reduceMotion ? 0 : Math.min(Math.max(window.scrollY / maxScroll, 0), 1);
        const c = sampleTrack(cameraTrack, p);
        const parallax = reduceMotion ? 0 : 1 - p; // pointer parallax fades out past the hero
        camera.position.set(c[0] + pointer.x * 0.14 * parallax, c[1] - pointer.y * 0.09 * parallax, c[2]);
        camera.lookAt(c[3], c[4], c[5]);

        const tp = sampleTrack(trophyTrack, p);
        holder.position.set(
          tp[0],
          tp[1] + (reduceMotion ? 0 : Math.sin(t * 0.7) * 0.04 * (1 - p)),
          tp[2],
        );
        holder.scale.setScalar(tp[3]);
        holder.rotation.y = tp[4] + (reduceMotion ? 0.35 : t * 0.22 * (1 - p * 0.6));
        if (!reduceMotion) {
          trophy.rotation.x = pointer.y * 0.07 * (1 - p);
          trophy.rotation.z = pointer.x * -0.04 * (1 - p);
        }

        // Dim the hero lighting as the page descends so the copy owns the frame.
        const dim = 1 - p * 0.4;
        silverMats.forEach((m) => {
          m.envMapIntensity = (m.userData.baseEnv as number) * dim;
        });
        key.intensity = 1.35 * dim;
        // Atmosphere life: crowd twinkle + slow haze drift (both frozen under reduced motion).
        if (!reduceMotion) {
          crowdMaterial.opacity = 0.34 + Math.sin(t * 0.8) * 0.08;
          haze.rotation.y = t * 0.02;
          haze.position.y = Math.sin(t * 0.35) * 0.15;
        }

        composer.render();
      };
      frame();

      cleanup = () => {
        cancelAnimationFrame(raf);
        window.removeEventListener('resize', resize);
        if (!reduceMotion) window.removeEventListener('pointermove', onPointerMove);
        composer.dispose();
        bloom.dispose();
        renderer.dispose();
        environment.dispose();
        disposeDeep(scene);
      };
    });

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);

  return <canvas ref={canvasRef} className="landing-hero-canvas" aria-hidden="true" />;
}
