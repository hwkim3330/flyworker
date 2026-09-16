/**
 * 정책 엔진 — 무엇이 게임을 조종하는가.
 *
 * 이 도구의 본체는 QA 프레임워크다. 화면을 읽고, 입력을 넣고, 증상을 찾고,
 * 입력열을 저장해 재현한다. 무엇이 입력을 만드는지는 갈아 끼울 수 있다.
 *
 * 그래서 초파리 커넥톰이 난수보다 나은지 같은 조건에서 잴 수 있다.
 * 실측 결과 — 24,000프레임 예산, 연구실 게임:
 *
 *   정책          탐색률   찾은 증상 종류
 *   초파리 커넥톰    35%    2종
 *   균등 난수       58%    3종
 *   평활 난수       55%    5종 (전부)
 *   직진만          5%    1종
 *
 * 초파리가 진다. 그 결과를 그대로 싣는다.
 * 그리고 "버그 수"는 가짜 지표다 — 직진만 하면 같은 버그를 95번 찾는다.
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
  uniform: {
    label: "Uniform noise",
    note: "Independent random input every frame. Widest coverage, fewer symptom types.",
    make: () => () => [Math.random() * 2 - 1, 0.35 + Math.random() * 0.65],
  },
  straight: {
    label: "Straight ahead",
    note: "A control. Finds the most bugs by count — all 95 of them the same one.",
    make: () => () => [0, 0.8],
  },
};

/** 측정값 — 24,000프레임 예산, 연구실 게임 */
export const MEASURED = [
  { id: "fly",      runs: 60, cells: 77,  pct: 35, bugs: 59, kinds: 2, types: "STUCK, OOB" },
  { id: "smooth",   runs: 36, cells: 122, pct: 55, bugs: 38, kinds: 5, types: "all five" },
  { id: "uniform",  runs: 29, cells: 129, pct: 58, bugs: 34, kinds: 3, types: "STUCK, OOB, DOORLOCK" },
  { id: "straight", runs: 96, cells: 11,  pct: 5,  bugs: 95, kinds: 1, types: "FREEZE only" },
];
