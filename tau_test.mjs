/** 세포 유형별 시상수가 T4 를 깨우는가. 재본다. */
import { readFileSync } from 'fs';
import { decodeBrain } from './docs/brain.js';
import { Brain } from './docs/lif.js';
const GW=16, GH=12;
const buf=readFileSync('./docs/data/brain.bin');
const c=decodeBrain(buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength));
const M=JSON.parse(readFileSync('./docs/data/meta.json','utf8'));

const flat=(g)=>{const o=[];for(const s of ['left','right']){const v=M[g[0]][g[1]][s];
  for(const x of (Array.isArray(v)?v:v.ci)) o.push(x);} return o;};
const T4=flat([['motion'],'T4'].flat()), T5=flat([['motion'],'T5'].flat());
const L1=flat([['pathway'],'L1'].flat()), L2=flat([['pathway'],'L2'].flat());
const eyeCi={}, eyeCell={};
for(const s of ['left','right']){
  const e=M.eye[s]; eyeCi[s]=Uint32Array.from(e.ci);
  const cell=new Uint32Array(e.ci.length), h=s==='left'?0:1;
  for(let i=0;i<e.ci.length;i++)
    cell[i]=Math.min(GH-1,Math.floor(e.v[i]*GH))*GW+Math.min(GW-1,Math.floor((e.u[i]*0.5+h*0.5)*GW));
  eyeCell[s]=cell;
}
function run(tauCfg, label){
  const b=new Brain(c,1.0);
  b.rng=(()=>{let a=12345;return()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);
    t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};})();
  if(tauCfg){ for(const [idx,tau] of tauCfg) b.setTau(idx,tau); }
  const vis=new Float32Array(GW*GH);
  const hz=(g)=>b.groupHz(Uint32Array.from(g));
  let t4max=0,t5max=0,l1max=0,l2max=0;
  // 막대가 왼→오 로 지나간다. 움직임이 있어야 T4 가 반응한다.
  for(let f=0; f<160; f++){
    vis.fill(0.08);
    const bar=Math.floor((f/160)*GW);
    for(let y=0;y<GH;y++){ vis[y*GW+bar]=1.0; if(bar+1<GW) vis[y*GW+bar+1]=1.0; }
    for(const s of ['left','right']){
      const ci=eyeCi[s], cell=eyeCell[s], buf2=new Float32Array(ci.length);
      for(let i=0;i<ci.length;i++) buf2[i]=vis[cell[i]];
      b.setDrive(ci,buf2,150);
    }
    for(let k=0;k<4;k++) b.step();
    t4max=Math.max(t4max,hz(T4)); t5max=Math.max(t5max,hz(T5));
    l1max=Math.max(l1max,hz(L1)); l2max=Math.max(l2max,hz(L2));
  }
  console.log(`${label.padEnd(26)} L1 ${l1max.toFixed(2).padStart(6)}Hz  L2 ${l2max.toFixed(2).padStart(6)}Hz  T4 ${t4max.toFixed(2).padStart(6)}Hz  T5 ${t5max.toFixed(2).padStart(6)}Hz`);
  return {t4:t4max,t5:t5max};
}
console.log('막대가 시야를 가로지를 때 각 세포군의 최대 발화율\n');
run(null, '균일 20ms (현재)');
run([[L1,60],[L2,10]], 'L1 느리게 60 / L2 10');
run([[L1,100],[L2,8]],  'L1 100 / L2 8');
run([[T4,40],[T5,40]],  'T4·T5 만 40');
run([[L1,80],[L2,8],[T4,30],[T5,30]], 'L1 80 / L2 8 / T4·5 30');
