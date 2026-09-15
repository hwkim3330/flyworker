/**
 * 초파리 직원 — 수습 교육 (캘리브레이션)
 *
 * 개체마다 어떤 하행뉴런이 "왼쪽 시야"에 반응하고 어떤 뉴런이 "오른쪽 시야"에
 * 반응하는지는 미리 알 수 없다. DNa01/DNa02 같은 이름 붙은 조향 뉴런은
 * 좌우 각 1개뿐이라 표본이 너무 작아 신호가 안 잡힌다.
 *
 * 그래서 고용 직후 좌/우 눈에 번갈아 빛을 비춰 차등 반응하는 하행뉴런을
 * 골라낸다. 이것이 그 개체의 조향 채널이 된다. 집단 부호화다.
 */

/**
 * @param {import('./lif.js').Brain} brain
 * @param {{left:{ci:number[]}, right:{ci:number[]}}} eye  좌/우 눈 (meta.eye 형태)
 * @param {number[]} dn  하행뉴런 인덱스
 * @param {{steps?:number, hz?:number, top?:number, minDiff?:number, onProgress?:Function}} opt
 */
export async function calibrate(brain, eye, dn, opt = {}) {
  const steps = opt.steps ?? 1200;
  const hz = opt.hz ?? 150;
  const top = opt.top ?? 20;
  const minDiff = opt.minDiff ?? 3;      // Hz
  const prog = opt.onProgress;

  // meta.eye 는 {left:{ci,u,v}, right:{...}} 형태다. 배열로 착각하면 조용히 빈 배열이 되어
  // 자극이 하나도 안 들어가고 조향 채널이 0개가 된다.
  const pick = (o) => Uint32Array.from(Array.isArray(o) ? o : (o?.ci ?? []));
  const L = pick(eye.left);
  const R = pick(eye.right);
  if (!L.length || !R.length) throw new Error("눈 뉴런 목록이 비어 있습니다");
  const onesL = new Float32Array(L.length).fill(1);
  const onesR = new Float32Array(R.length).fill(1);

  const run = async (which) => {
    brain.reset();
    if (which === "L") brain.setDrive(L, onesL, hz);
    else brain.setDrive(R, onesR, hz);
    for (let t = 0; t < steps; t++) {
      brain.step();
      if (prog && (t & 255) === 255) {
        prog(which, t / steps);
        await Promise.resolve();          // 워커가 멈춰 보이지 않게 양보
      }
    }
    return dn.map((i) => brain.rate[i] * 1000 / brain.dt);   // Hz
  };

  const onlyL = await run("L");
  const onlyR = await run("R");

  const scored = dn.map((ci, k) => ({ ci, diff: onlyL[k] - onlyR[k] }));
  scored.sort((a, b) => b.diff - a.diff);

  const leftCh = scored.filter((s) => s.diff > minDiff).slice(0, top).map((s) => s.ci);
  const rightCh = scored.filter((s) => s.diff < -minDiff).slice(-top).map((s) => s.ci);

  // 활동적인 하행뉴런 (버튼 채널 후보)
  const active = dn.filter((ci, k) => Math.max(onlyL[k], onlyR[k]) > 1);

  brain.reset();
  return {
    leftCh, rightCh, active,
    quality: leftCh.length >= 5 && rightCh.length >= 5 ? "good" : "weak",
    span: scored.length ? Math.round(scored[0].diff - scored[scored.length - 1].diff) : 0,
  };
}

/**
 * 조향 편향을 -1(좌) ~ +1(우)로 돌려준다.
 */
export function steering(brain, cal) {
  const l = brain.groupHz(cal.leftCh);
  const r = brain.groupHz(cal.rightCh);
  const s = l + r;
  return s < 1e-6 ? 0 : (r - l) / s;
}
