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
  FREEZE:   { label: "Frozen state",   sev: "high" },
  STUCK:    { label: "Stuck",          sev: "high" },
  OOB:      { label: "Out of bounds",  sev: "critical" },
  NOPROG:   { label: "No progress",    sev: "medium" },
  DOORLOCK: { label: "Door locked",    sev: "high" },
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
      `Game state did not change for 90 frames (~1.5s).`);

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
          `Confined to a ${maxx - minx}×${maxy - miny} pixel box for 300 frames.`);
    }

    // 3) 맵 이탈
    if (st.x < 0 || st.y < 0 || st.x > this.cfg.W || st.y > this.cfg.H || st.escaped)
      this.report("OOB", st, `Position (${st.x}, ${st.y}) is outside the ${this.cfg.W}×${this.cfg.H} map.`);

    // 4) 문 잠김 — 열쇠를 먹었는데 문이 계속 닫혀 있다
    if (st.hasKey && this.keyFrame < 0) this.keyFrame = st.frame;
    if (st.hasKey && !st.doorOpen && st.frame - this.keyFrame > 240)
      this.report("DOORLOCK", st,
        `Key taken ${st.frame - this.keyFrame} frames ago and the door is still shut.`);

    return this.findings;
  }

  /** 목표까지 거리 개선이 멈췄는지 (호출자가 거리를 준다) */
  progress(st, dist) {
    if (dist < this.bestDist - 2) { this.bestDist = dist; this.sinceBest = 0; }
    else if (++this.sinceBest === 1800)
      this.report("NOPROG", st, `No progress toward the goal for 1800 frames (~30s).`);
  }

  report(code, st, detail) {
    // 위치가 의미 있는 버그(끼임·맵이탈)는 위치까지 열쇠에 넣고,
    // 전역 상태 버그(문 잠김·정지·진행불가)는 코드만으로 한 번만 보고한다.
    const positional = code === "STUCK" || code === "OOB";
    const key = positional
      ? `${code}:${Math.round(st.x / 16)}:${Math.round(st.y / 16)}`
      : code;
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
      note: "Fly Worker reproduction file — feed the same seed and input sequence to reproduce this exactly.",
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
