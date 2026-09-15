"""
뉴런 3D 좌표를 굽는다. 커넥톰 주석의 pos_x/y/z 를 int16으로 양자화한다.

이 좌표는 실제 뇌에서 그 뉴런이 있던 자리다. 시각엽은 양옆, 중앙뇌는 가운데,
하행뉴런은 아래로 내려간다. 자극을 주면 신호가 실제 해부학적 경로를 따라
퍼져나가는 게 눈으로 보인다.
"""
import pandas as pd, numpy as np, struct, pathlib, gzip

a = pd.read_csv('data/raw/annotations_783.tsv', sep='\t', low_memory=False)
ids = pd.read_csv('data/raw/completeness_783.csv').iloc[:, 0].to_numpy()
N = len(ids)
idx = pd.Series(np.arange(N), index=ids)
a['ci'] = a['root_id'].map(idx)
a = a[a['ci'].notna()].copy(); a['ci'] = a['ci'].astype(int)

pos = np.zeros((N, 3), dtype=np.float64)
seen = np.zeros(N, dtype=bool)
sub = a[a['pos_x'].notna() & a['pos_y'].notna() & a['pos_z'].notna()]
pos[sub['ci'].to_numpy()] = sub[['pos_x', 'pos_y', 'pos_z']].to_numpy(float)
seen[sub['ci'].to_numpy()] = True
print(f"좌표 있는 뉴런 {seen.sum():,} / {N:,}")

# 좌표가 없는 뉴런은 무게중심에 둔다
c = pos[seen].mean(axis=0)
pos[~seen] = c

# [-1,1] 정규화 후 int16
lo, hi = pos.min(axis=0), pos.max(axis=0)
span = np.maximum(hi - lo, 1e-9)
n = (pos - lo) / span * 2 - 1
q = np.clip(n * 32767, -32767, 32767).astype(np.int16)

# 뉴런 계통(색으로 쓴다): 0 시각엽 1 중앙 2 감각 3 하행 4 시각투사 5 기타
grp = np.full(N, 5, dtype=np.uint8)
m = {'optic':0, 'central':1, 'sensory':2, 'descending':3, 'visual_projection':4}
for k, v in m.items():
    sel = a.loc[a['super_class'] == k, 'ci'].to_numpy()
    grp[sel] = v

blob = b'FPOS' + struct.pack('<I', N) + q.tobytes() + grp.tobytes()
p = pathlib.Path('docs/data/pos.bin'); p.write_bytes(blob)
print(f"pos.bin {len(blob)/1e6:.2f} MB  (gzip {len(gzip.compress(blob,9))/1e6:.2f} MB)")
for k, v in m.items():
    print(f"  {k:20} {(grp==v).sum():>7,}")
print(f"  {'기타':20} {(grp==5).sum():>7,}")
