/** 자극이 어디까지 전파되고 어디서 끊기는가. 단계별로 잰다. */
import { readFileSync } from 'fs';
import { decodeBrain } from './docs/brain.js';
import { Brain } from './docs/lif.js';
const GW=16,GH=12;
const buf=readFileSync('./docs/data/brain.bin');
const c=decodeBrain(buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength));
const M=JSON.parse(readFileSync('./docs/data/meta.json','utf8'));
const grp=(k,n)=>{const o=[];for(const s of ['left','right']){const v=M[k][n][s];
  for(const x of(Array.isArray(v)?v:v.ci)) o.push(x);} return Uint32Array.from(o);};
const T4=grp('motion','T4'), T5=grp('motion','T5');
const L1=grp('pathway','L1'), L2=grp('pathway','L2');
const med=Uint32Array.from([...(M.medulla.left.ci||M.medulla.left),...(M.medulla.right.ci||M.medulla.right)]);
// T4 에 직접 넣는 상위 입력원 집합
const {indptr,indices,weights}=c;
const T4set=new Set(T4);
const feed=new Map();
for(let pre=0;pre<c.N;pre++)
  for(let k=indptr[pre];k<indptr[pre+1];k++)
    if(T4set.has(indices[k])) feed.set(pre,(feed.get(pre)||0)+Math.abs(weights[k]));
const T4in=Uint32Array.from([...feed.keys()]);
console.log(`T4 직접 입력원 ${T4in.length}개\n`);

const b=new Brain(c,1.0);
b.rng=(()=>{let a=7;return()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);
  t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};})();
const eyeCi={},eyeCell={};
for(const s of ['left','right']){const e=M.eye[s];eyeCi[s]=Uint32Array.from(e.ci);
  const cell=new Uint32Array(e.ci.length),h=s==='left'?0:1;
  for(let i=0;i<e.ci.length;i++)cell[i]=Math.min(GH-1,Math.floor(e.v[i]*GH))*GW+Math.min(GW-1,Math.floor((e.u[i]*0.5+h*0.5)*GW));
  eyeCell[s]=cell;}
const vis=new Float32Array(GW*GH);
const names=[['시각신경(자극)',null],['L1',L1],['L2',L2],['수질 전체',med],['T4 입력원',T4in],['T4',T4],['T5',T5]];
console.log('스텝   ' + names.map(n=>n[0].padStart(12)).join(''));
for(let f=0;f<120;f++){
  vis.fill(0.08);
  const bar=Math.floor((f/120)*GW);
  for(let y=0;y<GH;y++){vis[y*GW+bar]=1.0; if(bar+1<GW)vis[y*GW+bar+1]=1.0;}
  for(const s of ['left','right']){const ci=eyeCi[s],cell=eyeCell[s],bf=new Float32Array(ci.length);
    for(let i=0;i<ci.length;i++)bf[i]=vis[cell[i]]; b.setDrive(ci,bf,150);}
  for(let k=0;k<4;k++) b.step();
  if(f%20===19){
    const row=names.map(([n,g])=> (g? b.groupHz(g).toFixed(2) : b.groupHz(eyeCi.left).toFixed(2)).padStart(12));
    console.log(String((f+1)*4).padStart(5)+'  '+row.join(''));
  }
}
