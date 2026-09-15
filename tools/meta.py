"""
초파리 직원 — 뉴런 역할 + 망막위상 좌표를 굽는다.

시각 입력은 광수용체(R1-6)가 아니라 라미나→수질(LA>ME) 뉴런에 넣는다.
FlyWire 데이터셋은 망막·라미나를 완전히 담지 못해 광수용체의 출력 연결이
평균 1.7개뿐이지만(전체 평균 19.5), LA>ME는 13개로 온전하다.
생물학적으로도 L1~L5가 R1-6에게서 신호를 받는 첫 중계소다.

시각엽은 망막위상 구조라 뉴런의 (x,y) 위치가 곧 시야의 위치다.
좌/우 눈을 각각 [0,1]²로 정규화해 화면 픽셀과 대응시킨다.
"""
import pandas as pd, numpy as np, json, pathlib

a = pd.read_csv('data/raw/annotations_783.tsv', sep='\t', low_memory=False)
ids = pd.read_csv('data/raw/completeness_783.csv').iloc[:, 0].to_numpy()
idx = pd.Series(np.arange(len(ids)), index=ids)
a['ci'] = a['root_id'].map(idx)
a = a[a['ci'].notna()].copy()
a['ci'] = a['ci'].astype(int)
ct = a['cell_type'].astype(str)

def retinotopic(sub):
    """뉴런 묶음을 [0,1]² 좌표와 함께 돌려준다"""
    out = {}
    for s in ('left', 'right'):
        m = sub[(sub['side'] == s) & sub['pos_x'].notna() & sub['pos_y'].notna()]
        if not len(m): continue
        x, y = m['pos_x'].to_numpy(float), m['pos_y'].to_numpy(float)
        u = (x - x.min()) / max(1e-9, x.max() - x.min())
        v = (y - y.min()) / max(1e-9, y.max() - y.min())
        # 왼쪽 눈은 x가 뒤집혀 있어 시야 방향을 맞춘다
        if s == 'left': u = 1.0 - u
        out[s] = {
            "ci": m['ci'].tolist(),
            "u": [round(float(t), 4) for t in u],
            "v": [round(float(t), 4) for t in v],
        }
    return out

optic = a[a['super_class'] == 'optic']
lame = optic[optic['cell_class'] == 'LA>ME']          # 라미나 → 수질
me   = optic[optic['cell_class'] == 'ME']             # 수질 내재

MOTOR = {
    "DNa01":  ("조향 (회전)", "turn"),
    "DNa02":  ("조향 (회전)", "turn"),
    "MDN":    ("문워커 — 후진 보행", "back"),
    "DNp01":  ("거대섬유 — 도피 점프", "jump"),
    "DNp09":  ("정지 / 프리즈", "stop"),
    "DNp07":  ("회피 반응", "jump"),
    "DNp10":  ("회피 반응", "jump"),
    "DNp18":  ("회피 반응", "jump"),
    "DNb02":  ("보행 조절", "walk"),
    "DNg100": ("보행 조절", "walk"),
}
side = a.set_index('ci')['side']
motor = {}
for name, (label, role) in MOTOR.items():
    cis = sorted(a.loc[ct.str.fullmatch(name, case=False, na=False), 'ci'].tolist())
    if not cis: continue
    motor[name] = {
        "label": label, "role": role, "all": cis,
        "left":  [i for i in cis if side.get(i) == 'left'],
        "right": [i for i in cis if side.get(i) == 'right'],
    }

dn = a[a['super_class'] == 'descending']
vpn = a[a['super_class'] == 'visual_projection']

meta = {
    "source": "FlyWire v783 커넥톰 (CC-BY 4.0) · 뉴런 주석 Schlegel et al. (CC-BY 4.0)",
    "nNeurons": int(len(ids)),
    "eye": retinotopic(lame),                       # 시각 입력 (망막위상)
    "medulla": {s: v["ci"] for s, v in retinotopic(me).items()},
    "motor": motor,
    "descendingAll": sorted(dn['ci'].tolist()),
    "visualProjection": sorted(vpn['ci'].tolist()),
}
p = pathlib.Path('docs/data/meta.json')
p.write_text(json.dumps(meta, separators=(',', ':')))
print(f"meta.json {p.stat().st_size/1e6:.2f} MB")
for s, v in meta["eye"].items():
    print(f"  눈({s}) LA>ME {len(v['ci']):,}개  u,v 좌표 포함")
print(f"  수질 좌 {len(meta['medulla'].get('left',[])):,} / 우 {len(meta['medulla'].get('right',[])):,}")
print(f"  하행뉴런 {len(meta['descendingAll']):,}  시각투사 {len(meta['visualProjection']):,}")
print(f"  이름 붙은 운동뉴런 {len(motor)}종")

# ── 시각 경로 상세 (ON/OFF · 운동검출 · 광류적분) ─────────────
# 초파리 시각계는 밝기가 아니라 시간 변화를 읽는다.
#   L1 = ON 경로(밝아짐), L2 = OFF 경로(어두워짐)
#   T4(ON)/T5(OFF) 가 방향성 운동을 계산하고
#   HS(수평계) 가 광류를 적분해 몸통 회전을 만든다 — 광학운동반응
def retino_of(name):
    sub = a[ct.str.fullmatch(name, case=False, na=False)]
    return retinotopic(sub)

pathway = {
    "L1": retino_of("L1"),          # ON
    "L2": retino_of("L2"),          # OFF
}
def by_types(pat):
    sub = a[ct.str.match(pat, case=False, na=False)]
    return {s: sorted(sub.loc[sub['side'] == s, 'ci'].tolist()) for s in ('left', 'right')}

motion = {
    "T4": by_types(r'^T4[a-d]$'),
    "T5": by_types(r'^T5[a-d]$'),
}
# 광류 적분 — 조향의 생물학적 근원
lptc = {}
for name in ["HSN", "HSE", "HSS", "VS1", "VS2", "VS3", "H2"]:
    cis = sorted(a.loc[ct.str.fullmatch(name, case=False, na=False), 'ci'].tolist())
    if not cis: continue
    lptc[name] = {
        "left":  [i for i in cis if side.get(i) == 'left'],
        "right": [i for i in cis if side.get(i) == 'right'],
    }

meta["pathway"] = pathway
meta["motion"] = motion
meta["lptc"] = lptc
p.write_text(json.dumps(meta, separators=(',', ':')))
print(f"\nmeta.json {p.stat().st_size/1e6:.2f} MB (시각 경로 추가)")
for k, v in pathway.items():
    print(f"  {k}: 좌 {len(v.get('left',{}).get('ci',[])):>5} / 우 {len(v.get('right',{}).get('ci',[])):>5}")
for k, v in motion.items():
    print(f"  {k}: 좌 {len(v['left']):>5} / 우 {len(v['right']):>5}")
print("  LPTC:", {k: f"좌{len(v['left'])}/우{len(v['right'])}" for k, v in lptc.items()})
