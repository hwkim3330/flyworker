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
let learner = null;         // 온라인 학습 판독 (켜져 있을 때만)
/*
 * 학습 켜기 요청은 수습 교육(calibrate)이 끝나기 전에 올 수 있다. 조향 채널이
 * 아직 없으니 그때 판독을 만들면 터진다. 그래서 요청은 깃발로만 받아두고
 * 실제 생성은 cal 이 생긴 뒤로 미룬다. (이 순서를 안 지켰다가 학습이 조용히
 * 꺼진 채로 도는 걸 브라우저에서 잡았다 — ‖w‖ 가 0 에서 안 움직였다.)
 */
let learnOn = false, learnOnTop = false;
let actBuf = null;          // 3D 뇌에 보낼 활동도 (재사용 풀)

const post = (o, transfer) => self.postMessage(o, transfer || []);

/**
 * 온라인 학습 판독.
 *
 * 손으로 짠 좌우 불균형 판독(calibrate.js 의 steering) 대신, 조향 채널
 * 하행뉴런의 발화율을 그대로 특징으로 받아 선형 가중치를 얹는다. 매 보고마다
 * 작은 섭동을 섞어 조향을 내고, 그 섭동이 보상을 얻었으면 그 방향으로 가중치를
 * 민다. 기준선을 빼서 "평소보다 나았나"만 본다.
 *
 * 뇌는 건드리지 않는다. 시냅스도 커넥톰도 그대로다. 배우는 것은 판독 층뿐이다.
 * `policy_bench.mjs` 의 learn 정책과 같은 계산을 한다 — 페이지에서 보이는 것과
 * 벤치에서 재는 것이 달라지면 안 된다.
 */
const SIG = 0.35;
function makeLearner(ch, onTop) {
  const K = ch.length;
  const w = new Float32Array(K + 1);            // 마지막 항은 편향
  const mu = new Float32Array(K).fill(1);       // 뉴런별 이동평균
  const x = new Float32Array(K + 1), px = new Float32Array(K + 1);
  let base = 0, pNoise = 0, pAct = 0, warm = 0, pending = 0;
  return {
    reward(r) { pending += r; },
    steer(brain, cal) {
      for (let k = 0; k < K; k++) {
        const hz = brain.rate[ch[k]] * 1000 / brain.dt;
        mu[k] += (hz - mu[k]) * 0.01;
        x[k] = Math.max(-3, Math.min(3, (hz - mu[k]) / (mu[k] + 1)));
      }
      x[K] = 1;
      const r = pending; pending = 0;
      if (warm++ > 20) {
        base += (r - base) * 0.02;
        const adv = (r - base) * (pNoise / (SIG * SIG)) * (1 - pAct * pAct) * 0.02;
        for (let k = 0; k <= K; k++) w[k] += adv * px[k];
      }
      let z = 0; for (let k = 0; k <= K; k++) z += w[k] * x[k];
      const a = Math.tanh(z);
      const noise = (Math.random() * 2 - 1) * SIG;
      px.set(x); pNoise = noise; pAct = a;
      // onTop 이면 손으로 짠 판독을 그대로 깔고 그 위에 배운 보정만 더한다.
      const base0 = onTop ? steering(brain, cal) : 0;
      return Math.max(-1, Math.min(1, base0 + a + noise));
    },
    // 가중치가 얼마나 자랐는지 — 학습이 실제로 일어나는지 화면에서 보이게
    norm() { let s = 0; for (let k = 0; k <= K; k++) s += w[k] * w[k]; return Math.sqrt(s); },
  };
}

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

  // 수습 교육이 끝난 뒤에야 판독을 만들 수 있다.
  if (learnOn && !learner && cal) learner = makeLearner([...cal.leftCh, ...cal.rightCh], learnOnTop);

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
      steer: learner ? learner.steer(brain, cal) : steering(brain, cal),
      wnorm: learner ? learner.norm() : 0,
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
    else if (m.t === "learn") { learnOn = m.on; learnOnTop = !!m.onTop; learner = null; }
    else if (m.t === "reward") { if (learner) learner.reward(m.r); }
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
