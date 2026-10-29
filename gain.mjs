/** 시냅스 이득을 올리면 T4 가 깨어나는가. 그리고 어디서 폭주하는가. */
import { readFileSync } from 'fs';
import { decodeBrain } from './docs/brain.js';
import { Brain } from './docs/lif.js';
const GW=16,GH=12;
const buf=readFileSync('./docs/data/brain.bin');
const c=decodeBrain(buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength));
const M=JSON.parse(readFileSync('./docs/data/meta.json','utf8'));
const grp=(k,n)=>{const o=[];for(const s of ['left','right']){const v=M[k][n][s];
  for(const x of(Array.isArray(v)?v:v.ci))o.push(x);}return Uint32Array.from(o);};
const T4=grp('motion','T4'),T5=grp('motion','T5'),L1=grp('pathway','L1');
const med=Uint32Array.from([...(M.medulla.left.ci||M.medulla.left),...(M.medulla.right.ci||M.medulla.right)]);
const DN=Uint32Array.from(M.descendingAll);
const eyeCi={},eyeCell={};
for(const s of ['left','right']){const e=M.eye[s];eyeCi[s]=Uint32Array.from(e.ci);
  const cell=new Uint32Array(e.ci.length),h=s==='left'?0:1;
  for(let i=0;i<e.ci.length;i++)cell[i]=Math.min(GH-1,Math.floor(e.v[i]*GH))*GW+Math.min(GW-1,Math.floor((e.u[i]*0.5+h*0.5)*GW));
  eyeCell[s]=cell;}
function run(wsyn,label){
  const b=new Brain(c,1.0,wsyn);
  b.rng=(()=>{let a=7;return()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);
    t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};})();
  const vis=new Float32Array(GW*GH);
  let mx={L1:0,med:0,T4:0,T5:0,DN:0,all:0};
  for(let f=0;f<120;f++){
    vis.fill(0.08);
    const bar=Math.floor((f/120)*GW);
    for(let y=0;y<GH;y++){vis[y*GW+bar]=1.0;if(bar+1<GW)vis[y*GW+bar+1]=1.0;}
    for(const s of ['left','right']){const ci=eyeCi[s],cell=eyeCell[s],bf=new Float32Array(ci.length);
      for(let i=0;i<ci.length;i++)bf[i]=vis[cell[i]];b.setDrive(ci,bf,150);}
    for(let k=0;k<4;k++) b.step();
    mx.L1=Math.max(mx.L1,b.groupHz(L1)); mx.med=Math.max(mx.med,b.groupHz(med));
    mx.T4=Math.max(mx.T4,b.groupHz(T4)); mx.T5=Math.max(mx.T5,b.groupHz(T5));
    mx.DN=Math.max(mx.DN,b.groupHz(DN)); mx.all=Math.max(mx.all,b.nSpikes/c.N*1000);
  }
  console.log(`w=${String(wsyn).padEnd(5)} ${label.padEnd(16)} L1 ${mx.L1.toFixed(1).padStart(6)}  수질 ${mx.med.toFixed(2).padStart(7)}  T4 ${mx.T4.toFixed(2).padStart(7)}  T5 ${mx.T5.toFixed(2).padStart(7)}  하행 ${mx.DN.toFixed(1).padStart(6)}  전체 ${mx.all.toFixed(0).padStart(5)}Hz`);
}
console.log('시냅스 세기를 올리며 관찰 (기본 0.44)\n');
for(const w of [0.44,0.9,1.5,2.5,4,6]) run(w, w<=0.44?'(현재)':'');
