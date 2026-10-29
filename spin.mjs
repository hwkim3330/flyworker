/**
 * 초파리가 제자리에서 도는가. 조향 신호를 직접 잰다.
 *
 * "빙빙 돈다"는 두 가지로 갈린다.
 *  (1) 조향이 한쪽으로 치우쳐 붙어 있다 → 편향 문제
 *  (2) 조향 부호가 너무 자주 바뀐다     → 떨림 문제
 * 둘은 고치는 법이 정반대라, 먼저 어느 쪽인지 봐야 한다.
 */
import { readFileSync } from 'fs';
import { decodeBrain } from './docs/brain.js';
import { Brain } from './docs/lif.js';
import { calibrate, steering, thrust } from './docs/calibrate.js';
import { Game } from './docs/game.js';

const GW = 16, GH = 12;
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
const mulberry32 = (a) => () => {
  a |= 0; a = a + 0x6D2B79F5 | 0;
  let t = Math.imul(a ^ a >>> 15, 1 | a);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
};
const b = new Brain(c, 1.0);
b.rng = mulberry32(20260916);
const cal = await calibrate(b, M.eye, M.descendingAll, { steps: 1000 });

const N = 1500;
for (const seed of [1000, 1037, 1074, 1111]) {
  b.reset(); delete cal._ema; delete cal._sm;
  const g = new Game(seed), vis = new Float32Array(GW * GH);
  const sv = [], tv = [], step = [], dh = [];
  let turn = 0, prevH = null, flips = 0, prevSign = 0;
  let x0 = null, y0 = null, far = 0, px = null, py = null;
  for (let f = 0; f < N; f++) {
    g.visionField(GW, GH, vis);
    for (const s of ['left', 'right']) { const m = em[s];
      for (let i = 0; i < m.ci.length; i++) m.buf[i] = vis[m.cell[i]];
      b.setDrive(m.ci, m.buf, 150); }
    for (let k = 0; k < 8; k++) b.step();
    const s = steering(b, cal), t = thrust(b, cal);
    sv.push(s); tv.push(t);
    g.step(s, t);
    const st = g.state();
    if (x0 === null) { x0 = st.x; y0 = st.y; }
    if (px !== null) step.push(Math.hypot(st.x - px, st.y - py));
    px = st.x; py = st.y;
    far = Math.max(far, Math.hypot(st.x - x0, st.y - y0));
    if (prevH !== null) { let d = st.a - prevH; while (d > Math.PI) d -= 2*Math.PI; while (d < -Math.PI) d += 2*Math.PI; turn += d; dh.push(d); } else dh.push(0);
    prevH = st.a;
    const sg = Math.sign(s);
    if (sg && prevSign && sg !== prevSign) flips++;
    if (sg) prevSign = sg;
  }
  const mean = sv.reduce((a, x) => a + x, 0) / N;
  const absmean = sv.reduce((a, x) => a + Math.abs(x), 0) / N;
  const sat = sv.filter((x) => Math.abs(x) > 0.95).length / N;
  const pos = sv.filter((x) => x > 0).length / N;
  // 덫에 걸린 구간을 빼고, '실제로 움직이는 동안' 얼마나 도는지만 본다.
  let mv = 0, rot = 0, firstStuck = -1, run = 0;
  for (let i = 0; i < step.length; i++) {
    if (step[i] > 0.3) { mv += step[i]; rot += Math.abs(dh[i]); run = 0; }
    else if (++run === 60 && firstStuck < 0) firstStuck = i;
  }
  const radius = rot > 0 ? mv / rot : Infinity;
  console.log(`  움직인 거리 ${mv.toFixed(0)}px · 그동안 회전 ${(rot/(2*Math.PI)).toFixed(2)}바퀴 ` +
    `→ 선회반경 ${radius.toFixed(1)}px (판 320x240)  첫 끼임 ${firstStuck<0?'없음':firstStuck+'프레임'}`);
  const tmean = tv.reduce((a, x) => a + x, 0) / N;
  const smean = step.reduce((a, x) => a + x, 0) / step.length;
  const still = step.filter((x) => x < 0.3).length / step.length;
  console.log(`  추력평균 ${tmean.toFixed(2)}  프레임당이동 ${smean.toFixed(2)}px  거의정지 ${(still*100).toFixed(0)}%  판크기 ${g.W}x${g.H}`);
  console.log(`시드 ${seed}  조향평균 ${mean.toFixed(3)}  |조향| ${absmean.toFixed(3)}  포화 ${(sat*100).toFixed(0)}%  ` +
    `우측비율 ${(pos*100).toFixed(0)}%  부호전환 ${flips}회  총회전 ${(turn/(2*Math.PI)).toFixed(2)}바퀴  최대이동 ${far.toFixed(0)}px`);
}
