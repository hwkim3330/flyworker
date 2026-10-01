/** T4 가 무엇으로부터 입력을 받는가. 배선을 직접 센다. */
import { readFileSync } from 'fs';
import { decodeBrain } from './docs/brain.js';
const buf=readFileSync('./docs/data/brain.bin');
const c=decodeBrain(buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength));
const M=JSON.parse(readFileSync('./docs/data/meta.json','utf8'));
const grp=(k,n)=>{const o=[];for(const s of ['left','right']){const v=M[k][n][s];
  for(const x of (Array.isArray(v)?v:v.ci)) o.push(x);} return new Set(o);};
const T4=grp('motion','T4'), T5=grp('motion','T5');
const L1=grp('pathway','L1'), L2=grp('pathway','L2');
const eye=new Set([...M.eye.left.ci, ...M.eye.right.ci]);
const med=new Set([...(M.medulla.left.ci||M.medulla.left), ...(M.medulla.right.ci||M.medulla.right)]);
const {indptr,indices,weights}=c;
// 들어오는 연결을 세려면 역방향이 필요하다
const inDeg=new Int32Array(c.N), inFrom={};
for(const name of ['T4','T5']) inFrom[name]={L1:0,L2:0,eye:0,medulla:0,other:0,total:0,syn:0};
for(let pre=0; pre<c.N; pre++){
  for(let k=indptr[pre]; k<indptr[pre+1]; k++){
    const post=indices[k], w=weights[k];
    for(const [name,S] of [['T4',T4],['T5',T5]]){
      if(!S.has(post)) continue;
      const f=inFrom[name]; f.total++; f.syn+=Math.abs(w);
      if(L1.has(pre)) f.L1++; else if(L2.has(pre)) f.L2++;
      else if(eye.has(pre)) f.eye++; else if(med.has(pre)) f.medulla++; else f.other++;
    }
  }
}
for(const n of ['T4','T5']){
  const f=inFrom[n];
  console.log(`${n}: 들어오는 연결 ${f.total.toLocaleString()}개 · 시냅스 ${f.syn.toLocaleString()}`);
  console.log(`   L1 ${f.L1}  L2 ${f.L2}  광수용체하류(eye) ${f.eye}  수질(medulla) ${f.medulla}  기타 ${f.other}`);
}
// T4 가 받는 입력원 상위
const cnt=new Map();
for(let pre=0; pre<c.N; pre++)
  for(let k=indptr[pre]; k<indptr[pre+1]; k++)
    if(T4.has(indices[k])) cnt.set(pre,(cnt.get(pre)||0)+Math.abs(weights[k]));
const top=[...cnt.entries()].sort((a,b)=>b[1]-a[1]).slice(0,8);
console.log('\nT4 에 가장 많이 넣는 뉴런 (시냅스 합):');
for(const [i,w] of top){
  const tag=[L1.has(i)&&'L1',L2.has(i)&&'L2',eye.has(i)&&'eye',med.has(i)&&'medulla',T4.has(i)&&'T4',T5.has(i)&&'T5'].filter(Boolean).join(',')||'미분류';
  console.log(`   #${i} ${w} 시냅스  [${tag}]`);
}
