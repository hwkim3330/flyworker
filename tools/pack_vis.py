"""시각 경로를 살린 커넥톰 (시험용). 시각 경로는 시냅스 2개 이상, 나머지는 5개 이상."""
import pyarrow.parquet as pq, numpy as np, pandas as pd, struct, pathlib, gzip, sys
TH_VIS, TH = int(sys.argv[1]) if len(sys.argv)>1 else 2, 5
t=pq.read_table('data/raw/connectivity_783.parquet',
  columns=['Presynaptic_Index','Postsynaptic_Index','Connectivity','Excitatory'])
pre=t['Presynaptic_Index'].to_numpy(); post=t['Postsynaptic_Index'].to_numpy()
w=t['Connectivity'].to_numpy(); exc=t['Excitatory'].to_numpy()
a=pd.read_csv('data/raw/annotations_783.tsv',sep='\t',low_memory=False)
ids=pd.read_csv('data/raw/completeness_783.csv').iloc[:,0].to_numpy(); N=len(ids)
idx=pd.Series(np.arange(N),index=ids); a['ci']=a['root_id'].map(idx)
a=a[a['ci'].notna()].copy(); a['ci']=a['ci'].astype(int)
vis=np.zeros(N,dtype=bool)
vis[a.loc[a['super_class'].isin(['optic','visual_projection','visual_centrifugal']),'ci'].to_numpy()]=True
keep = ((vis[pre]|vis[post]) & (w>=TH_VIS)) | (w>=TH)
pre,post,w,exc = pre[keep],post[keep],w[keep],exc[keep]
sw=np.clip(w*np.sign(exc),-32768,32767).astype(np.int16); M=len(pre)
order=np.lexsort((post,pre)); pre,post,sw=pre[order],post[order],sw[order]
indptr=np.zeros(N+1,dtype=np.uint32); np.add.at(indptr,pre+1,1); np.cumsum(indptr,out=indptr)
out=bytearray(); prev=-1; last=0
for i in range(M):
    r=pre[i]
    if r!=prev: last=0; prev=r
    d=int(post[i])-last; last=int(post[i])
    while True:
        b=d&0x7F; d>>=7
        out.append(b|0x80 if d else b)
        if not d: break
varint=bytes(out)
blob=b'FLY1'+struct.pack('<III',N,M,len(varint))+indptr.tobytes()+varint+sw.tobytes()
pathlib.Path('/tmp/brain_vis.bin').write_bytes(blob)
print(f"연결 {M:,}  원본 {len(blob)/1e6:.1f}MB  gzip {len(gzip.compress(blob,6))/1e6:.1f}MB")
