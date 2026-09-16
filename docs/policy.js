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
    note: "The connectome's steering with smoothed noise on top. Measured against the same noise alone.",
    make: () => {
      let n = 0, t = 0.7;
      return (flySteer = 0) => {
        n += (Math.random() * 2 - 1 - n) * 0.08;
        t += ((0.35 + Math.random() * 0.65) - t) * 0.05;
        return [Math.max(-1, Math.min(1, flySteer * 0.6 + n * 3 * 0.4)), t];
      };
    },
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
  { id: "fly",      reps: 3, pct: 42, range: "35–50", kinds: "2.7", types: "STUCK, OOB, NOPROG, DOORLOCK" },
  { id: "smooth",   reps: 5, pct: 61, range: "57–66", kinds: "3.2", types: "all five" },
  { id: "uniform",  reps: 5, pct: 50, range: "46–52", kinds: "3.6", types: "STUCK, OOB, DOORLOCK, FREEZE" },
  { id: "straight", reps: 3, pct: 5,  range: "5–5",   kinds: "1.0", types: "FREEZE only" },
];
