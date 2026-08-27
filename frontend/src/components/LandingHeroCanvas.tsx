import { useEffect, useRef } from 'react';
// Type-only imports: every runtime three import stays dynamic below so three never enters the
// initial bundle or the vitest graph.
import type { Material } from 'three';
import type * as THREE from 'three';
import { ATLAS_COLS, ATLAS_ROWS, NFL_TEAM_ABBREVS, teamAtlasCell, teamOrbitPlacement } from './landingTeamOrbit';

/**
 * Persistent cinematic WORLD behind the whole landing page (fixed full-viewport layer): the
 * page scrolls the camera through one continuous dark trophy room shared by every section:
 *
 *   hero       the Lombardi center-stage on its plinth under hard studio light banks, all 32 NFL
 *              teams drifting on nested rings that slowly converge toward it and fall back
 *   chapter I  a high wide pull-back that drifts the trophy to the right of the frame while
 *              the editorial facts own the left
 *   chapter II a low close angle from stage left — the chrome looms behind the frosted
 *              provider panels
 *   finale     a slow settle back to center stage for the sign-off
 *
 * Trophy realism: a licensed `.glb` model is loaded from `public/models/` when present,
 * normalized into the scene and given the full PBR treatment. Until it lands — or forever, if
 * it never does — a procedural Lombardi-style fallback renders instead, so nothing breaks. Both
 * paths share: a procedural stadium-light environment map (bright emissive "light bank" planes
 * baked through PMREMGenerator — the long specular streaks that make curved metal read as
 * photographed metal, with no HDR download honoring the $0/static-hosting target), ACES filmic
 * tone mapping, UnrealBloom hot-highlight rolloff, a soft contact shadow, a stepped brushed-metal
 * plinth the trophy actually stands on. The trophy itself is the only thing that glows: no halo
 * plane, no backdrop glow plane, no CSS glow shape behind it — those were all tried and each one
 * read as a soft circle floating next to/behind the trophy rather than light on the trophy (see
 * DECISIONS.md, 2026-08-26). Its brightness comes from real PBR reflections (environment-map
 * light banks + a warm key light) and ACES filmic tone mapping; `UnrealBloomPass` is kept
 * deliberately tiny (strength 0.12) so it can't balloon a bright specular pixel into a dome —
 * at most it takes the very hottest highlight and rolls its edge off softly. Every "real metal"
 * material carries a low-amplitude procedural roughness map — uniform roughness is what makes CG
 * chrome read as CG; micro-variation is what makes it read as photographed. The floor, ground
 * slab, and every light are deliberately kept from mirroring the flood strip (see DECISIONS.md,
 * 2026-08-26) — nothing in this frame glows except the trophy's own metal.
 *
 * Team orbit: 32 bare logo sprites (self-hosted under `public/team-logos/` — NOT fetched from
 * Sleeper's CDN at runtime; that path collided with the app's other, no-CORS uses of the same
 * CDN URLs via the browser's HTTP cache, see DECISIONS.md — baked into one shared, transparent
 * canvas atlas, unlit so their real colors show against the dark scene) drift on three nested,
 * independently precessing/converging rings — `landingTeamOrbit.ts` owns the pure placement math
 * so it's testable without a WebGL context, plus a small deterministic
 * off-billboard bank so the ring doesn't read as perfectly flat to the lens. No frame/ring or
 * glow around them — each logo's own alpha shape is what's visible, nothing else. (The earlier
 * per-team additive glow planes were removed, see DECISIONS.md 2026-08-26.)
 *
 * Degradations, in order:
 * - `prefers-reduced-motion`: a static lit hero frame — no animation, no camera travel, orbit
 *   frozen at its `t=0` arrangement.
 * - No WebGL context (headless browsers, jsdom, blocked GPU): the canvas stays transparent and
 *   the page degrades to a flat dark scene plus the vignette/grain layers — `landing-scene-glow`
 *   is kept as a mount point but deliberately carries no glow shape of its own (see
 *   DECISIONS.md, 2026-08-26) — so the page never looks broken, just plainer.
 * - A logo file fails to load: that cell of the atlas renders as a bare colored abbreviation
 *   (no background fill) in the team's own identity color — the orbit never shows a blank tile.
 * - Tab hidden: the render loop pauses via the visibility guard inside the frame callback.
 */

/** Where the optional bundled trophy model lives (`frontend/public/models/`). */
const TROPHY_MODEL_URL = '/models/trophy.glb';
/** Self-hosted team logos (`frontend/public/team-logos/{abbr}.png`, lowercase) — same-origin so
 * the atlas canvas never taints, and there's no shared-URL cache collision with the rest of the
 * app's (no-CORS) uses of Sleeper's CDN for the same logos. See DECISIONS.md. */
const TEAM_LOGO_DIR = '/team-logos';

/** World floor height — everything stands on this plane (the plinth's base, and the fallback
 * trophy's own touch point before the plinth lift is applied). */
const FLOOR_Y = -1.79;
/** Plinth height; the trophy stands on top of it, not directly on the floor. Tall and slim (a
 * museum-plinth silhouette) rather than the old 0.55 — a stand nearly 3x wider than tall read as
 * a dark ellipse instead of a pedestal. */
const PLINTH_HEIGHT = 1.5;
const PLINTH_TOP = FLOOR_Y + PLINTH_HEIGHT;
/** Tiny epsilon above the plinth's flat cap so the trophy's foot never z-fights with it. */
const TROPHY_STAND_Y = PLINTH_TOP + 0.01;
/** The fallback trophy's own lathe profile is authored with its foot at this local Y. */
const FALLBACK_TROPHY_BASE_Y = -1.78;

/**
 * Camera orbit waypoints keyed by whole-page scroll progress (0 = hero, 1 = footer). The trophy
 * itself never moves — it stays planted on its plinth at the world origin (see `holder` below) —
 * so scroll only orbits/dollies the camera around it: `angle` (radians, camera azimuth around the
 * Y axis), `radius` (distance from the origin), `height` (camera Y), and `lookY` (the Y the
 * camera aims at, always at x=0,z=0 — the trophy's own axis). This keeps the object anchored in
 * frame the whole shot; only the framing around it changes. Plain number arrays so the table
 * hoists at module scope without pulling three into it.
 */
// `height`/`lookY` here carry a flat +0.95 over the original pos.y/look.y values this track
// replaced — that's exactly PLINTH_HEIGHT's increase (0.55 -> 1.5, see the constant above).
// Shifting the whole rig (camera AND look target) by the same amount the trophy itself moved up
// preserves the original, already-tuned framing exactly, rather than re-guessing it.
const CAMERA_KEYS = [
  { p: 0.0, angle: 0.0, radius: 6.9, height: 1.7, lookY: 1.65 },
  { p: 0.32, angle: 0.66, radius: 8.2, height: 2.85, lookY: 1.5 }, // ~38° around
  { p: 0.68, angle: -0.38, radius: 5.4, height: 1.15, lookY: 2.0 }, // ~-22° around, low and close
  { p: 1.0, angle: 0.0, radius: 6.6, height: 1.55, lookY: 1.6 },
] as const;

/** Soft round twinkling point sprite — no texture needed, and a sub-pixel-size fade (rather than
 * a hard `gl_PointCoord` square) is what actually removes the pixelated-square shimmer a plain
 * `THREE.PointsMaterial` produces at distance. */
const TWINKLE_VERTEX_SHADER = /* glsl */ `
  attribute float aSize;
  attribute float aPhase;
  attribute float aSpeed;
  attribute vec3 aColor;
  uniform float uTime;
  uniform float uPixelScale;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    float perspectiveSize = aSize * uPixelScale / max(-mvPosition.z, 0.001);
    gl_PointSize = max(perspectiveSize, 1.0);
    // Points wanting to be smaller than a pixel fade out instead of aliasing into a hard square.
    float subPixelFade = min(perspectiveSize, 1.0);
    float twinkle = 0.65 + 0.35 * sin(uTime * aSpeed + aPhase);
    vAlpha = subPixelFade * twinkle;
    vColor = aColor;
    gl_Position = projectionMatrix * mvPosition;
  }
`;
const TWINKLE_FRAGMENT_SHADER = /* glsl */ `
  uniform float uOpacity;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    float a = smoothstep(0.5, 0.05, d);
    if (a < 0.02) discard;
    gl_FragColor = vec4(vColor, a * vAlpha * uOpacity);
  }
`;

/** Post-chain dither: a per-pixel, time-varying hash added at roughly +-1/255 breaks up 8-bit
 * banding in the near-black fog/bowl gradient without a visible grain pattern. */
const DITHER_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const DITHER_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform float uTime;
  varying vec2 vUv;
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453123);
  }
  void main() {
    vec4 color = texture2D(tDiffuse, vUv);
    float noise = (hash(gl_FragCoord.xy + uTime) - 0.5) / 255.0;
    gl_FragColor = vec4(color.rgb + noise, color.a);
  }
`;

/**
 * Loads one team logo image (self-hosted, same-origin) for the atlas canvas. Resolves to `null`
 * on any failure rather than rejecting — the caller paints a bare colored fallback glyph instead
 * of leaving that cell blank. No `crossOrigin` needed: a same-origin image never taints a canvas
 * regardless of this attribute, so setting it here would just be dead weight.
 */
function loadTeamLogo(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/**
 * Builds the shared 2048x1024 (8x4, 256px cells) team-logo atlas canvas used by every medallion
 * face mesh. The canvas stays transparent outside each drawn logo — the logos' own PNG alpha is
 * what gives each medallion its real silhouette (a shield, a wordmark, whatever the team's mark
 * actually is), not a circular/square clip. A logo that fails to load falls back to a bare
 * colored abbreviation glyph (no background fill) in that team's own identity color — a load
 * failure degrades the orbit, it never breaks it. No `three` dependency, so this stays a plain
 * async canvas builder.
 */
/** Team identity color used (as a fallback) for the atlas's bare
 * abbreviation glyph. Reads `--team-XX-ink`, not `--team-XX-primary` — several primaries are
 * near-black (`--team-chi`, `--team-cle`, …) and would be invisible against a dark surface;
 * `-ink` is the lightened variant `styles/teamColors.css` guarantees to be visible. */
function teamInkColor(abbrev: string): string {
  const rootStyle = getComputedStyle(document.documentElement);
  return rootStyle.getPropertyValue(`--team-${abbrev.toLowerCase()}-ink`).trim() || '#818faa';
}

async function buildTeamAtlas(): Promise<HTMLCanvasElement> {
  const width = ATLAS_COLS * 256;
  const height = ATLAS_ROWS * 256;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  await Promise.all(
    NFL_TEAM_ABBREVS.map(async (abbrev, i) => {
      const cell = teamAtlasCell(i);
      const px = cell.u * width;
      const py = cell.v * height;
      const cw = cell.du * width;
      const ch = cell.dv * height;
      const url = `${TEAM_LOGO_DIR}/${abbrev.toLowerCase()}.png`;
      const img = await loadTeamLogo(url);
      if (img) {
        const margin = cw * 0.12;
        const maxSize = cw - margin * 2;
        const scale = Math.min(maxSize / img.width, maxSize / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, px + (cw - w) / 2, py + (ch - h) / 2, w, h);
      } else {
        ctx.fillStyle = teamInkColor(abbrev);
        ctx.font = `800 ${Math.round(ch * 0.3)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(abbrev, px + cw / 2, py + ch / 2);
      }
    }),
  );
  return canvas;
}

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
      import('three/examples/jsm/postprocessing/ShaderPass.js'),
    ]).then(
      ([
        THREE,
        { GLTFLoader },
        { EffectComposer },
        { RenderPass },
        { UnrealBloomPass },
        { OutputPass },
        { ShaderPass },
      ]) => {
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
      const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();

      const scene = new THREE.Scene();
      // Opaque background matching the fog color: without it, the empty space above the floor's
      // geometric horizon is fully transparent (renderer alpha:true) and shows the CSS page
      // background through — a lighter gray (#131518-ish) than the fog, which reads as a faint
      // seam right where the floor meets "sky." Matching them makes the room read as one
      // continuous dark space. Only affects the WebGL-active path; the no-WebGL fallback (canvas
      // never drawn at all) is unaffected — see the doc comment above.
      scene.background = new THREE.Color(0x05060a);
      // Dense air: the fog is what keeps the plinth grounded in photographed depth instead of
      // floating in a void, and — since the stadium bowl mesh was removed (see DECISIONS.md) —
      // it's now the ONLY thing that gives the room a horizon. Density lands the room at ~72% fog
      // by 25 world units, true black by 40 (0.045 is also what a reference cinematic trophy site
      // ships, independently landed on).
      scene.fog = new THREE.FogExp2(0x05060a, 0.045);
      const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 160);

      // ---- Small procedural textures shared across several materials below -----------------
      /** Low-amplitude per-pixel value noise. Used as a `roughnessMap` so real-metal micro-
       * variation (the strongest single "photographed, not rendered" cue) replaces a flat,
       * uniform roughness value. */
      const createNoiseTexture = (size: number): THREE.CanvasTexture => {
        const noiseCanvas = document.createElement('canvas');
        noiseCanvas.width = noiseCanvas.height = size;
        const noiseCtx = noiseCanvas.getContext('2d');
        if (noiseCtx) {
          const imageData = noiseCtx.createImageData(size, size);
          for (let i = 0; i < imageData.data.length; i += 4) {
            const v = 170 + Math.floor(Math.random() * 85); // ~[170,255] -> multiplier ~[0.67,1.0]
            imageData.data[i] = v;
            imageData.data[i + 1] = v;
            imageData.data[i + 2] = v;
            imageData.data[i + 3] = 255;
          }
          noiseCtx.putImageData(imageData, 0, 0);
        }
        const texture = new THREE.CanvasTexture(noiseCanvas);
        texture.colorSpace = THREE.NoColorSpace;
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        return texture;
      };
      const roughnessNoise = createNoiseTexture(128);
      const tileNoise = (repeatX: number, repeatY: number): THREE.CanvasTexture => {
        const tiled = roughnessNoise.clone();
        tiled.repeat.set(repeatX, repeatY);
        tiled.needsUpdate = true;
        return tiled;
      };

      // ---- Procedural stadium-light environment (the realism backbone) --------------------
      // A dark room ringed with over-bright emissive "light bank" planes, PMREM-baked once.
      // Curved metal is ~90% reflection: soft-edged rectangular banks give long, softly-rolled-
      // off specular streaks (a hard-edged bank is a classic CG tell), the black room keeps
      // contrast, warm/cool split fakes floodlight color temperature.
      const bankGradient = (() => {
        const size = 128;
        const bankCanvas = document.createElement('canvas');
        bankCanvas.width = bankCanvas.height = size;
        const bankCtx = bankCanvas.getContext('2d');
        if (bankCtx) {
          const gradient = bankCtx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
          gradient.addColorStop(0, '#ffffff');
          gradient.addColorStop(0.55, '#ffffff');
          gradient.addColorStop(1, '#000000');
          bankCtx.fillStyle = gradient;
          bankCtx.fillRect(0, 0, size, size);
        }
        const texture = new THREE.CanvasTexture(bankCanvas);
        texture.colorSpace = THREE.NoColorSpace;
        return texture;
      })();
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
          new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(boost), map: bankGradient }),
        );
        bank.position.set(...pos);
        bank.rotation.set(...rot);
        envScene.add(bank);
      };
      addBank([12, 2], [0, 10, 0], [Math.PI / 2, 0, 0], 0xffffff, 3.8); // overhead flood strip
      addBank([3, 9], [-9, 3, 2], [0, Math.PI / 2, 0], 0xbfd4ff, 2.2); // cool left bank
      addBank([3, 9], [9, 3, -1], [0, -Math.PI / 2, 0], 0xffd9a0, 1.8); // warm right bank
      addBank([8, 4], [0, 2, 10], [0, Math.PI, 0], 0xdfe8ff, 0.25); // soft frontal fill — dim; shape
      // should come from the streak banks, not a flat wash aimed straight down the lens
      addBank([16, 3], [0, 9, -9], [Math.PI / 2, 0, 0], 0xd8e2ff, 1.1); // dim top-rear rim streak

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
        roughness: 0.24,
        roughnessMap: tileNoise(3, 6),
        // Intensity pushed above the bloom threshold's reach: the trophy's specular streaks are
        // what bloom turns into its glow (there is no halo plane anymore), so the metal itself
        // needs to run hot.
        envMapIntensity: 1.3,
      });
      chrome.userData.baseEnv = 1.3;
      const stitch = new THREE.MeshStandardMaterial({
        color: 0xdde5ee,
        metalness: 1,
        roughness: 0.27,
        roughnessMap: tileNoise(2, 4),
        envMapIntensity: 1.1,
      });
      stitch.userData.baseEnv = 1.1;
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

      // ---- Plinth: a real stepped pedestal the trophy actually stands on -------------------
      // A tall, slim museum-plinth column — the old profile (radius 1.55 over height 0.55, ~2.8x
      // wider than tall) read as a dark ellipse rather than a pedestal, and was ~4x wider than the
      // trophy itself. No accent ring: the emissive torus was the single cheapest-looking element
      // in the scene, and a plain plinth reads as heavier, more expensive metal.
      const buildPlinth = (): THREE.Group => {
        // Foot radii: the cap (0.9) must clear the widest seated trophy foot (the fallback lathe's
        // base flares to r=0.74) — the previous 0.56 cap let the trophy OVERHANG its own stand,
        // which is exactly what made the pedestal read as fake and "off-center." Base stays a
        // touch wider than the cap for a stepped-pedestal silhouette.
        const profile = [
          new THREE.Vector2(0.001, 0), // bottom center cap
          new THREE.Vector2(1.02, 0), // base foot, bottom
          new THREE.Vector2(1.02, 0.09), // base foot, top (vertical wall)
          new THREE.Vector2(0.82, 0.2), // chamfer down into the shaft
          new THREE.Vector2(0.52, 1.32), // slender shaft
          new THREE.Vector2(0.74, 1.42), // flare up into the cap
          new THREE.Vector2(0.9, PLINTH_HEIGHT), // top cap, outer edge
          new THREE.Vector2(0.001, PLINTH_HEIGHT), // top center cap
        ];
        const group = new THREE.Group();
        const body = new THREE.Mesh(
          new THREE.LatheGeometry(profile, 96),
          new THREE.MeshStandardMaterial({
            color: 0x0e1013,
            metalness: 0.9,
            roughness: 0.35,
            roughnessMap: tileNoise(2, 8),
            envMapIntensity: 0.6,
          }),
        );
        body.castShadow = true;
        body.receiveShadow = true;
        group.add(body);
        group.position.y = FLOOR_Y;
        return group;
      };
      scene.add(buildPlinth());

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
      trophy.position.y = TROPHY_STAND_Y - FALLBACK_TROPHY_BASE_Y; // stand it on the plinth cap
      const holder = new THREE.Group(); // scroll choreography drives this node only
      trophy.traverse((obj) => {
        if (obj instanceof THREE.Mesh) obj.castShadow = true;
      });
      holder.add(trophy);
      scene.add(holder);

      // No halo, no backdrop light: the trophy glows because its own specular highlights exceed
      // the bloom threshold (see the UnrealBloomPass tuning below). A billboarded glow plane
      // behind the object — even a small one — reads as a white circle floating next to the
      // trophy from every orbit angle (see DECISIONS.md, 2026-08-26); removed outright.

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
          model.updateMatrixWorld(true);
          box.setFromObject(model);
          // Center on the plinth axis by VISUAL FOOTPRINT, not raw bbox center: the bbox midpoint
          // of an asymmetric trophy (tilted ball, off-axis laces) sits away from where the object
          // actually presses down on the stand, so it read as "not centered in the stand." The
          // centroid of the vertices in the bottom slice of the model is where its mass visually
          // sits — that is what should align with x=z=0.
          const bottomBand = box.min.y + size.y * 0.12;
          let sumX = 0;
          let sumZ = 0;
          let weight = 0;
          const v = new THREE.Vector3();
          model.traverse((obj) => {
            if (!(obj instanceof THREE.Mesh)) return;
            const pos = obj.geometry.getAttribute('position');
            if (!pos) return;
            for (let i = 0; i < pos.count; i++) {
              v.fromBufferAttribute(pos as unknown as THREE.BufferAttribute, i);
              obj.localToWorld(v);
              if (v.y <= bottomBand) {
                sumX += v.x;
                sumZ += v.z;
                weight += 1;
              }
            }
          });
          const center = new THREE.Vector3();
          box.getCenter(center); // degenerate-geometry fallback only
          const axisX = weight > 0 ? sumX / weight : center.x;
          const axisZ = weight > 0 ? sumZ / weight : center.z;
          model.position.x -= axisX; // center the visual footprint on the plinth axis
          model.position.z -= axisZ;
          model.position.y += TROPHY_STAND_Y - box.min.y; // stand it on the plinth cap
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
                // A uniform 0.13 roughness clamp made this a perfect mirror — believable metal
                // needs a real target plus micro-variation, not a "shinier than possible" floor.
                mat.roughness = 0.2;
                if (!mat.roughnessMap) mat.roughnessMap = tileNoise(3, 5);
                mat.envMapIntensity = 1.3;
                // Gentle pull toward house silver: keep most of the authored albedo (the bundled
                // model ships decent materials) while unifying highlights with the fallback.
                mat.color.lerp(new THREE.Color(0xeef2f7), 0.12);
                mat.userData.baseEnv = 1.3;
                silverMats.push(mat as THREE.MeshStandardMaterial);
                upgraded = true;
              }
            });
            if (!upgraded) obj.material = chrome; // unshaded junk: use the house silver
          });
          holder.remove(trophy);
          disposeDeep(trophy);
          holder.add(model);
        },
        undefined,
        () => {
          /* No model bundled yet (or it failed to parse) — the fallback stays; nothing breaks. */
        },
      );

      // ---- Ground ---------------------------------------------------------------------------
      // One vast dark floor so the room never ends at a visible wall — floating props are what
      // kill immersion. The polished slab pools env streaks under the plinth.
      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(240, 240),
        // Near-matte: at metalness 0.3 this plane mirrored the env map's overhead flood strip
        // across its whole extent, reading as a wide sheen spreading out from the stand instead of
        // the trophy being the only light source in frame (see DECISIONS.md, 2026-08-26).
        new THREE.MeshStandardMaterial({ color: 0x101216, roughness: 0.85, metalness: 0.05, envMapIntensity: 0.25 }),
      );
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = FLOOR_Y;
      floor.receiveShadow = true;
      scene.add(floor);
      // Both circles sized to the new wider plinth base (radius 1.02) rather than ringing the
      // old, much wider one (radius 1.55).
      const slab = new THREE.Mesh(
        new THREE.CircleGeometry(1.35, 64),
        new THREE.MeshStandardMaterial({
          color: 0x08090c,
          // Pure matte, reflecting nothing: even the satin-finish 0.25/0.5 pass here (see
          // DECISIONS.md, 2026-08-26) still pooled a visible bright ellipse under the flood strip —
          // a stray light not attached to the trophy. The trophy's own bloomed highlights are the
          // only glow allowed near the stand; this slab just grounds it in shadow.
          roughness: 0.95,
          metalness: 0,
          envMapIntensity: 0,
        }),
      );
      slab.rotation.x = -Math.PI / 2;
      slab.position.y = FLOOR_Y + 0.005;
      slab.receiveShadow = true;
      scene.add(slab);
      // Soft contact shadow on top — the final grounding cue.
      // Contact shadow widened to cover the new wider plinth base (radius 1.02).
      const contact = new THREE.Mesh(
        new THREE.CircleGeometry(1.25, 48),
        new THREE.ShadowMaterial({ opacity: 0.42 }),
      );
      contact.rotation.x = -Math.PI / 2;
      contact.position.y = FLOOR_Y + 0.01;
      contact.receiveShadow = true;
      scene.add(contact);

      const key = new THREE.DirectionalLight(0xfff2dc, 1.6);
      key.position.set(4, 9, 5);
      key.castShadow = true;
      key.shadow.mapSize.set(2048, 2048);
      key.shadow.camera.left = key.shadow.camera.bottom = -7;
      key.shadow.camera.right = key.shadow.camera.top = 7;
      key.shadow.camera.near = 0.5;
      key.shadow.camera.far = 32;
      scene.add(key);
      // Neutralized from a cool blue (0xbcd2ff) — that cast a visible blue tint on the trophy's
      // shadow side. `key` stays warm so the warm/cool split still reads as photographed metal;
      // this light no longer contributes its own hue.
      const rim = new THREE.DirectionalLight(0xdfe6ef, 0.75);
      rim.position.set(-6, 3.5, -6);
      scene.add(rim);

      // ---- Horizon: crowd lights + drifting haze -------------------------------------------
      // A prior "stadium bowl" cylinder mesh gave every shot a visible wall — its gradient never
      // actually cleared the fog (see DECISIONS.md) and read as a flat gray panel behind the
      // trophy. Removed. The room now falls off to true black on fog density alone; the crowd
      // twinkle field below is the only horizon cue — distant lights in darkness, no wall.

      /** A field of soft, independently-twinkling round points — the fix for
       * `THREE.PointsMaterial`'s hard, textureless `gl_PointCoord` square, which aliases into
       * pixelated shimmer at distance, and for its single shared opacity uniform, which pulsed
       * every point in lockstep (the "AI-generated breathing" look). */
      const createTwinkleField = (opts: {
        count: number;
        color: THREE.Color;
        colorJitter: number;
        sizeMin: number;
        sizeMax: number;
        opacity: number;
        speedMin: number;
        speedMax: number;
        position: () => [number, number, number];
      }) => {
        const positions = new Float32Array(opts.count * 3);
        const sizes = new Float32Array(opts.count);
        const phases = new Float32Array(opts.count);
        const speeds = new Float32Array(opts.count);
        const colors = new Float32Array(opts.count * 3);
        for (let i = 0; i < opts.count; i++) {
          const [x, y, z] = opts.position();
          positions[i * 3] = x;
          positions[i * 3 + 1] = y;
          positions[i * 3 + 2] = z;
          sizes[i] = opts.sizeMin + Math.random() * (opts.sizeMax - opts.sizeMin);
          phases[i] = Math.random() * Math.PI * 2;
          speeds[i] = opts.speedMin + Math.random() * (opts.speedMax - opts.speedMin);
          const jitter = (Math.random() - 0.5) * opts.colorJitter;
          colors[i * 3] = THREE.MathUtils.clamp(opts.color.r + jitter, 0, 1);
          colors[i * 3 + 1] = THREE.MathUtils.clamp(opts.color.g + jitter, 0, 1);
          colors[i * 3 + 2] = THREE.MathUtils.clamp(opts.color.b + jitter, 0, 1);
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
        geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
        geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
        const material = new THREE.ShaderMaterial({
          uniforms: {
            uTime: { value: 0 },
            uPixelScale: { value: window.innerHeight * 0.5 },
            uOpacity: { value: opts.opacity },
          },
          vertexShader: TWINKLE_VERTEX_SHADER,
          fragmentShader: TWINKLE_FRAGMENT_SHADER,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        });
        const points = new THREE.Points(geometry, material);
        return { points, material };
      };
      // Crowd lights: tiny cool speckles scattered across the upper bowl — the "city at night"
      // texture that makes the darkness feel inhabited rather than empty.
      const crowdField = createTwinkleField({
        count: 1400,
        color: new THREE.Color(0x8fa3c8),
        colorJitter: 0.12,
        sizeMin: 0.05,
        sizeMax: 0.11,
        opacity: 0.4,
        speedMin: 0.3,
        speedMax: 1.1,
        position: () => {
          const angle = Math.random() * Math.PI * 2;
          const radius = 22 + Math.random() * 6;
          return [Math.cos(angle) * radius, FLOOR_Y + 2.5 + Math.random() * 7, Math.sin(angle) * radius];
        },
      });
      scene.add(crowdField.points);
      // Haze: sparse dust motes drifting near the stage so light has something to catch.
      const hazeField = createTwinkleField({
        count: 140,
        color: new THREE.Color(0xc6ceda),
        colorJitter: 0.08,
        sizeMin: 0.03,
        sizeMax: 0.07,
        opacity: 0.28,
        speedMin: 0.15,
        speedMax: 0.5,
        position: () => {
          const angle = Math.random() * Math.PI * 2;
          const radius = 2 + Math.random() * 10;
          return [Math.cos(angle) * radius, FLOOR_Y + Math.random() * 5, Math.sin(angle) * radius];
        },
      });
      scene.add(hazeField.points);

      // ---- Team orbit: all 32 franchises drifting around the trophy, closing in and falling
      // back on three nested, independently-precessing rings (landingTeamOrbit.ts owns the pure
      // placement math). Faces are individual meshes sharing one atlas texture with per-mesh
      // baked UV offsets (simple and robust). Bare logos, no frame/ring around them — each
      // logo's own alpha shape is what's visible.
      let medallionMeshes: THREE.Mesh[] = [];
      let atlasTexture: THREE.CanvasTexture | null = null;
      void buildTeamAtlas().then((atlasCanvas) => {
        if (disposed) return;
        const texture = new THREE.CanvasTexture(atlasCanvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = maxAnisotropy;
        texture.needsUpdate = true;
        atlasTexture = texture;
        // Unlit (a UI-sprite-style element, not a lit surface — MeshStandardMaterial + the dim
        // stadium lighting was crushing the logos' real colors), but tone-mapped and fogged so
        // the rings still recede into the dark room instead of hovering like flat stickers over
        // it. A plain, square plane (not CircleGeometry) so a non-circular mark (a shield, a
        // wordmark) isn't clipped; the logo's own PNG alpha defines its true shape.
        const medallionMaterial = new THREE.MeshBasicMaterial({
          map: texture,
          transparent: true,
          // Bumped (0.28 -> 0.34 -> 0.6) alongside the larger geometry: the ring reads as a
          // real presence of emblems, not a faint suggestion (see DECISIONS.md, 2026-08-26).
          opacity: 0.6,
          depthWrite: false,
          fog: true,
        });
        const baseFaceGeometry = new THREE.PlaneGeometry(0.55, 0.55);
        const meshes = NFL_TEAM_ABBREVS.map((_, i) => {
          const cell = teamAtlasCell(i);
          const geometry = baseFaceGeometry.clone();
          const uvAttr = geometry.attributes['uv'] as THREE.BufferAttribute;
          const flippedRow = ATLAS_ROWS - 1 - cell.row; // canvas rows run top-down; UV origin is bottom-left
          for (let v = 0; v < uvAttr.count; v++) {
            const u0 = uvAttr.getX(v);
            const v0 = uvAttr.getY(v);
            uvAttr.setXY(v, cell.u + u0 * cell.du, flippedRow * cell.dv + v0 * cell.dv);
          }
          uvAttr.needsUpdate = true;
          const mesh = new THREE.Mesh(geometry, medallionMaterial);
          mesh.castShadow = false;
          mesh.receiveShadow = false;
          return mesh;
        });
        baseFaceGeometry.dispose();
        meshes.forEach((mesh) => scene.add(mesh));
        medallionMeshes = meshes;
      });

      // No visible light props: the environment map lights the metal through reflections alone,
      // and a clean dark backdrop (CSS glow/vignette/grain) carries the room.

      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const pointer = { x: 0, y: 0 };
      const onPointerMove = (event: PointerEvent) => {
        pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
        pointer.y = (event.clientY / window.innerHeight) * 2 - 1;
      };
      if (!reduceMotion) window.addEventListener('pointermove', onPointerMove);

      // Post chain: render -> bloom rolloff on the hot sources -> output (tone mapping applies
      // here) -> a final temporal dither that breaks up 8-bit banding in the dark gradient.
      const bloom = new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        // Kept deliberately tiny. At 0.7/0.7/0.62 (and earlier, via a separate backdrop glow
        // plane) this still read as a soft white circle floating behind/next to the trophy from
        // most orbit angles — a post-process artifact, not light on the metal (see DECISIONS.md,
        // 2026-08-26). At this strength/radius/threshold only the tightest, hottest specular
        // pixels roll off at all; there is no dome. The trophy's brightness comes from the
        // material + env-map reflections + ACES tone mapping, not from bloom.
        0.12,
        0.35,
        0.92, // threshold
      );
      const ditherPass = new ShaderPass({
        uniforms: { tDiffuse: { value: null }, uTime: { value: 0 } },
        vertexShader: DITHER_VERTEX_SHADER,
        fragmentShader: DITHER_FRAGMENT_SHADER,
      });
      const composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      composer.addPass(bloom);
      composer.addPass(new OutputPass());
      composer.addPass(ditherPass);

      // Fixed full-viewport layer: size to the visual viewport, not a parent box.
      const resize = () => {
        const w = window.innerWidth;
        const h = Math.max(window.innerHeight, 1);
        renderer.setSize(w, h, false);
        composer.setSize(w, h);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        crowdField.material.uniforms['uPixelScale']!.value = h * 0.5;
        hazeField.material.uniforms['uPixelScale']!.value = h * 0.5;
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
      // Camera orbit track: [angle, radius, height, lookY] per waypoint (see CAMERA_KEYS doc —
      // the trophy itself never moves, so this is the whole shot).
      const cameraTrack = CAMERA_KEYS.map(
        (k): { p: number; v: [number, number, number, number] } => ({
          p: k.p,
          v: [k.angle, k.radius, k.height, k.lookY],
        }),
      );

      const teamDummy = new THREE.Object3D();
      let raf = 0;
      const clock = new THREE.Clock();
      // Damped scroll progress: the raw scrollY ratio below is the TARGET the camera eases
      // toward, not what it renders directly — a 1:1 mapping made the shot snap with the wheel
      // instead of gliding, which is most of what "weird floating" actually looked like.
      let scrollP = 0;
      const frame = () => {
        raf = requestAnimationFrame(frame);
        if (document.hidden) return;
        // `getDelta()` already advances `clock.elapsedTime` as a side effect — read the property
        // directly rather than also calling `getElapsedTime()` (which calls `getDelta()` again
        // and would silently eat a second, near-zero slice of time each frame).
        const dt = clock.getDelta();
        const t = clock.elapsedTime;

        // Whole-page scroll progress drives ONE continuous camera shot through the world.
        const doc = document.documentElement;
        const maxScroll = Math.max(doc.scrollHeight - window.innerHeight, 1);
        const targetP = reduceMotion ? 0 : Math.min(Math.max(window.scrollY / maxScroll, 0), 1);
        if (reduceMotion) {
          scrollP = 0;
        } else {
          // Frame-rate-independent ease: converges the same amount per elapsed second
          // regardless of refresh rate.
          const k = 1 - Math.pow(0.001, dt);
          scrollP += (targetP - scrollP) * k;
        }
        const p = scrollP;
        const c = sampleTrack(cameraTrack, p);
        const [angle, radius, height, lookY] = c;
        const parallax = reduceMotion ? 0 : 1 - p; // pointer parallax fades out past the hero
        camera.position.set(
          Math.sin(angle) * radius + pointer.x * 0.14 * parallax,
          height - pointer.y * 0.09 * parallax,
          Math.cos(angle) * radius,
        );
        // The trophy never leaves the origin — the camera orbits it, so it always looks planted
        // on its plinth instead of sliding across the frame.
        camera.lookAt(0, lookY, 0);

        // The trophy holder stays fixed at the world origin — it never moves in world space, only
        // turns slowly in place (coherent) rather than translating across the frame (the bug this
        // fixes: it used to fly off its plinth mid-scroll). Frozen under reduced motion, matching
        // every other idle animation in this scene.
        holder.rotation.y = reduceMotion ? 0.35 : t * 0.05;
        if (!reduceMotion) {
          trophy.rotation.x = pointer.y * 0.07 * (1 - p);
          trophy.rotation.z = pointer.x * -0.04 * (1 - p);
        }

        // Dim the hero lighting as the page descends so the copy owns the frame.
        const dim = 1 - p * 0.4;
        silverMats.forEach((m) => {
          m.envMapIntensity = (m.userData.baseEnv as number) * dim;
        });
        key.intensity = 1.6 * dim;

        // Atmosphere life: crowd/haze twinkle + slow haze drift (frozen under reduced motion).
        if (!reduceMotion) {
          crowdField.material.uniforms['uTime']!.value = t;
          hazeField.material.uniforms['uTime']!.value = t;
          hazeField.points.rotation.y = t * 0.02;
          hazeField.points.position.y = Math.sin(t * 0.35) * 0.15;
        }
        ditherPass.uniforms['uTime']!.value = t;

        // Team orbit: 32 medallions on nested converging rings, billboarded to the camera, fading
        // out if a ring sweeps too close to the lens, and receding with the same scroll dim as
        // the trophy's own materials so the copy owns the frame past the hero.
        const orbitTime = reduceMotion ? 0 : t;
        for (let i = 0; i < NFL_TEAM_ABBREVS.length; i++) {
          const placement = teamOrbitPlacement(i, orbitTime);
          const distToCam = Math.hypot(
            placement.x - camera.position.x,
            placement.y - camera.position.y,
            placement.z - camera.position.z,
          );
          // Rings now sit well outside the camera's own orbit (inner-ring floor 6.0-8.0 vs.
          // camera radius 5.4-8.2), but the camera can still swing close to an inner-ring
          // medallion when their angles line up — this fade keeps that pass-close moment from
          // ever dominating the frame at this lens's FOV.
          const camFade = THREE.MathUtils.clamp((distToCam - 3.0) / 2.6, 0, 1);
          const scale = placement.scale * dim * camFade;
          teamDummy.position.set(placement.x, placement.y, placement.z);
          teamDummy.scale.setScalar(scale);
          teamDummy.lookAt(camera.position);
          // Small deterministic off-billboard bank (not random — the reduced-motion static frame
          // must stay stable) so the ring doesn't read as every logo perfectly flat to the lens.
          teamDummy.rotateY(((i % 5) - 2) * 0.09);
          teamDummy.rotateX(((i % 3) - 1) * 0.06);
          const visible = scale > 0.01;
          const face = medallionMeshes[i];
          if (face) {
            face.position.copy(teamDummy.position);
            face.scale.copy(teamDummy.scale);
            face.quaternion.copy(teamDummy.quaternion);
            face.visible = visible;
          }
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
        bankGradient.dispose();
        roughnessNoise.dispose();
        atlasTexture?.dispose();
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
