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
const b = new Brain(c, 1.0);
const cal = await calibrate(b, M.eye, M.descendingAll, { steps: 1000 });

/** 시드 고정 난수 — 같은 시드면 같은 결과가 나온다 */
const mulberry32 = (a) => () => {
  a |= 0; a = a + 0x6D2B79F5 | 0;
  let t = Math.imul(a ^ a >>> 15, 1 | a);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
};

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
   * 섞은 정책 — 초파리 조향에 평활 난수를 더한다.
   * 초파리가 단독으로 지는 것은 쟀다. 그러면 남는 질문은
   * "커넥톰이 아무것도 보태지 않는가"다. 프레임워크가 정책을 갈아끼울 수
   * 있으니 이건 재서 답할 수 있는 질문이다.
   */
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
  const fn = make[id](7919 * (rep + 1));
  const seen = new Set(); const codes = {};
  let bugs = 0, runs = 0, used = 0, sn = rep * 13;
  while (used < BUDGET) {
    const seed = 1000 + (sn++) * 37;
    const g = new Game(seed), qa = new QA({ seed, W: g.W, H: g.H }), vis = new Float32Array(GW * GH);
    if (id === 'fly' || id === 'hybrid') { b.reset(); delete cal._ema; delete cal._sm; }
    runs++;
    for (let f = 0; f < MAXRUN && used < BUDGET; f++, used++) {
      const [sv, tv] = fn(g, vis);
      g.step(sv, tv);
      const st = g.state(); seen.add(`${st.x >> 4},${st.y >> 4}`);
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

console.log(`같은 프레임워크 · 같은 계산량(${BUDGET.toLocaleString()}프레임) · 정책만 교체`);
console.log(`난수는 시드 고정. 회차마다 시드와 판 순서가 다르다.\n`);
console.log("정책        회차  탐색률(평균)   범위      증상종류(평균)  전체 관측 종류");
const REPS = { fly: 3, uniform: 5, smooth: 5, straight: 3, hybrid: 3 };
const out = {};
for (const id of ['fly', 'hybrid', 'smooth', 'uniform', 'straight']) {
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
console.log("\nJSON " + JSON.stringify(out));
