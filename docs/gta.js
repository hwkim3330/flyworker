/**
 * 초파리 직원 — GTA1 근무지 (Carnage3D, MIT)
 *
 * codenamecpp/carnage3d 의 Emscripten 빌드를 그대로 쓴다.
 * doom.wasm 처럼 얇은 인터페이스가 없으므로 두 가지 우회가 필요하다.
 *
 *  1) 입력 — SDL2(Emscripten)는 document 에서 키 이벤트를 듣는다.
 *     합성 KeyboardEvent 를 쏘면 게임이 사람 입력과 구분하지 못한다.
 *  2) 화면 — WebGL 캔버스는 기본적으로 그린 뒤 버퍼를 버려서 읽을 수 없다.
 *     모듈이 컨텍스트를 만들기 전에 getContext 를 가로채 preserveDrawingBuffer 를 켠다.
 */

const GTA_DIR = "data/gta/";

/** 모듈이 WebGL 컨텍스트를 만들 때 프레임버퍼를 보존하도록 한 번만 가로챈다 */
let patched = false;
function patchGetContext() {
  if (patched) return;
  patched = true;
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    if (typeof type === "string" && type.indexOf("webgl") === 0)
      attrs = Object.assign({}, attrs, { preserveDrawingBuffer: true });
    return orig.call(this, type, attrs);
  };
}

// GTA1 조작 — 방향키로 운전/보행, 엔터로 탑승
const KEYS = {
  up:    { key: "ArrowUp",    code: "ArrowUp",    keyCode: 38 },
  down:  { key: "ArrowDown",  code: "ArrowDown",  keyCode: 40 },
  left:  { key: "ArrowLeft",  code: "ArrowLeft",  keyCode: 37 },
  right: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  enter: { key: "Enter",      code: "Enter",      keyCode: 13 },
  space: { key: " ",          code: "Space",      keyCode: 32 },
  // C 는 Carnage3D 의 디버그 창(Game Cheats) 토글이다. 기본값이 '켜짐'이라 한 번 꺼준다.
  // ESC 는 게임을 종료시키므로 절대 보내지 않는다.
  c:     { key: "c",          code: "KeyC",       keyCode: 67 },
};

export class Gta {
  constructor(canvas) {
    this.canvas = canvas;
    this.ready = false;
    this.down = new Set();
    this.frame = 0;
    this.boot = 0;
    this.byHuman = false;
    this.scratch = document.createElement("canvas");
    this.sctx = this.scratch.getContext("2d", { willReadFrequently: true });
  }

  load(baseUrl) {
    patchGetContext();
    const canvas = this.canvas;
    // 모듈이 컨텍스트를 만드는 동안 캔버스가 화면에 있어야 한다.
    // display:none 상태에서 만들면 WebGL 초기화가 실패하거나 프레임을 읽을 수 없다.
    canvas.classList.add("showing");
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("GTA 로딩 시간 초과")), 90000);
      window.Module = {
        canvas,
        locateFile: (p) => baseUrl + GTA_DIR + p,
        print: () => {},
        printErr: (t) => { if (/error|fail/i.test(String(t))) console.warn("[gta]", t); },
        onRuntimeInitialized: () => {
          clearTimeout(timer);
          this.ready = true;
          this.startedAt = performance.now();
          resolve(this);
        },
        setStatus: (t) => { this.status = t; },
      };
      const s = document.createElement("script");
      s.src = baseUrl + GTA_DIR + "carnage3D.js";
      s.onerror = () => { clearTimeout(timer); reject(new Error("carnage3D.js 로드 실패")); };
      document.body.appendChild(s);
    });
  }

  /** 합성 키 이벤트 — SDL2 는 사람 입력과 구분하지 못한다 */
  hold(name, on) {
    const k = KEYS[name];
    if (!k) return;
    const isDown = this.down.has(name);
    if (on === isDown) return;
    if (on) this.down.add(name); else this.down.delete(name);
    const ev = new KeyboardEvent(on ? "keydown" : "keyup", {
      key: k.key, code: k.code, keyCode: k.keyCode, which: k.keyCode,
      bubbles: true, cancelable: true,
    });
    document.dispatchEvent(ev);
    this.canvas.dispatchEvent(ev);
  }

  /**
   * 조종.
   * 사람 모드면 합성 키를 전혀 쏘지 않는다. 실제 키보드는 어차피 document 로
   * 들어가므로, 우리가 비켜주기만 하면 사람이 그대로 플레이할 수 있다.
   */
  drive(steer, thrust) {
    this.frame++;

    // 메뉴를 통과시킨다. GTA1 은 로고·메뉴를 거쳐야 게임에 들어간다.
    if (this.boot < 600) {
      this.boot++;
      const t = this.boot % 40;
      if (t === 0) this.hold("enter", true);
      else if (t === 6) this.hold("enter", false);
      else if (t === 20) this.hold("space", true);
      else if (t === 26) this.hold("space", false);
      return;
    }
    // 부팅이 끝나면 디버그 창을 한 번 끈다 (기본값이 켜짐이라 화면을 가린다)
    if (this.boot === 600) {
      this.boot++;
      this.hold("c", true);
      setTimeout(() => this.hold("c", false), 60);
      return;
    }

    if (this.byHuman) { this.releaseAll(); return; }

    this.hold("left", steer < -0.18);
    this.hold("right", steer > 0.18);
    this.hold("up", thrust > 0.4);
    this.hold("enter", this.frame % 240 < 8);   // 가끔 차를 타고 내린다
  }

  /** 부팅 단계를 건너뛴다 (사람이 직접 시작하고 싶을 때) */
  skipBoot() { this.boot = 600; this.releaseAll(); }

  /** 화면을 작은 캔버스로 줄여 밝기 격자를 만든다 */
  vision(gw, gh, out, normalize) {
    const c = this.canvas;
    if (!c.width || !c.height) { out.fill(0.4); return out; }
    if (this.scratch.width !== gw || this.scratch.height !== gh) {
      this.scratch.width = gw; this.scratch.height = gh;
    }
    try {
      this.sctx.drawImage(c, 0, 0, gw, gh);
    } catch { out.fill(0.4); return out; }
    const d = this.sctx.getImageData(0, 0, gw, gh).data;
    for (let i = 0; i < gw * gh; i++)
      out[i] = (d[4 * i] * 0.3 + d[4 * i + 1] * 0.59 + d[4 * i + 2] * 0.11) / 255;
    if (normalize) normalize(out, gw, gh);
    return out;
  }

  /** 화면 해시 — 정지·반복 감지용 */
  screenHash(gw = 24, gh = 16) {
    if (this.scratch.width !== gw || this.scratch.height !== gh) {
      this.scratch.width = gw; this.scratch.height = gh;
    }
    try { this.sctx.drawImage(this.canvas, 0, 0, gw, gh); } catch { return 0; }
    const d = this.sctx.getImageData(0, 0, gw, gh).data;
    let h = 2166136261;
    for (let i = 0; i < d.length; i += 7) { h ^= d[i]; h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  releaseAll() { for (const k of [...this.down]) this.hold(k, false); }
}
