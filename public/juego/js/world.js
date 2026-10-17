// ============================================================
// MUNDO — la arena. Todo se genera con código: no hay texturas
// ni modelos descargados. Devuelve la lista de colisiones (Box3),
// los sitios donde aparecen los bots y dónde nace el jugador.
// ============================================================

import * as THREE from "../vendor/three.module.js";

export const ARENA = 46; // mitad del lado de la arena

// ---------- Texturas procedurales ----------

function groundTexture() {
  const c = document.createElement("canvas");
  c.width = 512; c.height = 512;
  const g = c.getContext("2d");
  g.fillStyle = "#4a463f";
  g.fillRect(0, 0, 512, 512);
  // manchas de asfalto gastado
  for (let i = 0; i < 2600; i += 1) {
    const r = 1 + Math.random() * 5;
    const shade = Math.random() < 0.5 ? 0 : 255;
    g.fillStyle = `rgba(${shade},${shade},${shade},${0.02 + Math.random() * 0.05})`;
    g.beginPath();
    g.arc(Math.random() * 512, Math.random() * 512, r, 0, Math.PI * 2);
    g.fill();
  }
  // rejilla de hormigón
  g.strokeStyle = "rgba(0,0,0,0.22)";
  g.lineWidth = 3;
  for (let i = 0; i <= 4; i += 1) {
    const p = (i * 512) / 4;
    g.beginPath(); g.moveTo(p, 0); g.lineTo(p, 512); g.stroke();
    g.beginPath(); g.moveTo(0, p); g.lineTo(512, p); g.stroke();
  }
  // línea amarilla discontinua (carretera)
  g.strokeStyle = "rgba(255,199,0,0.35)";
  g.lineWidth = 8;
  g.setLineDash([34, 26]);
  g.beginPath(); g.moveTo(256, 0); g.lineTo(256, 512); g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(14, 14);
  tex.anisotropy = 4;
  return tex;
}

function skyTexture() {
  const c = document.createElement("canvas");
  c.width = 32; c.height = 256;
  const g = c.getContext("2d");
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, "#12447f");
  grad.addColorStop(0.45, "#4d90cf");
  grad.addColorStop(0.76, "#a9cfe8");
  grad.addColorStop(0.92, "#ffd9a8");
  grad.addColorStop(1, "#ffb268");
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function containerTexture(color) {
  const c = document.createElement("canvas");
  c.width = 128; c.height = 128;
  const g = c.getContext("2d");
  g.fillStyle = color;
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = "rgba(0,0,0,0.22)";
  for (let x = 0; x < 128; x += 10) g.fillRect(x, 0, 4, 128);
  g.fillStyle = "rgba(255,255,255,0.07)";
  for (let y = 0; y < 128; y += 16) g.fillRect(0, y, 128, 2);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// ---------- Constructor ----------

export function createWorld(scene, quality = "high") {
  const colliders = [];   // Box3 para chocar
  const solids = [];      // meshes para rayos (balas)
  const spawnPoints = []; // sitios de aparición de bots

  const lowQ = quality === "low";

  // ---- Cielo, niebla y luces ----
  scene.background = skyTexture();
  scene.fog = new THREE.Fog(0xbcd6ea, 45, 145);

  const hemi = new THREE.HemisphereLight(0xbfe0ff, 0x53483a, 0.75);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff2da, 1.5);
  sun.position.set(48, 70, 26);
  sun.castShadow = true;
  sun.shadow.mapSize.set(lowQ ? 1024 : 2048, lowQ ? 1024 : 2048);
  sun.shadow.camera.left = -58;
  sun.shadow.camera.right = 58;
  sun.shadow.camera.top = 58;
  sun.shadow.camera.bottom = -58;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 190;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.03;
  scene.add(sun);
  scene.add(sun.target);

  scene.add(new THREE.AmbientLight(0xffffff, 0.16));

  // ---- Materiales ----
  const mats = {
    ground: new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 0.96, metalness: 0 }),
    wall: new THREE.MeshStandardMaterial({ color: 0xbfae94, roughness: 0.9 }),
    wallDark: new THREE.MeshStandardMaterial({ color: 0x7d6f5c, roughness: 0.92 }),
    roof: new THREE.MeshStandardMaterial({ color: 0x8a8478, roughness: 0.85 }),
    crate: new THREE.MeshStandardMaterial({ color: 0xa9793f, roughness: 0.85 }),
    crateTop: new THREE.MeshStandardMaterial({ color: 0x8a5f2c, roughness: 0.85 }),
    concrete: new THREE.MeshStandardMaterial({ color: 0x9a958c, roughness: 0.94 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x6f7681, roughness: 0.45, metalness: 0.75 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x2f333b, roughness: 0.6, metalness: 0.35 }),
    neon: new THREE.MeshStandardMaterial({ color: 0xff7b00, emissive: 0xff7b00, emissiveIntensity: 1.1, roughness: 0.5 }),
    neonCyan: new THREE.MeshStandardMaterial({ color: 0x2ad4ff, emissive: 0x18b8ff, emissiveIntensity: 0.9, roughness: 0.5 }),
  };
  const containerMats = [
    new THREE.MeshStandardMaterial({ map: containerTexture("#c0392b"), roughness: 0.75, metalness: 0.25 }),
    new THREE.MeshStandardMaterial({ map: containerTexture("#2e7d5b"), roughness: 0.75, metalness: 0.25 }),
    new THREE.MeshStandardMaterial({ map: containerTexture("#2b5f9e"), roughness: 0.75, metalness: 0.25 }),
    new THREE.MeshStandardMaterial({ map: containerTexture("#b8791f"), roughness: 0.75, metalness: 0.25 }),
  ];

  // ---- Suelo (recibe sombras) ----
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(ARENA * 2 + 60, ARENA * 2 + 60),
    mats.ground,
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  solids.push(ground);
  // El suelo también tiene que estar en la lista de choques: si no, el
  // jugador y los bots atraviesan el mapa y caen al vacío.
  colliders.push(new THREE.Box3(
    new THREE.Vector3(-260, -3, -260),
    new THREE.Vector3(260, 0, 260),
  ));

  // ---- Utilidades ----
  const box = (x, y, z, w, h, d, material, opts = {}) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y + h / 2, z); // y = base
    mesh.castShadow = opts.noShadow ? false : !lowQ;
    mesh.receiveShadow = true;
    scene.add(mesh);
    if (opts.collide !== false) {
      colliders.push(new THREE.Box3().setFromCenterAndSize(
        new THREE.Vector3(x, y + h / 2, z),
        new THREE.Vector3(w, h, d),
      ));
    }
    if (opts.raycast !== false) solids.push(mesh);
    return mesh;
  };

  // ---- Muros perimetrales ----
  const H = 7;
  box(-ARENA, 0, 0, 2, H, ARENA * 2 + 4, mats.wallDark);
  box(ARENA, 0, 0, 2, H, ARENA * 2 + 4, mats.wallDark);
  box(0, 0, -ARENA, ARENA * 2, H, 2, mats.wallDark);
  box(0, 0, ARENA, ARENA * 2, H, 2, mats.wallDark);

  // ---- Edificio con puerta (muros + techo + hueco de entrada) ----
  function building(cx, cz, w, d, h, door) {
    const t = 0.5; // grosor de pared
    const halfW = w / 2;
    const halfD = d / 2;
    const mat = mats.wall;
    const gap = 3.4; // ancho de la puerta

    const wallX = (x, z, len) => box(x, 0, z, t, h, len, mat);
    const wallZ = (x, z, len) => box(x, 0, z, len, h, t, mat);

    // paredes norte / sur
    for (const zSide of [-halfD, halfD]) {
      const side = zSide < 0 ? "n" : "s";
      const cut = door === side;
      if (cut) {
        const seg = (w - gap) / 2;
        wallZ(cx - gap / 2 - seg / 2, cz + zSide, seg);
        wallZ(cx + gap / 2 + seg / 2, cz + zSide, seg);
      } else {
        wallZ(cx, cz + zSide, w);
      }
    }
    // paredes este / oeste
    for (const xSide of [-halfW, halfW]) {
      const side = xSide < 0 ? "w" : "e";
      const cut = door === side;
      if (cut) {
        const seg = (d - gap) / 2;
        wallX(cx + xSide, cz - gap / 2 - seg / 2, seg);
        wallX(cx + xSide, cz + gap / 2 + seg / 2, seg);
      } else {
        wallX(cx + xSide, cz, d);
      }
    }
    // techo (no se puede subir por dentro: es techo, no suelo)
    box(cx, h, cz, w + 0.6, 0.4, d + 0.6, mats.roof);
    // franja naranja de marca
    box(cx, h - 0.6, cz, w + 0.7, 0.18, d + 0.7, mats.neon, { collide: false, noShadow: true });
    // cajas de cobertura dentro
    box(cx - halfW * 0.45, 0, cz - halfD * 0.35, 1.3, 1.3, 1.3, mats.crate);
    box(cx + halfW * 0.5, 0, cz + halfD * 0.4, 1.3, 2.6, 1.3, mats.crate);
  }

  building(-19, -21, 17, 13, 4.4, "s");
  building(21, -17, 15, 15, 5.0, "w");
  building(23, 20, 13, 11, 4.0, "n");
  building(-21, 18, 14, 12, 4.6, "e");

  // ---- Escalera de cajas a un techo (verticalidad) ----
  function crateStairs(x, z, steps, dirX, dirZ) {
    for (let i = 0; i < steps; i += 1) {
      const h = 0.62 * (i + 1);
      const px = x + dirX * i * 1.5;
      const pz = z + dirZ * i * 1.5;
      box(px, 0, pz, 1.6, h, 1.6, i % 2 ? mats.crate : mats.crateTop);
    }
  }
  crateStairs(-19, -38, 9, 0, 1);
  crateStairs(39, -17, 10, -1, 0);

  // ---- Plaza central elevada con escalones ----
  box(0, 0, 0, 12, 0.45, 12, mats.concrete);
  for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
    for (let i = 0; i < 3; i += 1) {
      const off = 6.6 + i * 0.9;
      box(dx * off, 0, dz * off, dx ? 0.9 : 5, 0.15 * (3 - i), dz ? 0.9 : 5, mats.concrete);
    }
  }
  // pilares decorativos de la plaza
  for (const [px, pz] of [[-5, -5], [5, -5], [-5, 5], [5, 5]]) {
    box(px, 0.45, pz, 0.7, 3.2, 0.7, mats.concrete);
    box(px, 3.65, pz, 0.9, 0.25, 0.9, mats.neon, { collide: false });
  }

  // ---- Contenedores ----
  const containers = [
    [-33, 4, 6.2, 2.7, 2.7, 0],
    [-31, 11, 6.2, 2.7, 2.7, 0],
    [33, 6, 2.7, 2.7, 6.2, 0],
    [30, 14, 6.2, 2.7, 2.7, 0],
    [-10, -31, 6.2, 2.7, 2.7, 0],
    [12, 33, 6.2, 2.7, 2.7, 0],
    [-13, 30, 2.7, 2.7, 6.2, 0],
    [9, -34, 6.2, 2.7, 2.7, 0],
  ];
  containers.forEach(([x, z, w, h, d, ci], i) => {
    box(x, 0, z, w, h, d, containerMats[(ci + i) % containerMats.length]);
  });
  // contenedores apilados
  box(-33, 2.7, 4, 6.2, 2.7, 2.7, containerMats[2]);
  box(33, 2.7, 6, 2.7, 2.7, 6.2, containerMats[0]);

  // ---- Barreras de hormigón (cobertura baja) ----
  const barriers = [
    [-7, -14, 0, 7.5, 1.1, 0.8], [7, -14, 0, 7.5, 1.1, 0.8],
    [-7, 14, 0, 7.5, 1.1, 0.8], [7, 14, 0, 7.5, 1.1, 0.8],
    [-24, -4, Math.PI / 2, 9, 1.1, 0.8], [24, 4, Math.PI / 2, 9, 1.1, 0.8],
    [-14, 24, Math.PI / 4, 6, 1.1, 0.8], [16, -24, Math.PI / 4, 6, 1.1, 0.8],
    [0, -26, 0, 9, 1.3, 0.8], [0, 26, 0, 9, 1.3, 0.8],
  ];
  for (const [x, z, rot, w, h, d] of barriers) {
    const mesh = box(x, 0, z, w, h, d, mats.concrete);
    if (rot) {
      mesh.rotation.y = rot;
      // la colisión se rehace con la caja girada aproximada
      const box3 = colliders[colliders.length - 1];
      const hw = rot === Math.PI / 2 ? d / 2 : w / 2;
      const hd = rot === Math.PI / 2 ? w / 2 : d / 2;
      box3.setFromCenterAndSize(new THREE.Vector3(x, h / 2, z), new THREE.Vector3(hw * 2, h, hd * 2));
    }
  }

  // ---- Torres de vigilancia ----
  function tower(x, z) {
    box(x, 0, z, 4.4, 4.4, 4.4, mats.wallDark);          // base hueca por fuera se ve maciza
    box(x, 4.4, z, 6.4, 0.5, 6.4, mats.metal);           // plataforma
    box(x, 0, z - 3.4, 0.4, 5.4, 0.4, mats.metal);       // poste
    box(x, 0, z + 3.4, 0.4, 5.4, 0.4, mats.metal);
    box(x, 5.6, z, 6.6, 0.9, 0.35, mats.concrete);       // barandilla
    box(x, 5.6, z - 3.3, 6.6, 0.9, 0.35, mats.concrete);
    for (let i = 0; i < 8; i += 1) {
      box(x - 6 + i * 1.6, 0, z - 8.4 + i * 1.2, 1.5, 0.55 * (i + 1), 1.5, mats.crate);
    }
  }
  tower(-30, -32);
  tower(31, 31);

  // ---- Detalles: barriles, neones y vallas ----
  const barrelGeo = new THREE.CylinderGeometry(0.55, 0.55, 1.15, 10);
  const barrelMat = new THREE.MeshStandardMaterial({ color: 0xa5432f, roughness: 0.7, metalness: 0.3 });
  for (const [x, z] of [[-6, 30], [7, 30], [-28, 24], [27, -28], [-35, -14], [35, 22], [2, -40], [-2, 40]]) {
    const m = new THREE.Mesh(barrelGeo, barrelMat);
    m.position.set(x, 0.575, z);
    m.castShadow = !lowQ;
    m.receiveShadow = true;
    scene.add(m);
    colliders.push(new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(x, 0.575, z), new THREE.Vector3(1.1, 1.15, 1.1)));
    solids.push(m);
  }

  for (let i = 0; i < 16; i += 1) {
    const a = (i / 16) * Math.PI * 2;
    const x = Math.cos(a) * 43.6;
    const z = Math.sin(a) * 43.6;
    box(x, 0, z, 0.35, 5.2, 0.35, mats.metal, { collide: false });
    box(x, 5.2, z, 0.7, 0.22, 0.7, i % 2 ? mats.neon : mats.neonCyan, { collide: false });
  }

  // ---- Puntos de aparición de bots (lejos del centro) ----
  const ring = [
    [-38, 0], [38, 0], [0, -38], [0, 38],
    [-30, -12], [30, 12], [-12, 30], [12, -30],
    [-34, 20], [34, -20], [20, 34], [-20, -34],
    [-42, -30], [42, 30], [30, -42], [-30, 42],
  ];
  for (const [x, z] of ring) spawnPoints.push(new THREE.Vector3(x, 0, z));

  return {
    colliders,
    solids,
    spawnPoints,
    playerSpawn: new THREE.Vector3(0, 0, 17),
    sun,
    materials: mats,
  };
}
