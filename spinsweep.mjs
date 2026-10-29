/** 적응 속도/이득을 바꾸면 빙빙 도는 게 줄어드는가. 선회반경과 순회전으로 잰다. */
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
    cell[i] = Math.min(GH-1, Math.floor(e.v[i]*GH))*GW + Math.min(GW-1, Math.floor((e.u[i]*0.5+h*0.5)*GW));
  em[s] = { ci, cell, buf: new Float32Array(ci.length) };
}
const mulberry32 = (a) => () => { a |= 0; a = a + 0x6D2B79F5 | 0;
  let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const b = new Brain(c, 1.0);
b.rng = mulberry32(20260916);
const cal = await calibrate(b, M.eye, M.descendingAll, { steps: 1000 });

const N = 1500, SEEDS = [1000, 1037, 1074, 1111];

const SM = Number(process.env.STEER_SMOOTH ?? 0.12);
console.log(`평활 ${SM}  | 순회전(바퀴) 선회반경(px) 방문칸 조향평균`);
for (const [adapt, gain] of (process.env.CFG ? JSON.parse(process.env.CFG) : [[1/40,2.0],[1/20,2.0],[1/10,2.0],[1/40,1.0],[1/10,1.0],[1/10,3.0]])) {
  const R = [];
  for (const seed of SEEDS) {
    b.reset(); delete cal._ema; delete cal._sm;
    const g = new Game(seed), vis = new Float32Array(GW*GH);
    let net = 0, absr = 0, mv = 0, prevA = null, px = null, py = null, sum = 0;
    const seen = new Set();
    for (let f = 0; f < N; f++) {
      g.visionField(GW, GH, vis);
      for (const s of ['left','right']) { const m = em[s];
        for (let i = 0; i < m.ci.length; i++) m.buf[i] = vis[m.cell[i]];
        b.setDrive(m.ci, m.buf, 150); }
      for (let k = 0; k < 8; k++) b.step();
      const sv = steering(b, cal, gain, adapt);
      sum += sv;
      g.step(sv, thrust(b, cal));
      const st = g.state();
      seen.add(`${st.x>>4},${st.y>>4}`);
      if (px !== null) {
        const d = Math.hypot(st.x-px, st.y-py);
        let da = st.a - prevA; while (da > Math.PI) da -= 2*Math.PI; while (da < -Math.PI) da += 2*Math.PI;
        if (d > 0.3) { mv += d; net += da; absr += Math.abs(da); }
      }
      px = st.x; py = st.y; prevA = st.a;
    }
    R.push({ net: net/(2*Math.PI), rad: absr>0 ? mv/absr : Infinity, cells: seen.size, mean: sum/N });
  }
  const av = (k) => R.reduce((a,x)=>a+x[k],0)/R.length;
  console.log(`1/${String(Math.round(1/adapt)).padEnd(3)} ${gain.toFixed(1)} | ` +
    `${av('net').toFixed(2).padStart(11)} ${av('rad').toFixed(1).padStart(12)} ${av('cells').toFixed(1).padStart(7)} ${av('mean').toFixed(3).padStart(8)}`);
}
