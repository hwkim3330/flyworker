/**
 * 정책 비교 — 같은 프레임워크, 같은 계산량, 정책만 교체.
 *
 * 한 번만 돌려서 나온 숫자는 싣지 않는다. 난수 정책은 회차 편차가 크고
 * (한 번은 55%, 다음은 78%), 그 숫자를 표에 박으면 심사위원이 다시 돌렸을 때
 * 다른 값이 나온다. 그래서 난수를 시드로 고정하고 여러 회차의 평균과 범위를 낸다.
 */
import { readFileSync } from 'fs';
import { decodeBrain } from './docs/brain.js';
import { Brain } from './docs/lif.js';
import { calibrate, steering, thrust } from './docs/calibrate.js';
import { Game } from './docs/game.js';
import { QA } from './docs/qa.js';
import { viewKey } from './docs/vision.js';

const GW = 16, GH = 12, TOTAL = 221, BUDGET = 24000, MAXRUN = 6000;
const buf = readFileSync('./docs/data/brain.bin');
const c = decodeBrain(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const M = JSON.parse(readFileSync('./docs/data/meta.json', 'utf8'));
const em = {};
for (const s of ['left', 'right']) {
  const e = M.eye[s], ci = Uint32Array.from(e.ci), cell = new Uint32Array(ci.length), h = s === 'left' ? 0 : 1;
  for (let i = 0; i < ci.length; i++)
    cell[i] = Math.min(GH - 1, Math.floor(e.v[i] * GH)) * GW + Math.min(GW - 1, Math.floor((e.u[i] * 0.5 + h * 0.5) * GW));
  em[s] = { ci, cell, buf: new Float32Array(ci.length) };
}
/** 시드 고정 난수 — 같은 시드면 같은 결과가 나온다 */
const mulberry32 = (a) => () => {
  a |= 0; a = a + 0x6D2B79F5 | 0;
  let t = Math.imul(a ^ a >>> 15, 1 | a);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
};

const FLYLIKE = ['fly', 'hybrid', 'learn', 'learn0', 'lf', 'lf0', 'mismatch'];
const LEARNY = ['learn', 'learn0', 'lf', 'lf0'];
const WSYN = Number(process.env.WSYN || 0.44);
const b = new Brain(c, 1.0, WSYN);

/**
 * 뇌의 난수까지 고정한다.
 * 감각 뉴런 강제 발화가 포아송이라 초파리 정책도 결정적이지 않다.
 * 이걸 고정하지 않으면 "이 표는 재현된다"는 말이 난수 정책에만 해당한다.
 */
const seedBrain = (seed) => { b.rng = mulberry32(seed); };
seedBrain(20260916);
const cal = await calibrate(b, M.eye, M.descendingAll, { steps: 1000 });

/**
 * 학습 판독 만들기. lr=0 이면 가중치가 갱신되지 않아 순수 섭동 대조군이 된다.
 * 두 경우가 같은 난수열을 보게 해서 차이가 오직 학습에서만 오도록 한다.
 */
const SIG = 0.35;
/**
 * @param seed  난수 시드 — 같은 회차면 learn 과 learn0 이 같은 섭동열을 본다
 * @param lr    학습률. 0 이면 가중치가 안 움직여 순수 섭동 대조군이 된다.
 * @param onTop true 면 손으로 짠 판독(steering) 위에 보정을 배운다.
 *              false 면 판독을 통째로 학습이 대신한다.
 */
function mkLearn(seed, lr, onTop = false) {
  const r = mulberry32(seed);
  b.reset(); delete cal._ema; delete cal._sm;
  const ch = [...cal.leftCh, ...cal.rightCh];
  const K = ch.length;
  const w = new Float32Array(K + 1);           // 마지막 항은 편향
  const mu = new Float32Array(K).fill(1);      // 뉴런별 이동평균
  const x = new Float32Array(K + 1);
  const px = new Float32Array(K + 1);
  let base = 0, pNoise = 0, pAct = 0, warm = 0;
  return (g, vis, reward) => {
    g.visionField(GW, GH, vis);
    for (const s of ['left', 'right']) { const m = em[s];
      for (let i = 0; i < m.ci.length; i++) m.buf[i] = vis[m.cell[i]];
      b.setDrive(m.ci, m.buf, 150); }
    for (let k = 0; k < 8; k++) b.step();

    for (let k = 0; k < K; k++) {
      const hz = b.rate[ch[k]] * 1000 / b.dt;
      mu[k] += (hz - mu[k]) * 0.002;
      x[k] = Math.max(-3, Math.min(3, (hz - mu[k]) / (mu[k] + 1)));
    }
    x[K] = 1;

    // 직전 프레임의 섭동이 보상을 얻었는지로 가중치를 민다.
    if (lr > 0 && warm++ > 50) {
      base += (reward - base) * 0.01;
      const adv = (reward - base) * (pNoise / (SIG * SIG)) * (1 - pAct * pAct) * lr;
      for (let k = 0; k <= K; k++) w[k] += adv * px[k];
    }

    let z = 0; for (let k = 0; k <= K; k++) z += w[k] * x[k];
    const a = Math.tanh(z);
    const noise = (r() * 2 - 1) * SIG;
    px.set(x); pNoise = noise; pAct = a;
    const base0 = onTop ? steering(b, cal) : 0;
    return [Math.max(-1, Math.min(1, base0 + a + noise)), thrust(b, cal)];
  };
}

const make = {
  fly: () => { b.reset(); delete cal._ema; delete cal._sm;
    return (g, vis) => {
      g.visionField(GW, GH, vis);
      for (const s of ['left', 'right']) { const m = em[s];
        for (let i = 0; i < m.ci.length; i++) m.buf[i] = vis[m.cell[i]];
        b.setDrive(m.ci, m.buf, 150); }
      for (let k = 0; k < 8; k++) b.step();
      return [steering(b, cal), thrust(b, cal)];
    }; },
  uniform: (seed) => { const r = mulberry32(seed);
    return () => [r() * 2 - 1, 0.35 + r() * 0.65]; },
  smooth: (seed) => { const r = mulberry32(seed); let s = 0, t = 0.7;
    return () => { s += (r() * 2 - 1 - s) * 0.08; t += ((0.35 + r() * 0.65) - t) * 0.05;
      return [Math.max(-1, Math.min(1, s * 3)), t]; }; },
  straight: () => () => [0, 0.8],

  /**
   * 섞은 정책의 대조군 — 초파리 항만 빼고 난수 항은 그대로 둔다.
   *
   * hybrid 를 smooth 와 비교하면 난수 진폭이 달라(1.2 vs 3.0) 공정하지 않다.
   * 같은 시드를 주면 이 정책은 hybrid 가 쓰는 난수열과 완전히 같은 열을 본다.
   * 그래서 hybrid − weak 가 곧 "커넥톰이 보탠 몫"이다.
   */
  weak: (seed) => { const r = mulberry32(seed); let n = 0, t = 0.7;
    return () => {
      n += (r() * 2 - 1 - n) * 0.08;
      t += ((0.35 + r() * 0.65) - t) * 0.05;
      return [Math.max(-1, Math.min(1, n * 3 * 0.4)), t];
    }; },

  /**
   * 엇갈린 정책 — hybrid 와 모든 것이 같고, 초파리가 '다른 판'을 본다.
   *
   * hybrid 가 weak 를 이기는 것만으로는 부족하다. hybrid 는 fly*0.6 을 더하므로
   * 조향 진폭이 weak 보다 크고, 이득이 '정보' 때문인지 '더 크게 꺾어서'인지
   * 구분되지 않는다.
   *
   * 그래서 뇌에는 다른 시드의 판을 보여주고, 그 출력으로 지금 판을 몬다.
   * 조향 신호의 진폭·시간 구조·통계는 hybrid 와 같고, 화면과의 관련성만 없다.
   * hybrid 가 이것도 이기면 보탠 것은 정보다. 비슷하면 진폭이었을 뿐이다.
   */
  mismatch: (seed) => { const r = mulberry32(seed); let n = 0, t = 0.7;
    b.reset(); delete cal._ema; delete cal._sm;
    const other = new Game(seed % 97 + 7000);      // 초파리가 보는 '엉뚱한' 판
    const ovis = new Float32Array(GW * GH);
    let os = 0, ot = 0.7;
    return (g, vis) => {
      // 엉뚱한 판을 스스로 굴려서(평활 난수로) 시야를 만든다
      os += (r() * 2 - 1 - os) * 0.08; ot += ((0.35 + r() * 0.65) - ot) * 0.05;
      other.step(Math.max(-1, Math.min(1, os * 3)), ot);
      other.visionField(GW, GH, ovis);
      for (const s of ['left', 'right']) { const m = em[s];
        for (let i = 0; i < m.ci.length; i++) m.buf[i] = ovis[m.cell[i]];
        b.setDrive(m.ci, m.buf, 150); }
      for (let k = 0; k < 8; k++) b.step();
      n += (r() * 2 - 1 - n) * 0.08;
      t += ((0.35 + r() * 0.65) - t) * 0.05;
      const fly = steering(b, cal);
      return [Math.max(-1, Math.min(1, fly * 0.6 + n * 3 * 0.4)), t];
    }; },

  /**
   * 섞은 정책 — 초파리 조향에 평활 난수를 더한다.
   * 초파리가 단독으로 지는 것은 쟀다. 그러면 남는 질문은
   * "커넥톰이 아무것도 보태지 않는가"다. 프레임워크가 정책을 갈아끼울 수
   * 있으니 이건 재서 답할 수 있는 질문이다.
   */

  /**
   * 온라인 학습 정책 — 커넥톰은 특징을 주고, 판독은 판에서 배운다.
   *
   * 지금까지 초파리 정책의 조향은 손으로 짠 판독이었다. 좌/우 채널의
   * 불균형을 재서 방향으로 바꾸는 식이다. 그 판독이 이 게임에 맞는다는
   * 보장은 어디에도 없다. 커넥톰은 배선을 줄 뿐 "이 판에서 어느 배선이
   * 쓸모 있는지"는 말해주지 않는다.
   *
   * 그래서 판독을 고정하지 않고 판에서 민다. 조향 채널 하행뉴런 각각의
   * 발화율을 특징으로 쓰고(자기 이동평균으로 정규화), 그 위에 선형 가중치를
   * 얹어 조향을 낸다. 매 프레임 작은 섭동을 더해 보고, 그 섭동이 새 칸을
   * 밟게 했으면 그 방향으로 가중치를 민다. 기준선을 빼서 "평소보다 나았나"만
   * 본다.
   *
   * 뇌는 건드리지 않는다. 시냅스는 그대로다. 배우는 것은 판독 층뿐이다.
   *
   * 보상은 "처음 보는 장면"이다(docs/vision.js 의 viewKey). 좌표가 아니라
   * 뷰를 쓰는 이유는 두 가지다 — 남의 게임에는 좌표가 없고, 우리가 표에 싣는
   * 지표(탐색률)를 직접 보상으로 주면 "학습이 이겼다"가 동어반복이 된다.
   *
   * 섭동 잡음이 들어간다는 점도 분명히 한다. 잡음만으로 61%가 나오는 판이니
   * 학습이 보탠 몫은 잡음만 있는 짝 대조군(learn0 — 같은 시드, 학습률 0)과의
   * 차이로만 말한다.
   */
  learn:  (seed) => mkLearn(seed, 0.02),
  learn0: (seed) => mkLearn(seed, 0),     // 짝 대조군: 같은 섭동열, 학습 없음

  /*
   * 두 번째 형태 — 판독을 대체하지 않고 그 위에 보정을 배운다.
   *
   * learn 은 손으로 짠 판독을 버리고 처음부터 배운다. 그래서 "잡음보다 나은가"에는
   * 답하지만 "초파리를 개선하는가"에는 답하지 못한다. 이쪽은 초파리의 조향을
   * 그대로 깔고 그 위에 더할 보정만 배운다. 대조군(lf0)은 같은 섭동, 학습률 0 이라
   * 사실상 '초파리 + 잡음'이다. 차이가 곧 학습이 보탠 몫이다.
   */
  lf:  (seed) => mkLearn(seed, 0.02, true),
  lf0: (seed) => mkLearn(seed, 0, true),

  hybrid: (seed) => { const r = mulberry32(seed); let n = 0, t = 0.7;
    b.reset(); delete cal._ema; delete cal._sm;
    return (g, vis) => {
      g.visionField(GW, GH, vis);
      for (const s of ['left', 'right']) { const m = em[s];
        for (let i = 0; i < m.ci.length; i++) m.buf[i] = vis[m.cell[i]];
        b.setDrive(m.ci, m.buf, 150); }
      for (let k = 0; k < 8; k++) b.step();
      n += (r() * 2 - 1 - n) * 0.08;
      t += ((0.35 + r() * 0.65) - t) * 0.05;
      const fly = steering(b, cal);
      return [Math.max(-1, Math.min(1, fly * 0.6 + n * 3 * 0.4)), t];
    }; },
};

function shift(id, rep, restart = true) {
  seedBrain(104729 * (rep + 1));
  const fn = make[id](7919 * (rep + 1));
  const seen = new Set(); const codes = {};
  let bugs = 0, runs = 0, used = 0, sn = rep * 13;
  while (used < BUDGET) {
    const seed = 1000 + (sn++) * 37;
    const g = new Game(seed), qa = new QA({ seed, W: g.W, H: g.H }), vis = new Float32Array(GW * GH);
    if (FLYLIKE.includes(id)) { b.reset(); delete cal._ema; delete cal._sm; }
    runs++;
    let rew = 0;
    // 보상은 '이 판에서 처음 보는 장면'. 좌표가 아니라 뷰를 쓰는 이유는
    // docs/vision.js 의 viewKey 주석에 적었다 — 남의 게임엔 좌표가 없고,
    // 지표(탐색률)를 직접 최적화하면 결과가 동어반복이 된다.
    const seenView = new Set();
    for (let f = 0; f < MAXRUN && used < BUDGET; f++, used++) {
      const [sv, tv] = fn(g, vis, rew);
      g.step(sv, tv);
      // 보상은 "새 칸을 밟았나". 재는 지표가 곧 보상이라는 점은 표에 적는다.
      const st = g.state(); seen.add(`${st.x >> 4},${st.y >> 4}`);
      if (LEARNY.includes(id)) {
        // 움직인 뒤의 장면으로 판단해야 한다. 움직이기 전 장면을 쓰면
        // 방금 낸 행동이 아니라 그 전 행동을 평가하게 된다.
        g.visionField(GW, GH, vis);
        const vk = viewKey(vis, GW, GH);
        rew = seenView.has(vk) ? 0 : 1; seenView.add(vk);
      }
      const before = qa.findings.length;
      qa.observe(st, sv, tv); qa.progress(st, Math.hypot(st.x - g.goal.x, st.y - g.goal.y));
      if (qa.findings.length > before) {
        const fresh = qa.findings.slice(before);
        bugs += fresh.length;
        fresh.forEach((x) => codes[x.code] = (codes[x.code] || 0) + 1);
        if (restart && fresh.some((x) => ['STUCK', 'NOPROG', 'FREEZE'].includes(x.code))) break;
      }
      if (st.won || st.escaped) break;
    }
  }
  return { pct: seen.size / TOTAL * 100, bugs, runs, codes };
}

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const rng = (a) => `${Math.min(...a).toFixed(0)}–${Math.max(...a).toFixed(0)}`;

console.log(`같은 프레임워크 · 같은 계산량(${BUDGET.toLocaleString()}프레임) · 정책만 교체 · wsyn=${WSYN}`);
console.log(`난수는 시드 고정. 회차마다 시드와 판 순서가 다르다.\n`);
console.log("정책        회차  탐색률(평균)   범위      증상종류(평균)  전체 관측 종류");
const REPS = { fly: 3, uniform: 3, smooth: 3, straight: 3, hybrid: 3, weak: 3, learn: 3, learn0: 3, lf: 3, lf0: 3, mismatch: 3 };

/*
 * 짝지은 비교 (PAIRED=<회차수>).
 *
 * learn 과 learn0 은 회차 번호가 같으면 시드도, 판 순서도, 섭동열도 같다.
 * 그러니 평균끼리 빼는 것보다 회차별로 빼고 그 차이들을 보는 쪽이 훨씬
 * 정확하다 — 판 난이도 편차가 양쪽에서 똑같이 상쇄된다. 3회차 범위가
 * 24~48%p 로 벌어지는 판이라 이 구분이 결론을 바꾼다.
 */
if (process.env.PAIRED) {
  const n = Number(process.env.PAIRED);
  const [A, B] = (process.env.PAIR || 'learn,learn0').split(',');
  console.log(`\n=== 짝지은 비교 — 회차마다 같은 시드로 ${A} / ${B} (${n}회차) ===`);
  const d = [];
  for (let r = 0; r < n; r++) {
    const a = shift(A, r), b2 = shift(B, r);
    d.push(a.pct - b2.pct);
    console.log(`  회차 ${r}  ${A} ${a.pct.toFixed(0)}%  ${B} ${b2.pct.toFixed(0)}%  차이 ${(a.pct-b2.pct>0?'+':'')}${(a.pct-b2.pct).toFixed(0)}%p`);
  }
  const m = mean(d), sd = Math.sqrt(mean(d.map((x) => (x - m) ** 2)) * n / Math.max(1, n - 1));
  const se = sd / Math.sqrt(n);
  /*
   * 회차가 적으면 정규분포 근사(|평균| > 2×표준오차)를 쓰면 안 된다.
   * 자유도 5 의 t 임계값은 2.0 이 아니라 2.571 이라, 그 규칙은 t=2.05 를
   * "유의하다"고 잘못 찍는다. 실제로 한 번 그렇게 찍혔다.
   * 그래서 자유도별 양측 95% 임계값을 그대로 쓴다.
   */
  const TCRIT = { 1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365,
                  8: 2.306, 9: 2.262, 10: 2.228, 11: 2.201, 12: 2.179, 15: 2.131, 20: 2.086 };
  const df = n - 1;
  const tc = TCRIT[df] ?? (df > 20 ? 2.0 : 2.571);
  const t = se > 0 ? Math.abs(m) / se : 0;
  console.log(`  평균 차이 ${(m>0?'+':'')}${m.toFixed(1)}%p · 표준오차 ${se.toFixed(1)}%p · ` +
    `t=${t.toFixed(2)} (자유도 ${df}, 95% 임계값 ${tc}) → ` +
    (t > tc ? '잡음보다 큼' : '**잡음과 구분되지 않음**'));
  // 한 회차가 결과를 끌고 가는지 본다. 그렇다면 회차를 늘려야 한다.
  const mx = d.reduce((a, b) => Math.abs(b - m) > Math.abs(a - m) ? b : a, d[0]);
  const without = mean(d.filter((x) => x !== mx));
  console.log(`  가장 튀는 회차(${mx>0?'+':''}${mx.toFixed(0)}%p)를 빼면 평균 ${(without>0?'+':'')}${without.toFixed(1)}%p`);
  process.exit(0);
}
const out = {};
const ONLY = (process.env.ONLY||'').split(',').filter(Boolean);
for (const id of (ONLY.length?ONLY:['fly','learn','learn0','hybrid','weak','mismatch','smooth','uniform','straight'])) {
  const rs = [];
  for (let r = 0; r < REPS[id]; r++) rs.push(shift(id, r));
  const pcts = rs.map((x) => x.pct), kinds = rs.map((x) => Object.keys(x.codes).length);
  const union = [...new Set(rs.flatMap((x) => Object.keys(x.codes)))];
  out[id] = { pct: Math.round(mean(pcts)), pctRange: rng(pcts), kinds: +mean(kinds).toFixed(1),
              union, bugs: Math.round(mean(rs.map((x) => x.bugs))), runs: Math.round(mean(rs.map((x) => x.runs))) };
  console.log(`${id.padEnd(10)} ${String(rs.length).padStart(4)} ${String(out[id].pct).padStart(10)}% ${out[id].pctRange.padStart(10)} ${String(out[id].kinds).padStart(13)}   ${union.join(' ')}`);
}

if (process.argv.includes('--restart')) {
  console.log("\n=== 끼임 재시작의 효과 (초파리, 3회차) ===");
  for (const [label, on] of [['재시작 함', true], ['재시작 안 함', false]]) {
    const rs = [0, 1, 2].map((r) => shift('fly', r, on));
    console.log(`${label.padEnd(12)} 탐색률 ${mean(rs.map(x=>x.pct)).toFixed(0)}%  ` +
      `증상종류 ${mean(rs.map(x=>Object.keys(x.codes).length)).toFixed(1)}  ` +
      `버그 ${mean(rs.map(x=>x.bugs)).toFixed(0)}건  판수 ${mean(rs.map(x=>x.runs)).toFixed(0)}`);
  }
}
// 짝 대조군 비교는 두 항이 다 있을 때만 의미가 있다.
// (ONLY= 로 일부만 돌리면 여기서 터지던 걸 고쳤다.)
if (out.hybrid && out.weak) console.log(`
=== 커넥톰이 보탠 몫 (같은 난수열, 초파리 항만 차이) ===
  섞은 정책 (초파리 + 난수)  탐색률 ${out.hybrid.pct}%  범위 ${out.hybrid.pctRange}  증상 ${out.hybrid.kinds}종
  대조군   (난수만, 같은 열)  탐색률 ${out.weak.pct}%  범위 ${out.weak.pctRange}  증상 ${out.weak.kinds}종
  차이     ${out.hybrid.pct - out.weak.pct > 0 ? '+' : ''}${out.hybrid.pct - out.weak.pct}%p`);

// 학습이 보탠 몫 — learn 과 learn0 은 같은 시드, 같은 섭동열, 학습률만 다르다.
if (out.learn && out.learn0) console.log(`
=== 학습이 보탠 몫 (같은 섭동열, 학습률만 차이) ===
  학습함   (판독을 민다)      탐색률 ${out.learn.pct}%  범위 ${out.learn.pctRange}  증상 ${out.learn.kinds}종
  대조군   (학습률 0)         탐색률 ${out.learn0.pct}%  범위 ${out.learn0.pctRange}  증상 ${out.learn0.kinds}종
  차이     ${out.learn.pct - out.learn0.pct > 0 ? '+' : ''}${out.learn.pct - out.learn0.pct}%p`);
console.log("\nJSON " + JSON.stringify(out));
