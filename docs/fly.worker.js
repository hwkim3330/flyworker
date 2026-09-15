/**
 * 초파리 직원 한 명 = 워커 하나.
 *
 * 커넥톰은 읽기 전용이라 개체마다 따로 디코드해도 되고(브라우저 캐시가 받쳐준다),
 * 개체별 상태는 막전위·전류·불응기뿐이라 0.5MB 남짓이다.
 * 그래서 코어 수만큼 직원을 뽑아 진짜 병렬로 일을 시킬 수 있다.
 */
import { decodeBrain } from "./brain.js";
import { Brain } from "./lif.js";
import { calibrate, steering, thrust } from "./calibrate.js";

let brain = null, meta = null, cal = null;
let id = "?", running = false;
let eyeMap = null;          // 눈 뉴런 → 화면 격자 칸
let grid = { w: 16, h: 12 };
let vision = null;          // Float32Array(w*h)
let driveHz = 150;
let lastReport = 0, lastAct = 0;
let actBuf = null;          // 3D 뇌에 보낼 활동도 (재사용 풀)

const post = (o, transfer) => self.postMessage(o, transfer || []);

/** 눈 뉴런의 (u,v) 좌표를 화면 격자 칸 번호로 미리 변환해 둔다 */
function buildEyeMap() {
  const out = {};
  for (const side of ["left", "right"]) {
    const e = meta.eye[side];
    if (!e) continue;
    const ci = Uint32Array.from(e.ci);
    const cell = new Uint32Array(ci.length);
    for (let i = 0; i < ci.length; i++) {
      // 왼쪽 눈은 화면 왼쪽 절반, 오른쪽 눈은 오른쪽 절반을 본다
      const half = side === "left" ? 0 : 1;
      const gx = Math.min(grid.w - 1,
        Math.floor((e.u[i] * 0.5 + half * 0.5) * grid.w));
      const gy = Math.min(grid.h - 1, Math.floor(e.v[i] * grid.h));
      cell[i] = gy * grid.w + gx;
    }
    out[side] = { ci, cell, buf: new Float32Array(ci.length) };
  }
  return out;
}

/** 화면 밝기를 눈에 넣는다 */
function applyVision() {
  if (!vision || !eyeMap) return;
  for (const side of ["left", "right"]) {
    const m = eyeMap[side];
    if (!m) continue;
    for (let i = 0; i < m.ci.length; i++) m.buf[i] = vision[m.cell[i]];
    brain.setDrive(m.ci, m.buf, driveHz);
  }
}

async function hire(msg) {
  id = msg.id;
  grid = msg.grid || grid;
  post({ t: "status", id, phase: "Downloading connectome" });

  const [bBuf, mRes] = await Promise.all([
    fetch(msg.brainUrl).then((r) => r.arrayBuffer()),
    fetch(msg.metaUrl).then((r) => r.json()),
  ]);
  meta = mRes;
  post({ t: "status", id, phase: "Decoding" });
  const c = decodeBrain(bBuf);
  brain = new Brain(c, 1.0);
  eyeMap = buildEyeMap();
  vision = new Float32Array(grid.w * grid.h);

  post({ t: "status", id, phase: "Training", detail: "probing left/right vision" });
  cal = await calibrate(brain, meta.eye, meta.descendingAll, {
    onProgress: (which, p) =>
      post({ t: "status", id, phase: "Training",
             detail: `${which === "L" ? "left" : "right"} eye ${Math.round(p * 100)}%` }),
  });

  post({
    t: "hired", id,
    nNeurons: c.N, nSynapses: c.M,
    leftCh: cal.leftCh.length, rightCh: cal.rightCh.length,
    active: cal.active.length, quality: cal.quality,
  });
}

function loop() {
  if (!running) return;
  const budgetMs = 40;                 // 한 번에 40ms어치만 돌고 메시지를 처리한다
  const t0 = performance.now();
  let steps = 0;
  applyVision();
  while (performance.now() - t0 < budgetMs) {
    brain.step();
    steps++;
  }

  const now = performance.now();

  // 3D 뇌용 활동도 — 소유권을 넘겨 복사 비용을 없앤다
  if (now - lastAct > 140) {
    lastAct = now;
    const N = brain.c.N;
    if (!actBuf || actBuf.length !== N) actBuf = new Uint8Array(N);
    const rate = brain.rate;
    for (let i = 0; i < N; i++) {
      const v = rate[i] * 900;                 // 0.28 정도면 포화
      actBuf[i] = v > 255 ? 255 : v | 0;
    }
    const send = actBuf;
    actBuf = null;                             // 넘긴 버퍼는 다시 안 쓴다
    post({ t: "act", id, act: send }, [send.buffer]);
  }

  if (now - lastReport > 100) {
    lastReport = now;
    post({
      t: "motor", id,
      steer: steering(brain, cal),
      drive: thrust(brain, cal),
      spikes: brain.nSpikes,
      hz: brain.groupHz(meta.descendingAll),
      totalSpikes: brain.totalSpikes,
      brainMs: brain.steps,
    });
  }
  setTimeout(loop, 0);
}

self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.t === "hire") await hire(m);
    else if (m.t === "start") { running = true; loop(); }
    else if (m.t === "stop") running = false;
    else if (m.t === "vision") vision.set(m.frame);
    else if (m.t === "gain") driveHz = m.hz;
    else if (m.t === "reset") { brain.reset(); }
    else if (m.t === "lesion") {
      const sets = {
        steer: [...cal.leftCh, ...cal.rightCh],
        eyeL: meta.eye.left.ci,
        eyeR: meta.eye.right.ci,
      };
      if (m.what === "heal") brain.healAll();
      else brain.lesion(sets[m.what] || []);
      post({ t: "lesioned", id, what: m.what, nCut: brain.nCut || 0,
             indices: m.what === "heal" ? null : (sets[m.what] || []) });
    }
  } catch (err) {
    post({ t: "error", id, msg: String(err && err.message || err) });
  }
};
