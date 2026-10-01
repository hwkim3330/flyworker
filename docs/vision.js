/**
 * 초파리 직원 — 시야 전처리
 *
 * 왜 이게 필요한가:
 * 커넥톰 뇌의 좌우 판별 민감도를 실측해 보니, 전체 밝기가 낮으면 신호가
 * 잡음에 묻힌다.
 *
 *   평균 밝기 0.25 → 좌우 신호 변화폭 0.073, 잡음 0.080  (구분 불가)
 *   평균 밝기 0.50 → 좌우 신호 변화폭 0.439, 잡음 0.080  (잡음의 5배)
 *
 * 그래서 (1) 중심 밝기를 뇌가 잘 듣는 구간으로 올리고,
 * (2) 좌우 평균 차이를 증폭한다.
 *
 * (2)는 실제 초파리 시각계가 하는 일이기도 하다. 라미나의 측면억제와
 * 좌우 시각엽 사이의 상호억제가 방향 차이를 키우는 쪽으로 작동한다.
 */
const CENTER = 0.5;      // 뇌가 가장 민감한 밝기
const CONTRAST = 1.6;    // 국소 대비 이득
const LR_GAIN = 3.2;     // 좌우 비대칭 이득
const SQUASH = 3.2;      // 부드러운 포화 기울기

/** 0~1로 부드럽게 눌러 담는다. 하드 클램프와 달리 증폭분이 잘려 나가지 않는다. */
const squash = (x) => 1 / (1 + Math.exp(-(x - CENTER) * SQUASH * 2));

export function normalizeField(out, gw, gh) {
  const half = gw >> 1;

  // 1) 좌우 평균 차이를 먼저 키운다 (클램프 전에 해야 증폭이 살아남는다)
  let sl = 0, sr = 0, nl = 0, nr = 0;
  for (let y = 0; y < gh; y++)
    for (let x = 0; x < gw; x++) {
      if (x < half) { sl += out[y * gw + x]; nl++; }
      else { sr += out[y * gw + x]; nr++; }
    }
  const ml = nl ? sl / nl : 0, mr = nr ? sr / nr : 0;
  const mid = (ml + mr) / 2;
  const dl = (ml - mid) * (LR_GAIN - 1), dr = (mr - mid) * (LR_GAIN - 1);

  // 2) 국소 대비를 펼치고 중심을 뇌의 민감 구간으로 옮긴 뒤, 부드럽게 포화시킨다
  let mean = 0;
  for (let i = 0; i < out.length; i++) mean += out[i];
  mean /= out.length;
  for (let y = 0; y < gh; y++)
    for (let x = 0; x < gw; x++) {
      const i = y * gw + x;
      out[i] = squash(CENTER + (out[i] - mean) * CONTRAST + (x < half ? dl : dr));
    }
  return out;
}

/**
 * 장면 서명 — "이 뷰를 전에 본 적 있나"를 물을 수 있는 짧은 열쇠.
 *
 * 온라인 학습의 보상으로 쓴다. 왜 좌표가 아니라 뷰인가:
 *
 * 이 프레임워크의 요지는 "남의 게임에 붙는다"이다. 남의 게임에서는 주인공의
 * 좌표를 모른다. 픽셀밖에 없다. 그래서 초파리가 실제로 가질 수 있는 것,
 * 즉 자기 눈에 들어온 장면만으로 보상을 만든다. 처음 보는 장면이면 1, 아니면 0.
 *
 * 부수 효과가 하나 더 있는데 이게 더 중요하다 — 우리가 표에 싣는 지표(탐색률)를
 * 직접 최적화하지 않게 된다. 보상이 지표 자체면 "학습이 이겼다"가 동어반복이
 * 되어버린다. 장면 신기성은 탐색률의 대리지 탐색률이 아니다.
 *
 * 4×3 블록의 평균을 전체 평균 기준으로 이진화해 12비트(4,096가지)로 만든다.
 * 더 잘게 쪼개면 거의 모든 프레임이 '처음'이 되어 신호가 사라진다.
 */
export function viewKey(f, gw, gh) {
  let mean = 0;
  for (let i = 0; i < f.length; i++) mean += f[i];
  mean /= f.length;
  let key = 0;
  for (let by = 0; by < 3; by++) for (let bx = 0; bx < 4; bx++) {
    const x0 = (bx * gw / 4) | 0, x1 = ((bx + 1) * gw / 4) | 0;
    const y0 = (by * gh / 3) | 0, y1 = ((by + 1) * gh / 3) | 0;
    let s = 0, n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { s += f[y * gw + x]; n++; }
    key = (key << 1) | (n && s / n > mean ? 1 : 0);
  }
  return key;
}
