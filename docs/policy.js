/**
 * 정책 엔진 — 무엇이 게임을 조종하는가.
 *
 * 이 도구의 본체는 QA 프레임워크다. 화면을 읽고, 입력을 넣고, 증상을 찾고,
 * 입력열을 저장해 재현한다. 무엇이 입력을 만드는지는 갈아 끼울 수 있다.
 *
 * 그래서 초파리 커넥톰이 난수보다 나은지 같은 조건에서 잴 수 있다.
 * 실측값은 아래 MEASURED 에 있고 `node policy_bench.mjs` 로 재현된다.
 *
 * 초파리가 진다. 그 결과를 그대로 싣는다.
 * 그리고 "버그 수"는 가짜 지표다 — 직진만 하면 같은 버그를 95번 찾는다.
 *
 * 정책 함수는 (flySteer, flyThrust) 를 받는다. 대부분 무시하지만,
 * 섞은 정책은 커넥톰 출력 위에 난수를 얹어야 하므로 필요하다.
 */

export const POLICIES = {
  fly: {
    label: "Fly connectome",
    note: "138,639 neurons. Steering is the left/right imbalance of descending neurons.",
    make: () => null,          // 워커가 계산한다
  },
  smooth: {
    label: "Smoothed noise",
    note: "Random walk with momentum. Measured best: 5 of 5 symptom types found.",
    make: () => {
      let s = 0, t = 0.7;
      return () => {
        s += (Math.random() * 2 - 1 - s) * 0.08;
        t += ((0.35 + Math.random() * 0.65) - t) * 0.05;
        return [Math.max(-1, Math.min(1, s * 3)), t];
      };
    },
  },
  /**
   * 섞은 정책 — 커넥톰 조향에 평활 난수를 얹는다.
   *
   * 초파리가 단독으로 지는 것은 쟀다. 그러면 남는 질문은 하나다 —
   * 커넥톰이 난수 위에 무언가를 보태는가? 프레임워크가 정책을 갈아끼울 수
   * 있으니 이건 의견이 아니라 측정으로 답할 수 있다.
   * 벤치에는 같은 난수열을 쓰는 대조군(초파리 항만 뺀 것)이 있다.
   */
  hybrid: {
    label: "Fly + noise",
    note: "The connectome's steering with smoothed noise on top. Against the identical noise sequence alone it gains +11.4%p over 12 paired runs (t = 4.63) — but a fly watching a completely different board does just as well (−3.2%p, t = 0.98). What the connectome supplies is steering amplitude and temporal structure, not information about what is on screen.",
    make: () => {
      let n = 0, t = 0.7;
      return (flySteer = 0) => {
        n += (Math.random() * 2 - 1 - n) * 0.08;
        t += ((0.35 + Math.random() * 0.65) - t) * 0.05;
        return [Math.max(-1, Math.min(1, flySteer * 0.6 + n * 3 * 0.4)), t];
      };
    },
  },
  /**
   * 온라인 학습 정책 — 커넥톰은 특징을 주고, 판독은 판에서 배운다.
   *
   * 지금까지 초파리 정책의 조향은 손으로 짠 판독이었다. 좌/우 채널의 불균형을
   * 재서 방향으로 바꾸는 식이다. 그 판독이 이 게임에 맞는다는 보장은 없다.
   * 커넥톰은 배선을 줄 뿐, 어느 배선이 이 판에서 쓸모 있는지는 말해주지 않는다.
   *
   * 그래서 판독을 고정하지 않고 판에서 민다. 조향 채널 하행뉴런의 발화율을
   * 특징으로 쓰고 그 위에 선형 가중치를 얹는다. 섭동을 섞어 보고, 그 섭동이
   * 처음 보는 장면으로 데려갔으면 그 방향으로 민다. 계산은 워커 안
   * (fly.worker.js)에서 한다 — 뇌가 거기 있기 때문이다.
   *
   * 뇌는 건드리지 않는다. 배우는 것은 판독 층뿐이다. 다만 이 정책은
   * "보정 없음" 원칙을 깨는 쪽이라 따로 두고, 같은 예산에서 재서 표에 싣는다.
   */
  learn: {
    label: "Fly + online learning",
    note: "The connectome supplies the features; the readout is learned on the board from whether a move brought a view the fly had not seen. The brain is untouched. Against the identical perturbation sequence with the learning rate set to zero: +13.1%p coverage over 12 paired runs (t = 3.15, df 11). Learning is real here — but it still does not reach the fly's own hand-written readout, let alone smoothed noise.",
    make: () => null,          // 워커가 계산한다
  },
  /**
   * 눈을 가린 초파리 — 뇌에는 '다른 판'을 보여주고 그 출력으로 지금 판을 몬다.
   *
   * 섞은 정책이 짝 대조군을 +11.4%p 로 이겼을 때, 그게 커넥톰의 정보 때문인지
   * 조향 진폭이 커서인지 구분할 방법이 없었다. 이 정책은 진폭·시간 구조·통계를
   * 전부 맞추고 화면과의 관련성만 없앤다. 결과는 −3.2%p (t=0.98) — 구분되지 않는다.
   *
   * 이 한 줄이 이 프로젝트에서 가장 중요한 측정이다. 이게 없었으면
   * "커넥톰이 난수를 이긴다"를 발표했을 것이다.
   */
  mismatch: {
    label: "Blindfolded fly",
    note: "Identical to Fly + noise, except the brain is shown a different board entirely. Same amplitude, same temporal structure, no relationship to the screen. It scores 66% against the seeing fly's 63% — indistinguishable (t = 0.98). The connectome's view of the screen contributes nothing.",
    make: () => null,          // 조향은 워커가, 엉뚱한 판은 app.js 가 만든다
  },
  uniform: {
    label: "Uniform noise",
    note: "Independent random input every frame. Widest coverage, fewer symptom types.",
    make: () => () => [Math.random() * 2 - 1, 0.35 + Math.random() * 0.65],
  },
  straight: {
    label: "Straight ahead",
    note: "A control. Finds the most findings by count — all 95 of them the same freeze.",
    make: () => () => [0, 0.8],
  },
};

/**
 * 측정값 — 24,000프레임 예산, 연구실 게임, 같은 감지기.
 *
 * 한 번만 돌린 숫자는 싣지 않는다. 난수 정책은 회차 편차가 커서(한 번은 55%,
 * 다음은 78%) 단일 측정값을 표에 박으면 다시 돌렸을 때 다른 값이 나온다.
 * 그래서 난수를 시드로 고정하고 회차를 나눠 평균과 범위를 낸다.
 * `node policy_bench.mjs` 로 그대로 재현된다.
 */
export const MEASURED = [
  { id: "fly",      reps: 3, pct: 50, range: "40–55", kinds: "2.0", types: "OOB, STUCK" },
  { id: "hybrid",   reps: 3, pct: 62, range: "51–74", kinds: "3.3", types: "all five" },
  { id: "mismatch", reps: 3, pct: 66, range: "55–74", kinds: "3.3", types: "all five" },
  { id: "learn",    reps: 3, pct: 33, range: "24–48", kinds: "3.3", types: "STUCK, OOB, DOORLOCK, NOPROG" },
  { id: "smooth",   reps: 3, pct: 63, range: "59–66", kinds: "3.3", types: "all five" },
  { id: "uniform",  reps: 3, pct: 49, range: "46–52", kinds: "3.7", types: "STUCK, OOB, DOORLOCK, FREEZE" },
  { id: "straight", reps: 3, pct: 5,  range: "5–5",   kinds: "1.0", types: "FREEZE only" },
];
