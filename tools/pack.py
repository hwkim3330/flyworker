"""
초파리 직원 — 커넥톰을 브라우저용 압축 포맷으로 굽는다.

FlyWire v783 (CC-BY 4.0) 연결성 15.1M쌍 중 시냅스 5개 이상만 남겨
CSR(Compressed Sparse Row)로 만들고, 행 안에서 대상 인덱스를 델타+varint로 줄인다.

출력  docs/data/brain.bin  (gzip은 서버가 담당)
  [0:4]   magic 'FLY1'
  [4:8]   uint32 N   뉴런 수
  [8:12]  uint32 M   연결 수
  [12:16] uint32 varint 영역 바이트 수
  이어서  uint32[N+1] indptr
         varint[...] 델타 인코딩된 대상 인덱스
         int16[M]    부호 있는 가중치 (음수=억제)
"""
import pyarrow.parquet as pq, numpy as np, struct, gzip, pathlib

TH = 5
N = 138639

t = pq.read_table('data/raw/connectivity_783.parquet',
                  columns=['Presynaptic_Index','Postsynaptic_Index','Connectivity','Excitatory'])
pre = t['Presynaptic_Index'].to_numpy()
post = t['Postsynaptic_Index'].to_numpy()
w = t['Connectivity'].to_numpy()
exc = t['Excitatory'].to_numpy()

m = w >= TH
pre, post, w, exc = pre[m], post[m], w[m], exc[m]
sw = (w * np.sign(exc)).astype(np.int32)
sw = np.clip(sw, -32768, 32767).astype(np.int16)
M = len(pre)
print(f"가지치기 후 연결 {M:,}")

# pre 기준 정렬, 행 안에서는 post 오름차순 (델타 인코딩을 위해)
order = np.lexsort((post, pre))
pre, post, sw = pre[order], post[order], sw[order]

indptr = np.zeros(N + 1, dtype=np.uint32)
np.add.at(indptr, pre + 1, 1)
np.cumsum(indptr, out=indptr)

# 행 안 델타 → varint(LEB128)
out = bytearray()
prev_row = -1
last = 0
for i in range(M):
    r = pre[i]
    if r != prev_row:
        last = 0
        prev_row = r
    d = int(post[i]) - last
    last = int(post[i])
    while True:
        b = d & 0x7F
        d >>= 7
        if d:
            out.append(b | 0x80)
        else:
            out.append(b)
            break
varint = bytes(out)
print(f"varint 영역 {len(varint)/1e6:.2f} MB  (평균 {len(varint)/M:.2f} B/연결)")

blob = (b'FLY1' + struct.pack('<III', N, M, len(varint))
        + indptr.tobytes() + varint + sw.tobytes())
p = pathlib.Path('docs/data/brain.bin'); p.write_bytes(blob)
gz = gzip.compress(blob, 9)
pathlib.Path('docs/data/brain.bin.gz').write_bytes(gz)
print(f"원본 {len(blob)/1e6:.2f} MB  →  gzip {len(gz)/1e6:.2f} MB")

# 단순 uint32 방식과 비교
naive = 4*(N+1) + 4*M + 2*M
print(f"(참고) 델타 없이 uint32였다면 {naive/1e6:.2f} MB")
