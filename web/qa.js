/**
 * 초파리 직원 — QA 감지기
 *
 * 버그가 어디 심겼는지 모른다. 증상만 본다. 전부 결정적 규칙이고 AI가 없다.
 * 초파리는 "어디를 두들길지"를 정하고, 무엇이 깨졌는지 판정하는 건 이쪽이다.
 *
 * 재현: 게임이 (시드 + 입력열)에 대해 결정적이므로 입력열만 저장하면
 * 100% 똑같이 되살릴 수 있다. 실제 QA에서 가장 괴로운 "재현 안 되는 버그"가
 * 에뮬레이션·시뮬레이션 기반에서는 구조적으로 사라진다.
 */

const RULES = {
  FREEZE:   { label: "화면 정지",   sev: "high" },
  STUCK:    { label: "끼임",       sev: "high" },
  OOB:      { label: "맵 이탈",     sev: "critical" },
  NOPROG:   { label: "진행 불가",   sev: "medium" },
  DOORLOCK: { label: "문 잠김",     sev: "high" },
};

export class QA {
  /**
   * @param {{seed:number, W:number, H:number}} cfg
   */
  constructor(cfg) {
    this.cfg = cfg;
    this.reset();
  }

  reset() {
    this.inputs = [];          // [steer, thrust] 기록 — 재현용
    this.hist = [];            // 최근 상태
    this.findings = [];
    this.seen = new Set();     // 같은 버그를 반복 보고하지 않기 위해
    this.sameState = 0;
    this.lastHash = "";
    this.bestDist = Infinity;
    this.sinceBest = 0;
    this.keyFrame = -1;
  }

  /** 매 프레임 호출 */
  observe(st, steer, thrust) {
    // 반올림하지 않는다. 1500프레임쯤 누적되면 1픽셀씩 어긋나
    // "100% 재현"이라는 이 도구의 핵심 주장이 깨진다.
    this.inputs.push([steer, thrust]);
    this.hist.push([st.x, st.y]);
    if (this.hist.length > 900) this.hist.shift();

    const hash = `${st.x},${st.y},${st.a},${st.hasKey},${st.doorOpen}`;
    if (hash === this.lastHash) this.sameState++; else { this.sameState = 0; this.lastHash = hash; }

    // 1) 화면/상태 정지
    if (this.sameState === 90) this.report("FREEZE", st,
      `상태가 90프레임(약 1.5초) 동안 전혀 바뀌지 않았습니다.`);

    // 2) 끼임 — 300프레임 동안 반경 6px 안에서만 맴돈다
    if (this.hist.length >= 300) {
      const w = this.hist.slice(-300);
      let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
      for (const [x, y] of w) {
        if (x < minx) minx = x; if (x > maxx) maxx = x;
        if (y < miny) miny = y; if (y > maxy) maxy = y;
      }
      if (maxx - minx <= 6 && maxy - miny <= 6 && this.sameState < 90)
        this.report("STUCK", st,
          `300프레임 동안 ${maxx - minx}×${maxy - miny}픽셀 범위를 벗어나지 못했습니다.`);
    }

    // 3) 맵 이탈
    if (st.x < 0 || st.y < 0 || st.x > this.cfg.W || st.y > this.cfg.H || st.escaped)
      this.report("OOB", st, `좌표 (${st.x}, ${st.y})는 맵(${this.cfg.W}×${this.cfg.H}) 밖입니다.`);

    // 4) 문 잠김 — 열쇠를 먹었는데 문이 계속 닫혀 있다
    if (st.hasKey && this.keyFrame < 0) this.keyFrame = st.frame;
    if (st.hasKey && !st.doorOpen && st.frame - this.keyFrame > 240)
      this.report("DOORLOCK", st,
        `열쇠 획득 후 ${st.frame - this.keyFrame}프레임이 지났는데 문이 열리지 않았습니다.`);

    return this.findings;
  }

  /** 목표까지 거리 개선이 멈췄는지 (호출자가 거리를 준다) */
  progress(st, dist) {
    if (dist < this.bestDist - 2) { this.bestDist = dist; this.sinceBest = 0; }
    else if (++this.sinceBest === 1800)
      this.report("NOPROG", st, `1800프레임(약 30초) 동안 목표에 더 가까워지지 못했습니다.`);
  }

  report(code, st, detail) {
    const key = `${code}:${Math.round(st.x / 16)}:${Math.round(st.y / 16)}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    const r = RULES[code];
    this.findings.push({
      code, label: r.label, sev: r.sev, detail,
      frame: st.frame, at: { x: st.x, y: st.y },
      repro: { seed: this.cfg.seed, frames: st.frame, inputs: this.inputs.slice(0, st.frame) },
      ts: Date.now(),
    });
  }

  /** 재현 파일 (JSON) */
  static reproBlob(f) {
    return new Blob([JSON.stringify({
      note: "초파리 직원 재현 파일 — 같은 시드와 입력열을 그대로 먹이면 100% 재현됩니다.",
      code: f.code, label: f.label, detail: f.detail,
      frame: f.frame, at: f.at, seed: f.repro.seed,
      inputs: f.repro.inputs,
    }, null, 1)], { type: "application/json" });
  }
}

/** 기록된 입력열을 그대로 다시 먹여 버그를 재현한다 */
export function replay(Game, repro, onFrame) {
  const g = new Game(repro.seed);
  for (let i = 0; i < repro.inputs.length; i++) {
    const [s, t] = repro.inputs[i];
    g.step(s, t);
    if (onFrame) onFrame(g, i);
  }
  return g;
}
