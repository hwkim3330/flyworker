/**
 * 초파리 직원 — 테스트용 게임 「빛 찾기」
 *
 * 위에서 내려다본 미로. 초파리는 빛(노란 원)을 향해 간다.
 * 실제 초파리가 빛에 이끌리는 주광성(phototaxis)을 그대로 쓴다.
 *
 * QA 데모를 위해 버그 4개를 일부러 심어뒀다. 어디에 심었는지는
 * BUGS 에 적어두되, 감지기는 이 정보를 보지 않고 증상만으로 찾아낸다.
 */

export const BUGS = {
  B1: { name: "모서리 끼임", desc: "특정 모서리에서 충돌 처리가 어긋나 빠져나올 수 없다" },
  B2: { name: "렌더 정지", desc: "특정 구역에 들어가면 화면 갱신이 멈춘다" },
  B3: { name: "맵 이탈", desc: "특정 각도로 벽에 닿으면 벽을 통과해 맵 밖으로 나간다" },
  B4: { name: "문 잠김", desc: "열쇠를 먹어도 일정 확률로 문이 열리지 않는다" },
};

const W = 320, H = 240;
const TILE = 20;
const MAP = [
  "####################",
  "#........#.........#",
  "#.####...#...####..#",
  "#.#..#...#...#..#..#",
  "#.#..#.......#..#..#",
  "#.#..#####D###..#..#",
  "#.#.............#..#",
  "#.#####.#####...#..#",
  "#.......#.......#..#",
  "#.#######.#######..#",
  "#..................#",
  "####################",
];

export class Game {
  constructor(seed = 1) {
    this.W = W; this.H = H;
    this.rng = mulberry(seed);
    this.reset();
  }

  reset() {
    this.x = 30; this.y = 30; this.a = 0;
    this.frame = 0;
    this.hasKey = false;
    this.doorOpen = false;
    this.frozen = 0;
    this.escaped = false;
    this.won = false;
    this.key = { x: 160, y: 40 };
    this.goal = { x: 290, y: 210 };
    this.trail = [];
  }

  /** 벽인가 */
  solid(px, py) {
    const c = Math.floor(px / TILE), r = Math.floor(py / TILE);
    if (r < 0 || r >= MAP.length || c < 0 || c >= MAP[0].length) return true;
    const ch = MAP[r][c];
    if (ch === "#") return true;
    if (ch === "D") return !this.doorOpen;
    return false;
  }

  /**
   * @param {number} steer  -1(좌) ~ +1(우)
   * @param {number} thrust 0~1 전진
   */
  step(steer, thrust) {
    this.frame++;
    if (this.escaped || this.won) return;

    // [B2] 렌더 정지 — 특정 구역에 들어가면 화면이 멈춘다
    if (this.x > 200 && this.x < 230 && this.y > 150 && this.y < 175) {
      this.frozen++;
      if (this.frozen > 6) return;       // 이 지점부터 상태가 갱신되지 않는다
    } else this.frozen = 0;

    this.a += steer * 0.09;
    const sp = 1.15 * Math.max(0, Math.min(1, thrust));
    const nx = this.x + Math.cos(this.a) * sp;
    const ny = this.y + Math.sin(this.a) * sp;

    // [B3] 맵 이탈 — 거의 수직으로 벽에 닿으면 통과해 버린다
    const steep = Math.abs(Math.cos(this.a)) < 0.08;
    if (steep && this.solid(nx, ny)) {
      this.x = nx; this.y = ny;                    // 벽을 그냥 통과
      if (nx < 0 || ny < 0 || nx > W || ny > H) this.escaped = true;
    } else {
      // [B1] 모서리 끼임 — 이 모서리에서는 x,y를 둘 다 막아 버린다
      const corner = this.x > 120 && this.x < 145 && this.y > 95 && this.y < 120;
      if (corner && this.solid(nx, ny)) {
        /* 아무 축도 풀어주지 않는다 → 영원히 갇힌다 */
      } else {
        if (!this.solid(nx, this.y)) this.x = nx;
        if (!this.solid(this.x, ny)) this.y = ny;
      }
    }

    if (!this.hasKey && Math.hypot(this.x - this.key.x, this.y - this.key.y) < 10) {
      this.hasKey = true;
      // [B4] 문 잠김 — 열쇠를 먹어도 30% 확률로 문이 안 열린다
      this.doorOpen = this.rng() > 0.3;
    }
    if (Math.hypot(this.x - this.goal.x, this.y - this.goal.y) < 12) this.won = true;

    this.trail.push([this.x | 0, this.y | 0]);
    if (this.trail.length > 400) this.trail.shift();
  }

  draw(ctx) {
    ctx.fillStyle = "#07090c"; ctx.fillRect(0, 0, W, H);
    for (let r = 0; r < MAP.length; r++) {
      for (let c = 0; c < MAP[r].length; c++) {
        const ch = MAP[r][c];
        if (ch === "#") { ctx.fillStyle = "#26313d"; ctx.fillRect(c * TILE, r * TILE, TILE, TILE); }
        else if (ch === "D") {
          ctx.fillStyle = this.doorOpen ? "#1b3a26" : "#5a2b2b";
          ctx.fillRect(c * TILE, r * TILE, TILE, TILE);
        }
      }
    }
    ctx.strokeStyle = "rgba(125,211,252,.35)"; ctx.lineWidth = 1;
    ctx.beginPath();
    this.trail.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.stroke();

    if (!this.hasKey) {
      ctx.fillStyle = "#facc15";
      ctx.beginPath(); ctx.arc(this.key.x, this.key.y, 5, 0, 7); ctx.fill();
    }
    // 목표 = 빛. 초파리는 이걸 향해 간다
    const g = ctx.createRadialGradient(this.goal.x, this.goal.y, 2, this.goal.x, this.goal.y, 26);
    g.addColorStop(0, "#fff9c4"); g.addColorStop(1, "rgba(250,204,21,0)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(this.goal.x, this.goal.y, 26, 0, 7); ctx.fill();

    ctx.save();
    ctx.translate(this.x, this.y); ctx.rotate(this.a);
    ctx.fillStyle = this.escaped ? "#f87171" : "#e9eef4";
    ctx.beginPath(); ctx.moveTo(7, 0); ctx.lineTo(-5, 4); ctx.lineTo(-5, -4); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  /**
   * 초파리가 실제로 보는 것 — 1인칭 시야.
   *
   * 위에서 내려다본 지도를 통째로 넣으면 안 된다. 초파리는 자기 머리 방향에서
   * 앞을 본다. 겹눈 화각은 넓으므로 좌우 합쳐 270도를 쓴다.
   * 각 세로줄마다 광선을 쏴서 벽까지 거리를 재고, 빛(목표)과 열쇠의 밝기를 더한다.
   *
   * 캔버스가 필요 없어 헤드리스에서도 그대로 돌고, getImageData보다 훨씬 빠르다.
   */
  visionField(gw, gh, out) {
    const FOV = Math.PI * 1.5;              // 270도
    const MAXD = 220;
    for (let gx = 0; gx < gw; gx++) {
      const ang = this.a + (gx / (gw - 1) - 0.5) * FOV;
      const dx = Math.cos(ang), dy = Math.sin(ang);

      // 벽까지 행진
      let d = 0;
      for (; d < MAXD; d += 2) {
        if (this.solid(this.x + dx * d, this.y + dy * d)) break;
      }
      const wallH = Math.min(gh, Math.max(1, (gh * 26) / Math.max(8, d)));

      // 광원(목표=빛, 열쇠)이 이 방향에 있는가
      let lum = 0;
      for (const [src, pw] of [[this.goal, 1.0], [this.hasKey ? null : this.key, 0.45]]) {
        if (!src) continue;
        const vx = src.x - this.x, vy = src.y - this.y;
        const dist = Math.hypot(vx, vy) || 1;
        let da = Math.atan2(vy, vx) - ang;
        while (da > Math.PI) da -= 2 * Math.PI;
        while (da < -Math.PI) da += 2 * Math.PI;
        if (Math.abs(da) < 0.22 && dist < d + 6)      // 벽에 가리지 않았을 때만
          lum += pw * (1 - Math.abs(da) / 0.22) * Math.max(0.15, 1 - dist / 260);
      }

      for (let gy = 0; gy < gh; gy++) {
        // 화면 가운데에 벽이 보이고, 가까울수록 크고 어둡다
        const inWall = Math.abs(gy - (gh - 1) / 2) <= wallH / 2;
        let v = inWall ? Math.max(0, 0.22 - d / MAXD * 0.22) : 0.06;
        v += lum * (inWall ? 0.5 : 1.0);
        out[gy * gw + gx] = Math.max(0, Math.min(1, v));
      }
    }

    // 대비 정규화 — 평균을 빼고 펼친다.
    // 실제 초파리 라미나가 측면억제로 하는 일과 같다. 이걸 하지 않으면
    // 전체가 어두울 때 좌우 차이가 묻혀 뇌가 방향을 읽지 못한다.
    let mean = 0;
    for (let i = 0; i < out.length; i++) mean += out[i];
    mean /= out.length;
    for (let i = 0; i < out.length; i++)
      out[i] = Math.max(0, Math.min(1, 0.25 + (out[i] - mean) * 2.4));
    return out;
  }

  /** (참고용) 화면 픽셀에서 밝기 격자를 뽑는다 — 위에서 본 지도라 실제로는 쓰지 않는다 */
  vision(ctx, gw, gh, out) {
    const img = ctx.getImageData(0, 0, W, H).data;
    const cw = W / gw, chh = H / gh;
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        let s = 0, n = 0;
        const x0 = (gx * cw) | 0, x1 = ((gx + 1) * cw) | 0;
        const y0 = (gy * chh) | 0, y1 = ((gy + 1) * chh) | 0;
        for (let y = y0; y < y1; y += 2) {
          for (let x = x0; x < x1; x += 2) {
            const i = (y * W + x) * 4;
            s += (img[i] * 0.3 + img[i + 1] * 0.59 + img[i + 2] * 0.11);
            n++;
          }
        }
        out[gy * gw + gx] = n ? Math.min(1, s / n / 255 * 1.6) : 0;
      }
    }
    return out;
  }

  state() {
    return { x: this.x | 0, y: this.y | 0, a: +this.a.toFixed(2), frame: this.frame,
             hasKey: this.hasKey, doorOpen: this.doorOpen, escaped: this.escaped, won: this.won };
  }
}

function mulberry(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
