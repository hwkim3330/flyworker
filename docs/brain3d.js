/**
 * 초파리 직원 — 3D 뇌
 *
 * 뉴런 138,639개를 실제 해부학적 좌표에 찍고, 발화하는 만큼 밝힌다.
 * 자극을 주면 신호가 시각엽(양옆)에서 중앙뇌를 거쳐 하행뉴런(아래)으로
 * 퍼져나가는 것이 보인다. 잘린 뉴런은 붉게 죽는다.
 *
 * 좌표 출처: FlyWire v783 뉴런 주석 (CC-BY 4.0)
 */
const THREE_URL = "https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js";

// 계통별 색 — 0 시각엽 1 중앙 2 감각 3 하행 4 시각투사 5 기타
const GROUP_COLOR = [
  [0.34, 0.72, 1.00],   // 시각엽   파랑
  [0.62, 0.64, 0.72],   // 중앙뇌   회색
  [1.00, 0.82, 0.32],   // 감각     노랑
  [0.34, 0.95, 0.58],   // 하행     초록
  [0.76, 0.48, 1.00],   // 시각투사 보라
  [0.42, 0.42, 0.48],   // 기타
];

export class Brain3D {
  constructor(canvas) { this.canvas = canvas; this.ready = false; }

  async load(posUrl) {
    const THREE = await import(THREE_URL);
    this.THREE = THREE;

    const buf = await (await fetch(posUrl)).arrayBuffer();
    const u8 = new Uint8Array(buf);
    if (String.fromCharCode(u8[0], u8[1], u8[2], u8[3]) !== "FPOS")
      throw new Error("좌표 파일 형식이 아닙니다");
    const dv = new DataView(buf);
    const N = dv.getUint32(4, true);
    this.N = N;
    const q = new Int16Array(buf, 8, N * 3);
    this.group = new Uint8Array(buf, 8 + N * 6, N);

    // 위치 + 기본색
    const pos = new Float32Array(N * 3);
    const base = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[3 * i] = q[3 * i] / 32767 * 1.6;
      pos[3 * i + 1] = -q[3 * i + 1] / 32767 * 1.6;   // 화면 좌표계에 맞춰 뒤집는다
      pos[3 * i + 2] = q[3 * i + 2] / 32767 * 1.6;
      const c = GROUP_COLOR[this.group[i]] || GROUP_COLOR[5];
      base[3 * i] = c[0]; base[3 * i + 1] = c[1]; base[3 * i + 2] = c[2];
    }
    this.act = new Float32Array(N);        // 0~1 활동도
    this.cut = new Float32Array(N);        // 1이면 잘림

    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("baseColor", new THREE.BufferAttribute(base, 3));
    g.setAttribute("act", new THREE.BufferAttribute(this.act, 1));
    g.setAttribute("cut", new THREE.BufferAttribute(this.cut, 1));
    this.geo = g;

    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uSize: { value: 2.4 }, uH: { value: 800 } },
      vertexShader: `
        attribute vec3 baseColor; attribute float act; attribute float cut;
        varying vec3 vCol; varying float vA;
        uniform float uSize; uniform float uH;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float a = act;
          vCol = mix(baseColor, vec3(1.0, 0.96, 0.80), a * 0.85);
          vCol = mix(vCol, vec3(1.0, 0.30, 0.28), cut);          // 잘린 뉴런은 붉게
          // 13만 점을 가산 혼합으로 겹치면 금세 흰색으로 포화된다.
          // 기본 알파를 아주 낮게 두고, 발화한 점만 도드라지게 한다.
          vA = mix(0.085, 0.95, a) * mix(1.0, 0.55, cut);
          // 점 크기는 캔버스 높이에 비례해야 한다. 상수로 두면 큰 화면에서 화면을 덮는다.
          gl_PointSize = uSize * (1.0 + a * 2.2) * (uH / 800.0) * (3.6 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying vec3 vCol; varying float vA;
        void main() {
          vec2 d = gl_PointCoord - vec2(0.5);
          float r = dot(d, d);
          if (r > 0.25) discard;
          gl_FragColor = vec4(vCol, vA * (1.0 - r * 3.6));
        }`,
    });

    this.scene = new THREE.Scene();
    this.points = new THREE.Points(g, mat);
    this.scene.add(this.points);

    this.cam = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    this.cam.position.set(0, 0, 4.6);
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas, antialias: false, alpha: false,
      powerPreference: "high-performance",
    });
    // 138,639점을 가산 혼합으로 그린다. 픽셀비를 올리면 오버드로가 그대로 배가된다.
    this.renderer.setPixelRatio(1);

    // 소프트웨어 렌더링이면(스위프트셰이더/llvmpipe) 점을 솎아내지 않으면 못 쓴다.
    const dbg = this.renderer.getContext().getExtension("WEBGL_debug_renderer_info");
    const gpu = dbg ? String(this.renderer.getContext().getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : "";
    this.software = /swiftshader|llvmpipe|software/i.test(gpu);
    if (this.software) g.setDrawRange(0, Math.min(N, 24000));   // 솎아낸다
    this.gpuName = gpu;

    this.renderer.setClearColor(0x000000, 1);   // 투명 대신 검정으로 지운다
    this.resize();
    // 레이아웃이 잡힌 뒤 한 번 더 맞춘다
    requestAnimationFrame(() => this.resize());
    this.ready = true;
    this.spin = true;
    this.dirty = true;
    this.lastDraw = 0;
    this.fpsCap = this.software ? 12 : 30;   // 게임 루프와 분리해 상한을 둔다
    return this;
  }

  resize() {
    // 레이아웃 전에 호출되면 0이 나온다. 그대로 두면 캔버스가 비어 흰 사각형이 된다.
    const r = this.canvas.getBoundingClientRect();
    const w = Math.max(64, r.width | 0), h = Math.max(64, r.height | 0);
    this.renderer.setSize(w, h, false);
    if (this.points) this.points.material.uniforms.uH.value = h;
    this.cam.aspect = w / h;
    this.cam.updateProjectionMatrix();
  }

  /** 워커가 보낸 활동도(uint8)를 반영한다. 업로드는 렌더 시점에 한 번만 한다. */
  setActivity(u8) {
    const a = this.act, n = Math.min(a.length, u8.length);
    for (let i = 0; i < n; i++) a[i] = u8[i] / 255;
    this.dirty = true;
  }

  setCut(indices, on) {
    const c = this.cut;
    if (indices === "all") c.fill(0);
    else for (const i of indices) c[i] = on ? 1 : 0;
    this.geo.attributes.cut.needsUpdate = true;
  }

  /**
   * 게임 루프와 분리해 스스로 속도를 제한한다.
   *
   * 138,639개 실수(554KB)를 매 프레임 올리면 초당 33MB가 되고,
   * 소프트웨어 렌더링 환경에서는 전체 프레임률이 60fps → 1fps 로 무너진다.
   * 활동도가 바뀐 경우에만 올리고, 그리는 횟수에도 상한을 둔다.
   */
  render(nowMs) {
    if (!this.ready) return false;
    const interval = 1000 / this.fpsCap;
    if (nowMs - this.lastDraw < interval) return false;
    const dt = Math.min(0.2, (nowMs - this.lastDraw) / 1000);
    this.lastDraw = nowMs;

    if (this.spin) this.points.rotation.y += dt * 0.22;
    if (this.dirty) {
      const a = this.act;
      for (let i = 0; i < a.length; i++) a[i] *= 0.82;   // 갱신 주기에 맞춰 더 빠르게 잦아든다
      this.geo.attributes.act.needsUpdate = true;
      this.dirty = false;
    }
    this.renderer.render(this.scene, this.cam);
    return true;
  }
}
