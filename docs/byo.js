/**
 * 초파리 직원 — 아무 게임이나 붙이기 (Bring your own game)
 *
 * GTA1·둠 근무지는 우리가 미리 붙여둔 것이다. 하지만 이 제품의 주장은
 * "정책이 아니라 프레임워크가 제품"이라는 것이고, 그 주장은 남의 게임에
 * 붙을 수 있어야만 참이다. 그래서 여기가 그 증명이다.
 *
 * 원리는 GTA 어댑터와 같다. 다만 대상이 우리 페이지가 아니라 iframe 이다.
 *
 *  1) 같은 출처 — blob: URL 로 만든 문서는 만든 쪽의 출처를 물려받는다.
 *     그래서 contentDocument 를 읽을 수 있고, 캔버스 픽셀도 읽을 수 있다.
 *     남의 사이트를 그냥 iframe 에 띄우면(cross-origin) 절대 안 되는 일이다.
 *  2) 프레임버퍼 — 게임 스크립트보다 먼저 getContext 를 가로채야 한다.
 *     그래서 HTML 맨 앞에 심(shim)을 끼워 넣고 blob 으로 다시 만든다.
 *  3) 입력 — iframe 의 document/window 로 합성 KeyboardEvent 를 쏜다.
 *
 * 되는 것과 안 되는 것을 숨기지 않는다:
 *  - 자체 완결형 HTML 파일(드래그&드롭): 된다.
 *  - CORS 를 열어둔 URL: 된다 (우리가 받아서 다시 띄운다).
 *  - CORS 를 막은 URL: 안 된다. 브라우저가 우리에게 내용을 주지 않는다.
 *    이때는 "파일을 떨어뜨려 달라"고 정확히 말한다.
 */

/** 게임 스크립트보다 먼저 도는 심 — 프레임버퍼를 보존시킨다 */
const SHIM = `<script>(function(){
  var o=HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext=function(t,a){
    if(typeof t==="string"&&t.indexOf("webgl")===0)
      a=Object.assign({},a,{preserveDrawingBuffer:true});
    return o.call(this,t,a);
  };
})();<\/script>`;

const KEYS = {
  up:    { key: "ArrowUp",    code: "ArrowUp",    keyCode: 38 },
  down:  { key: "ArrowDown",  code: "ArrowDown",  keyCode: 40 },
  left:  { key: "ArrowLeft",  code: "ArrowLeft",  keyCode: 37 },
  right: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  space: { key: " ",          code: "Space",      keyCode: 32 },
  enter: { key: "Enter",      code: "Enter",      keyCode: 13 },
  w:     { key: "w",          code: "KeyW",       keyCode: 87 },
  a:     { key: "a",          code: "KeyA",       keyCode: 65 },
  s:     { key: "s",          code: "KeyS",       keyCode: 83 },
  d:     { key: "d",          code: "KeyD",       keyCode: 68 },
};

/** 심을 HTML 맨 앞(가능하면 <head> 바로 뒤)에 끼워 넣는다 */
function inject(html, baseHref) {
  const base = baseHref ? `<base href="${baseHref}">` : "";
  const head = /<head[^>]*>/i.exec(html);
  if (head) {
    const at = head.index + head[0].length;
    return html.slice(0, at) + base + SHIM + html.slice(at);
  }
  return base + SHIM + html;
}

export class Byo {
  /** @param {HTMLIFrameElement} frame */
  constructor(frame) {
    this.frame = frame;
    this.ready = false;
    this.label = "";
    this.canvas = null;
    this.blobUrl = null;
    this.down = new Set();
    this.frameNo = 0;
    this.byHuman = false;
    this.tainted = false;
    this.source = null;
    this.restarts = 0;
    this.scratch = document.createElement("canvas");
    this.sctx = this.scratch.getContext("2d", { willReadFrequently: true });
  }

  /** 자체 완결형 HTML 텍스트를 띄운다 */
  loadHtml(html, label, baseHref) {
    this.dispose();
    this.source = { html, label, baseHref };
    this.label = label;
    const blob = new Blob([inject(html, baseHref)], { type: "text/html" });
    this.blobUrl = URL.createObjectURL(blob);
    this.frame.src = this.blobUrl;
    return this.waitForCanvas();
  }

  loadFile(file) {
    return file.text().then((t) => this.loadHtml(t, file.name));
  }

  /**
   * URL 에서 받아온다. 막히면 왜 막혔는지 그대로 말한다.
   * (CORS 는 우리가 우회할 수 없다. 우회하는 척하면 거짓말이 된다.)
   */
  async loadUrl(url) {
    let res;
    try {
      res = await fetch(url, { mode: "cors" });
    } catch {
      throw new Error(
        `${new URL(url).host} does not allow other sites to read it (CORS). ` +
        `Nothing can fix that from this side — save the page and drop the file instead.`);
    }
    if (!res.ok) throw new Error(`${url} returned HTTP ${res.status}`);
    const html = await res.text();
    return this.loadHtml(html, new URL(url).pathname.split("/").pop() || url, url);
  }

  /** 게임이 캔버스를 만들 때까지 기다린다 (최대 20초) */
  waitForCanvas() {
    return new Promise((resolve, reject) => {
      const t0 = performance.now();
      const look = () => {
        let doc;
        try { doc = this.frame.contentDocument; }
        catch { return reject(new Error("The page blocked us from reading it")); }
        const best = doc && [...doc.querySelectorAll("canvas")]
          .sort((a, b) => b.width * b.height - a.width * a.height)[0];
        if (best && best.width > 16 && best.height > 16) {
          this.canvas = best;
          this.ready = true;
          this.fit();
          return resolve(this);
        }
        if (performance.now() - t0 > 20000)
          return reject(new Error(
            "No <canvas> appeared in 20s — this attaches to canvas games, not DOM games"));
        setTimeout(look, 120);
      };
      this.frame.addEventListener("load", look, { once: true });
      setTimeout(look, 400);                 // load 가 이미 지났을 수도 있다
    });
  }

  /**
   * 표적을 무대 크기에 맞춘다.
   * iframe 을 무대 전체로 늘리면 게임은 왼쪽 위 구석에 원래 크기로 남는다.
   * 그래서 프레임을 캔버스 크기로 줄이고 통째로 확대한다. 게임 안의 좌표계는
   * 건드리지 않는다 — 우리가 크기를 바꾸면 게임이 스스로 다시 배치할 수 있고,
   * 그건 우리가 보려던 버그가 아니다.
   */
  fit() {
    if (!this.canvas) return;
    const f = this.frame, stage = f.parentElement;
    const w = this.canvas.offsetWidth || this.canvas.width;
    const h = this.canvas.offsetHeight || this.canvas.height;
    if (!w || !h || !stage.clientWidth) return;
    const k = Math.min(stage.clientWidth / w, stage.clientHeight / h);
    f.style.cssText =
      `position:absolute;inset:auto;left:50%;top:50%;width:${w}px;height:${h}px;` +
      `transform:translate(-50%,-50%) scale(${k});transform-origin:center;border:0;background:#000`;
  }

  /** 합성 키 — iframe 의 window/document/캔버스 모두에 쏜다 (어디서 듣는지 모르므로) */
  hold(name, on) {
    const k = KEYS[name];
    if (!k || !this.ready) return;
    if (on === this.down.has(name)) return;
    if (on) this.down.add(name); else this.down.delete(name);
    const mk = () => new KeyboardEvent(on ? "keydown" : "keyup", {
      key: k.key, code: k.code, keyCode: k.keyCode, which: k.keyCode,
      bubbles: true, cancelable: true,
    });
    const w = this.frame.contentWindow, d = this.frame.contentDocument;
    try { w.dispatchEvent(mk()); d.dispatchEvent(mk()); this.canvas.dispatchEvent(mk()); }
    catch { /* 문서가 사라졌다 */ }
  }

  /**
   * 조종. 남의 게임은 조작법을 모르므로 방향키와 WASD 를 동시에 누른다.
   * 둘 중 하나만 듣는 게임이 대부분이고, 둘 다 듣는 게임은 같은 방향이다.
   */
  drive(steer, thrust) {
    this.frameNo++;
    if (this.byHuman) return this.releaseAll();
    const L = steer < -0.18, R = steer > 0.18, F = thrust > 0.4;
    this.hold("left", L);  this.hold("a", L);
    this.hold("right", R); this.hold("d", R);
    this.hold("up", F);    this.hold("w", F);
    this.hold("space", this.frameNo % 150 < 6);   // 가끔 눌러본다 (점프·발사)
  }

  vision(gw, gh, out, normalize) {
    if (!this.grab(gw, gh)) { out.fill(0.4); return out; }
    const d = this.sctx.getImageData(0, 0, gw, gh).data;
    for (let i = 0; i < gw * gh; i++)
      out[i] = (d[4 * i] * 0.3 + d[4 * i + 1] * 0.59 + d[4 * i + 2] * 0.11) / 255;
    if (normalize) normalize(out, gw, gh);
    return out;
  }

  screenHash(gw = 24, gh = 16) {
    if (!this.grab(gw, gh)) return 0;
    const d = this.sctx.getImageData(0, 0, gw, gh).data;
    let h = 2166136261;
    for (let i = 0; i < d.length; i += 7) { h ^= d[i]; h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  /** 캔버스를 작은 스크래치로 줄여 그린다. 오염된 캔버스면 한 번만 기록하고 포기한다. */
  grab(gw, gh) {
    if (!this.ready || !this.canvas || !this.canvas.width) return false;
    if (this.scratch.width !== gw || this.scratch.height !== gh) {
      this.scratch.width = gw; this.scratch.height = gh;
    }
    try {
      this.sctx.drawImage(this.canvas, 0, 0, gw, gh);
      this.sctx.getImageData(0, 0, 1, 1);          // 오염 여부를 먼저 본다
      return true;
    } catch {
      if (!this.tainted) {
        this.tainted = true;
        console.warn("[byo] canvas is tainted by cross-origin images — the fly is blind here");
      }
      return false;
    }
  }

  releaseAll() { for (const k of [...this.down]) this.hold(k, false); }

  /**
   * 판을 다시 시작한다.
   * 화면이 멈춘 표적을 계속 두드려봐야 새 증상은 안 나온다. 실제 퍼저가 하는 일이고,
   * 연구실 근무지에서도 같은 이유로 끼이면 판을 새로 연다(버그 4.6배).
   */
  restart() {
    if (!this.source) return Promise.reject(new Error("nothing to restart"));
    const src = this.source;
    this.restarts++;
    const n = this.restarts;
    return this.loadHtml(src.html, src.label, src.baseHref).then((v) => { this.restarts = n; return v; });
  }

  dispose() {
    this.releaseAll();
    this.ready = false; this.canvas = null; this.tainted = false; this.frameNo = 0;
    this.restarts = 0;
    this.frame.src = "about:blank";
    this.frame.style.cssText = "";
    if (this.blobUrl) { URL.revokeObjectURL(this.blobUrl); this.blobUrl = null; }
  }
}
