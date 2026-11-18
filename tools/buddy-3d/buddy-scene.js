// Habi in 3D: a hamster made of smooth shapes, lit like a soft clay toy, posed by mood and time.
// render.mjs draws it in a browser (WebGL) and saves each animation for the app
// (frontend/assets/buddy). Nothing here runs in the app itself.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const TAU = Math.PI * 2;
const wave = (t, cycles = 1, phase = 0) => Math.sin((t * cycles + phase) * TAU);
// 1 at the middle of a blink that starts at `at` and lasts `length` (share of the loop).
const blinkAt = (t, at, length = 0.06) => {
  const k = (t - at) / length;
  return k > 0 && k < 1 ? Math.sin(k * Math.PI) : 0;
};

function furMaterial(color, extra = {}) {
  const tint = new THREE.Color(color);
  return new THREE.MeshPhysicalMaterial({
    color: tint,
    roughness: 0.66,
    sheen: 0.45,
    sheenRoughness: 0.55,
    sheenColor: tint.clone().lerp(new THREE.Color('#ffffff'), 0.35),
    ...extra,
  });
}

function ellipsoid(radii, material, segments = 72) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, segments, Math.round(segments / 2)), material);
  mesh.scale.set(radii[0], radii[1], radii[2]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function tube(points, radius, material) {
  const curve = new THREE.CatmullRomCurve3(points.map((point) => new THREE.Vector3(...point)));
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, radius, 12, false), material);
  // Round ends.
  for (const end of [points[0], points[points.length - 1]]) {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(radius, 12, 8), material);
    cap.position.set(...end);
    mesh.add(cap);
  }
  return mesh;
}

/** A soft round shadow texture for under the feet. */
function contactShadowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(128, 128, 0, 128, 128, 128);
  gradient.addColorStop(0, 'rgba(40,24,30,0.55)');
  gradient.addColorStop(0.45, 'rgba(40,24,30,0.28)');
  gradient.addColorStop(1, 'rgba(40,24,30,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 256, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Deeper fur on top, lighter below (vertex colours by height in the rest pose). */
function shadeByHeight(root, material, top, bottom, high = 2.1, low = 0.2) {
  root.updateMatrixWorld(true);
  const deep = new THREE.Color(top);
  const light = new THREE.Color(bottom);
  const point = new THREE.Vector3();
  root.traverse((node) => {
    if (!node.isMesh || node.material !== material) return;
    const geometry = node.geometry.clone();
    const positions = geometry.attributes.position;
    const colors = new Float32Array(positions.count * 3);
    for (let index = 0; index < positions.count; index += 1) {
      point.fromBufferAttribute(positions, index).applyMatrix4(node.matrixWorld);
      const k = Math.min(1, Math.max(0, (point.y - low) / (high - low)));
      const color = light.clone().lerp(deep, k * k);
      colors.set([color.r, color.g, color.b], index * 3);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    node.geometry = geometry;
  });
  material.vertexColors = true;
  material.color.set('#FFFFFF');
}

/** The hamster's parts, grouped so each can move on its own. */
function buildHamster() {
  const fur = furMaterial('#E8892F');
  const furLight = furMaterial('#F2A55A');
  const cream = furMaterial('#FFF2E0', { sheen: 0.3 });
  const pink = furMaterial('#F28BA5', { sheen: 0.2, roughness: 0.5 });
  const blush = new THREE.MeshStandardMaterial({ color: '#FF7F9E', roughness: 0.7, transparent: true, opacity: 0.55, depthWrite: false });
  const eye = new THREE.MeshPhysicalMaterial({ color: '#1D1320', roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.04 });
  const shine = new THREE.MeshBasicMaterial({ color: '#FFFFFF' });
  const line = new THREE.MeshStandardMaterial({ color: '#4B2A24', roughness: 0.45 });
  const mouthInside = new THREE.MeshStandardMaterial({ color: '#7A2E3A', roughness: 0.6 });
  const tongue = new THREE.MeshStandardMaterial({ color: '#FF7D93', roughness: 0.5 });
  const tooth = new THREE.MeshPhysicalMaterial({ color: '#FFFFFF', roughness: 0.25, clearcoat: 0.6 });

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const torso = ellipsoid([0.74, 0.68, 0.64], fur);
  torso.position.set(0, 0.64, 0);
  body.add(torso);
  const belly = ellipsoid([0.52, 0.5, 0.4], cream);
  belly.position.set(0, 0.56, 0.3);
  body.add(belly);

  // Feet: little ovals in front, toes forward.
  for (const side of [-1, 1]) {
    const foot = ellipsoid([0.2, 0.1, 0.25], furLight);
    foot.position.set(side * 0.33, 0.07, 0.4);
    foot.rotation.y = side * -0.25;
    body.add(foot);
    const pad = ellipsoid([0.1, 0.05, 0.08], pink);
    pad.position.set(side * 0.34, 0.06, 0.6);
    body.add(pad);
  }

  // Arms: a pivot at each shoulder so they can wave. Right (the viewer's right) holds things.
  const arms = {};
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.56, 0.9, 0.24);
    const arm = ellipsoid([0.15, 0.23, 0.15], fur);
    arm.position.set(0, -0.17, 0.05);
    shoulder.add(arm);
    const paw = ellipsoid([0.1, 0.085, 0.1], pink);
    paw.position.set(0, -0.36, 0.1);
    shoulder.add(paw);
    shoulder.rotation.z = side * 0.35;
    shoulder.rotation.x = -0.35;
    body.add(shoulder);
    arms[side < 0 ? 'left' : 'right'] = shoulder;
  }

  // Head on a neck pivot: turning it (yaw) keeps the top of the head in place.
  const head = new THREE.Group();
  head.position.set(0, 0.96, 0.03);
  root.add(head);
  const skull = ellipsoid([0.8, 0.7, 0.72], fur);
  skull.position.set(0, 0.5, 0);
  head.add(skull);
  const muzzle = ellipsoid([0.4, 0.28, 0.36], cream);
  muzzle.position.set(0, 0.28, 0.41);
  head.add(muzzle);
  // Puffy cheeks, a shade lighter than the head.
  for (const side of [-1, 1]) {
    const cheek = ellipsoid([0.28, 0.24, 0.26], furLight);
    cheek.position.set(side * 0.47, 0.3, 0.3);
    head.add(cheek);
  }

  // The front of the skull at (x, y) of the head group, a little outside (`lift`).
  const onSkull = (x, y, lift = 0) => {
    const [rx, ry, rz] = [0.8, 0.7, 0.72];
    const k = 1 - (x / rx) ** 2 - ((y - 0.5) / ry) ** 2;
    return new THREE.Vector3(x, y, Math.sqrt(Math.max(0, k)) * rz + lift);
  };

  // Eyes: open ones blink (scale), closed ones are arcs (happy ^^ or sleepy).
  const eyes = [];
  const happyEyes = [];
  const sleepyEyes = [];
  for (const side of [-1, 1]) {
    const spot = onSkull(side * 0.29, 0.57, -0.02);
    const pivot = new THREE.Group();
    pivot.position.copy(spot);
    pivot.lookAt(spot.clone().add(new THREE.Vector3(side * 0.25, 0.05, 1)));
    const ball = ellipsoid([0.122, 0.138, 0.065], eye, 48);
    pivot.add(ball);
    const big = new THREE.Mesh(new THREE.SphereGeometry(0.04, 16, 12), shine);
    big.position.set(-0.04 * side, 0.05, 0.06);
    pivot.add(big);
    const small = new THREE.Mesh(new THREE.SphereGeometry(0.017, 12, 8), shine);
    small.position.set(0.035 * side, -0.04, 0.05);
    pivot.add(small);
    head.add(pivot);
    eyes.push(pivot);
    const happy = tube([[-0.09, -0.02, 0], [0, 0.06, 0.01], [0.09, -0.02, 0]], 0.022, line);
    happy.position.copy(spot);
    happy.lookAt(spot.clone().add(new THREE.Vector3(side * 0.25, 0.05, 1)));
    head.add(happy);
    happyEyes.push(happy);
    const sleepy = tube([[-0.09, 0.02, 0], [0, -0.04, 0.01], [0.09, 0.02, 0]], 0.02, line);
    sleepy.position.copy(spot);
    sleepy.lookAt(spot.clone().add(new THREE.Vector3(side * 0.25, 0.05, 1)));
    head.add(sleepy);
    sleepyEyes.push(sleepy);
  }

  // Brows, only when worried (sad).
  const brows = [];
  for (const side of [-1, 1]) {
    const spot = onSkull(side * 0.27, 0.78, 0.0);
    const brow = tube([[-0.07, 0, 0], [0.07, 0, 0]], 0.018, line);
    brow.position.copy(spot);
    brow.lookAt(spot.clone().add(new THREE.Vector3(side * 0.2, 0.1, 1)));
    head.add(brow);
    brows.push({ brow, side });
  }

  for (const side of [-1, 1]) {
    const spot = onSkull(side * 0.5, 0.36, 0.02);
    const patch = ellipsoid([0.12, 0.075, 0.03], blush, 32);
    patch.position.copy(spot);
    patch.lookAt(spot.clone().add(new THREE.Vector3(side * 0.7, 0, 1)));
    patch.castShadow = false;
    head.add(patch);
  }

  const nose = ellipsoid([0.065, 0.048, 0.045], pink, 32);
  nose.position.set(0, 0.4, 0.775);
  head.add(nose);

  // Mouths: one shows at a time.
  const mouths = {
    smile: tube([[-0.13, 0.3, 0.74], [-0.065, 0.25, 0.775], [0, 0.29, 0.785], [0.065, 0.25, 0.775], [0.13, 0.3, 0.74]], 0.016, line),
    frown: tube([[-0.1, 0.24, 0.765], [0, 0.285, 0.785], [0.1, 0.24, 0.765]], 0.016, line),
    small: ellipsoid([0.04, 0.035, 0.02], mouthInside, 24),
    open: new THREE.Group(),
    joy: new THREE.Group(),
  };
  const smileShape = new THREE.Shape();
  smileShape.moveTo(0.12, 0);
  smileShape.absarc(0, 0, 0.12, 0, Math.PI, true);
  smileShape.closePath();
  const joyMouth = new THREE.Mesh(new THREE.ExtrudeGeometry(smileShape, { depth: 0.04, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 3, curveSegments: 32 }), mouthInside);
  joyMouth.scale.set(1, 0.95, 1);
  joyMouth.position.set(0, 0.3, 0.735);
  joyMouth.rotation.x = -0.12;
  mouths.joy.add(joyMouth);
  const joyTongue = ellipsoid([0.07, 0.04, 0.03], tongue, 24);
  joyTongue.position.set(0, 0.215, 0.79);
  mouths.joy.add(joyTongue);
  mouths.small.position.set(0, 0.27, 0.78);
  const openMouth = ellipsoid([0.12, 0.09, 0.05], mouthInside, 32);
  openMouth.position.set(0, 0.25, 0.76);
  mouths.open.add(openMouth);
  const openTongue = ellipsoid([0.075, 0.04, 0.03], tongue, 24);
  openTongue.position.set(0, 0.2, 0.79);
  mouths.open.add(openTongue);
  for (const mouth of Object.values(mouths)) head.add(mouth);
  const teeth = new THREE.Group();
  for (const side of [-1, 1]) {
    const one = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.055, 0.02, 2, 2, 1), tooth);
    one.position.set(side * 0.025, 0.215, 0.778);
    teeth.add(one);
  }
  head.add(teeth);

  const water = new THREE.MeshPhysicalMaterial({ color: '#9FDCFF', roughness: 0.05, transmission: 0.2, clearcoat: 1, transparent: true, opacity: 0.85 });
  const drool = ellipsoid([0.03, 0.045, 0.03], water, 24);
  drool.position.set(0.07, 0.14, 0.77);
  head.add(drool);
  const tear = ellipsoid([0.035, 0.05, 0.03], water, 24);
  const tearSpot = onSkull(0.33, 0.44, 0.03);
  tear.position.copy(tearSpot);
  head.add(tear);

  // Whiskers.
  const whisker = new THREE.MeshStandardMaterial({ color: '#B9876A', roughness: 0.6 });
  for (const side of [-1, 1]) {
    for (const [dy, tilt] of [[0.03, 0.07], [-0.02, -0.03]]) {
      const start = [side * 0.3, 0.33 + dy, 0.66];
      const whiskerTube = tube([start, [side * 0.52, 0.35 + dy + tilt * 0.5, 0.62], [side * 0.7, 0.36 + dy + tilt, 0.52]], 0.007, whisker);
      head.add(whiskerTube);
    }
  }

  // Ears on pivots at their base.
  const ears = [];
  for (const side of [-1, 1]) {
    const base = new THREE.Group();
    base.position.set(side * 0.5, 0.98, -0.02);
    const outer = ellipsoid([0.23, 0.25, 0.11], fur, 48);
    outer.position.set(0, 0.15, 0);
    base.add(outer);
    const inner = ellipsoid([0.15, 0.17, 0.05], pink, 32);
    inner.position.set(0, 0.15, 0.07);
    base.add(inner);
    head.add(base);
    ears.push({ base, side });
  }

  shadeByHeight(root, fur, '#D9742A', '#F3A04C');

  const set = (mood) => {
    const closedHappy = mood === 'ecstatic' || mood === 'cheer';
    const closedSleepy = mood === 'sleepy';
    for (const one of eyes) one.visible = !closedHappy && !closedSleepy;
    for (const one of happyEyes) one.visible = closedHappy;
    for (const one of sleepyEyes) one.visible = closedSleepy;
    for (const { brow } of brows) brow.visible = mood === 'sad';
    mouths.smile.visible = mood === 'happy';
    mouths.frown.visible = mood === 'sad';
    mouths.small.visible = mood === 'sleepy';
    mouths.open.visible = mood === 'hungry';
    mouths.joy.visible = mood === 'ecstatic' || mood === 'cheer';
    drool.visible = mood === 'hungry';
    tear.visible = mood === 'sad';
    teeth.visible = mood === 'happy';
  };

  /**
   * Poses the hamster for `mood` at `t` (0 to 1, one loop). The right paw (the viewer's right)
   * holds Habi's item and the top of the head wears its hat, so neither moves much: turning the
   * head (yaw) keeps its top in place.
   */
  const pose = (mood, t) => {
    set(mood);
    const breathe = { happy: 0.018, ecstatic: 0.028, sleepy: 0.034, hungry: 0.02, sad: 0.016, cheer: 0.026 }[mood] ?? 0.02;
    const breaths = { ecstatic: 2, cheer: 2 }[mood] ?? 1;
    const inhale = wave(t, breaths);
    root.scale.set(1 + breathe * 0.4 * inhale, 1 + breathe * inhale, 1 + breathe * 0.4 * inhale);
    root.rotation.set(0, 0, 0);
    head.rotation.set(0, 0, 0);
    let blink = 0;
    let eyeOpen = 1;
    // Per ear: [left, right] tilt, and how far both droop.
    let earTilt = [0, 0];
    let earDroop = 0;
    // Left arm (waves): raise, swing, reach forward. Right arm (holds): raise.
    let leftUp = 0.2;
    let leftSwing = 0;
    let leftForward = 0;
    let rightUp = 0;
    switch (mood) {
      case 'happy':
        head.rotation.y = 0.15 * wave(t, 1);
        head.rotation.z = -0.03 * wave(t, 1);
        blink = blinkAt(t, 0.78);
        // One ear flicks now and then.
        earTilt = [0.22 * blinkAt(t, 0.18, 0.08), -0.22 * blinkAt(t, 0.52, 0.08)];
        leftUp = 0.28 + 0.12 * wave(t, 2);
        break;
      case 'ecstatic':
        head.rotation.y = 0.08 * wave(t, 1);
        head.rotation.z = 0.07 * wave(t, 2);
        earTilt = [0.16 * wave(t, 2, 0.25), -0.16 * wave(t, 2, 0.25)];
        leftUp = 2.05 + 0.3 * wave(t, 2);
        leftSwing = 0.35 * wave(t, 2);
        rightUp = 0.35 + 0.08 * wave(t, 2, 0.5);
        break;
      case 'cheer':
        // A happy wiggle: the whole body turns a little each way while the left paw waves.
        root.rotation.y = 0.14 * wave(t, 1);
        head.rotation.z = 0.06 * wave(t, 2);
        earTilt = [0.2 * wave(t, 2, 0.25), -0.2 * wave(t, 2, 0.25)];
        leftUp = 2.2;
        leftSwing = 0.55 * wave(t, 3);
        rightUp = 0.3;
        break;
      case 'sleepy':
        head.rotation.x = 0.1 + 0.07 * wave(t, 1, 0.25);
        head.rotation.z = 0.06 * wave(t, 1);
        earDroop = 0.28;
        leftUp = 0.08;
        break;
      case 'hungry':
        head.rotation.y = 0.1 * wave(t, 1);
        head.rotation.x = -0.1;
        head.rotation.z = 0.05 + 0.03 * wave(t, 1);
        blink = blinkAt(t, 0.58);
        eyeOpen = 1.08;
        earTilt = [0.08 * wave(t, 2), -0.08 * wave(t, 2)];
        // Rubs its tummy.
        leftUp = -0.55;
        leftForward = 0.75;
        leftSwing = 0.2 * wave(t, 2);
        drool.scale.set(0.03, 0.045 * (0.85 + 0.25 * (0.5 + 0.5 * wave(t, 1))), 0.03);
        break;
      case 'sad':
        head.rotation.x = 0.17 + 0.03 * wave(t, 1);
        head.rotation.y = 0.06 * wave(t, 1, 0.25);
        earDroop = 0.78;
        blink = blinkAt(t, 0.62, 0.1);
        eyeOpen = 0.8;
        leftUp = 0.02;
        tear.scale.set(0.035, 0.05 * (0.92 + 0.08 * wave(t, 1)), 0.03);
        break;
      default:
        break;
    }
    for (const one of eyes) one.scale.set(1, Math.max(0.08, eyeOpen * (1 - blink)), 1);
    ears.forEach(({ base, side }, index) => {
      base.rotation.set(-earDroop * 0.5, 0, side * (-0.42 - earDroop * 0.9) + earTilt[index]);
    });
    for (const { brow, side } of brows) {
      // Worried: the inner ends go up.
      brow.rotation.z = side * -0.45;
      brow.position.y = 0.8;
    }
    arms.left.rotation.set(-0.35 - leftUp * 0.2 - leftForward, 0, -0.35 - leftUp + leftSwing * 0.5);
    arms.right.rotation.set(-0.75 - rightUp * 0.2, 0, 0.32 + rightUp);
  };

  return { root, pose };
}

/** A square stage that renders Habi on a transparent background with a soft shadow. */
export function createStage(canvas, size) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(size, size, false);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 0.92;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.6;

  const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 50);
  camera.position.set(0, 1.55, 7.2);
  camera.lookAt(0, 1.1, 0);

  const key = new THREE.DirectionalLight('#FFF1E2', 2.3);
  key.position.set(1.2, 5.4, 3.8);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -2.2, right: 2.2, top: 3, bottom: -1, near: 0.5, far: 14 });
  key.shadow.radius = 14;
  key.shadow.blurSamples = 16;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  scene.add(key);
  const rim = new THREE.DirectionalLight('#D6E6FF', 1.7);
  rim.position.set(-3.2, 2.6, -3);
  scene.add(rim);
  const back = new THREE.DirectionalLight('#FFE3C8', 0.9);
  back.position.set(3, 1.5, -3.5);
  scene.add(back);
  scene.add(new THREE.HemisphereLight('#FFF7EE', '#8C6B58', 0.55));

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.ShadowMaterial({ opacity: 0.1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const contact = new THREE.Mesh(
    new THREE.PlaneGeometry(2.1, 1.3),
    new THREE.MeshBasicMaterial({ map: contactShadowTexture(), transparent: true, depthWrite: false, toneMapped: false }),
  );
  contact.rotation.x = -Math.PI / 2;
  contact.position.set(0, 0.003, 0.12);
  scene.add(contact);

  const hamster = buildHamster();
  scene.add(hamster.root);

  return {
    render(mood, t) {
      hamster.pose(mood, t);
      renderer.render(scene, camera);
    },
  };
}
