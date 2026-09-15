/**
 * 초파리 직원 — 둠 근무지
 *
 * jacobenget/doom.wasm 을 쓴다. import 10개 / export 4개뿐인 아주 얇은 인터페이스라
 * 프레임버퍼를 직접 읽고 키를 직접 주입할 수 있다.
 * 셰어웨어 WAD가 모듈 안에 들어 있어 별도 파일이 필요 없다.
 *
 * 우리 테스트 게임과 달리 둠에는 심어둔 버그가 없다. 둠을 붙이는 이유는
 * "자기가 만든 장난감에서만 되는 것 아니냐"에 답하기 위해서다.
 */

import { normalizeField } from "./vision.js";

const KEYS = ["KEY_LEFTARROW", "KEY_RIGHTARROW", "KEY_UPARROW", "KEY_DOWNARROW",
              "KEY_FIRE", "KEY_USE", "KEY_ENTER", "KEY_ESCAPE",
              "KEY_STRAFE_L", "KEY_STRAFE_R", "KEY_SHIFT", "KEY_TAB"];

export class Doom {
  constructor() {
    this.ready = false;
    this.w = 0; this.h = 0;
    this.fbPtr = 0;
    this.frame = 0;
    this.down = new Set();
    this.key = {};
    this.byHuman = false;
  }

  async load(url) {
    const self0 = this;
    let mem = null;
    const str = (p, n) =>
      new TextDecoder().decode(new Uint8Array(mem.buffer, p, n));

    const imports = {
      loading: {
        onGameInit: (w, h) => {
          self0.w = w; self0.h = h;
          self0.rgba = new Uint8ClampedArray(w * h * 4);
          self0.img = new ImageData(self0.rgba, w, h);
        },
        wadSizes: () => {},      // 비워두면 내장 셰어웨어 WAD를 쓴다
        readWads: () => {},
      },
      ui: { drawFrame: (ptr) => { self0.fbPtr = ptr; self0.frame++; } },
      runtimeControl: { timeInMilliseconds: () => BigInt(Math.trunc(performance.now())) },
      console: {
        onInfoMessage: (p, n) => { self0.lastInfo = str(p, n); },
        onErrorMessage: (p, n) => { console.error("[doom]", str(p, n)); },
      },
      gameSaving: { sizeOfSaveGame: () => 0, readSaveGame: () => 0, writeSaveGame: () => 0 },
    };

    const { instance } = await WebAssembly.instantiateStreaming(fetch(url), imports);
    this.ex = instance.exports;
    mem = this.ex.memory;
    this.mem = mem;
    for (const k of KEYS) this.key[k] = this.ex[k]?.value ?? this.ex[k];
    this.ex.initGame();
    this.ready = true;
    this.bootFrames = 0;
    return this;
  }

  tick() {
    if (!this.ready) return;
    // 시작 메뉴를 넘긴다 (엔터를 몇 번 두드린다)
    if (this.bootFrames < 140) {
      this.bootFrames++;
      if (this.bootFrames % 20 === 0) this.tap("KEY_ENTER");
      if (this.bootFrames % 20 === 10) this.up("KEY_ENTER");
    }
    this.ex.tickGame();
  }

  hold(name, on) {
    const k = this.key[name];
    if (k == null) return;
    if (on && !this.down.has(k)) { this.ex.reportKeyDown(k); this.down.add(k); }
    else if (!on && this.down.has(k)) { this.ex.reportKeyUp(k); this.down.delete(k); }
  }
  tap(name) { this.hold(name, true); }
  up(name) { this.hold(name, false); }

  /** 초파리가 조종한다. 사람 모드면 비켜준다. */
  drive(steer, thrust, fire) {
    if (this.byHuman) { for (const k of [...this.down]) { this.ex.reportKeyUp(k); } this.down.clear(); return; }
    this.hold("KEY_LEFTARROW", steer < -0.18);
    this.hold("KEY_RIGHTARROW", steer > 0.18);
    this.hold("KEY_UPARROW", thrust > 0.45);
    this.hold("KEY_FIRE", !!fire);
    // 가끔 문을 연다 (둠은 USE로 문을 연다)
    if (this.frame % 90 < 6) this.hold("KEY_USE", true); else this.hold("KEY_USE", false);
  }

  /** 프레임버퍼를 캔버스에 그린다 */
  draw(ctx) {
    if (!this.fbPtr || !this.img) return;
    const src = new Uint8Array(this.mem.buffer, this.fbPtr, this.w * this.h * 4);
    const d = this.rgba;
    for (let i = 0, n = this.w * this.h; i < n; i++) {
      d[4 * i] = src[4 * i + 2];      // 둠은 리틀엔디안 BGRA로 저장한다
      d[4 * i + 1] = src[4 * i + 1];
      d[4 * i + 2] = src[4 * i];
      d[4 * i + 3] = 255;
    }
    ctx.putImageData(this.img, 0, 0);
  }

  /**
   * 초파리 눈에 넣을 밝기 격자.
   * 둠 화면은 이미 1인칭이라 레이캐스팅이 필요 없다. 다만 아래쪽 상태바는 뺀다.
   */
  vision(gw, gh, out) {
    if (!this.fbPtr) { out.fill(0.2); return out; }
    const src = new Uint8Array(this.mem.buffer, this.fbPtr, this.w * this.h * 4);
    const viewH = Math.floor(this.h * 0.78);          // 상태바 제외
    const cw = this.w / gw, ch = viewH / gh;
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        let s = 0, n = 0;
        const x0 = (gx * cw) | 0, x1 = ((gx + 1) * cw) | 0;
        const y0 = (gy * ch) | 0, y1 = ((gy + 1) * ch) | 0;
        for (let y = y0; y < y1; y += 3) {
          for (let x = x0; x < x1; x += 3) {
            const i = (y * this.w + x) * 4;
            s += src[i + 2] * 0.3 + src[i + 1] * 0.59 + src[i] * 0.11;
            n++;
          }
        }
        out[gy * gw + gx] = n ? s / n / 255 : 0;
      }
    }
    normalizeField(out, gw, gh);
    return out;
  }

  /** 화면 해시 — QA 감지기가 정지·반복을 잡는 데 쓴다 */
  screenHash() {
    if (!this.fbPtr) return 0;
    const src = new Uint8Array(this.mem.buffer, this.fbPtr, this.w * this.h * 4);
    let h = 2166136261;
    for (let i = 0; i < src.length; i += 997) { h ^= src[i]; h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
}
