/**
 * 초파리 직원 — 회사 운영 (메인 스레드)
 *
 * 직원 한 명 = 워커 하나 = 커넥톰 138,639 뉴런 한 벌.
 * 메인 스레드는 게임을 돌리고, 화면을 눈으로 바꿔 워커에 보내고,
 * 워커가 돌려준 조향·전진으로 게임을 움직이고, QA 감지기를 돌린다.
 */
import { Game, BUGS } from "./game.js";
import { QA, replay } from "./qa.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const GW = 16, GH = 12;                     // 눈 격자
const NAMES = ["초코", "방울", "깨비", "삐약", "콩이", "단추", "모찌", "구름"];

const company = [];
let sel = null, runs = 0, totalBugs = 0, t0 = Date.now();

const gctx = $("#game").getContext("2d", { willReadFrequently: true });
const rctx = $("#replay").getContext("2d");
const eyeLc = $("#eyeL").getContext("2d");
const eyeRc = $("#eyeR").getContext("2d");

$("#planted").innerHTML = Object.entries(BUGS)
  .map(([k, v]) => `<div style="margin-bottom:5px"><b class="mono">${k}</b> ${esc(v.name)}
     <span class="dim">— ${esc(v.desc)}</span></div>`).join("");

/* ── 직원 한 명 ───────────────────────────────── */
function hire() {
  if (company.length >= 6) return;
  const n = company.length;
  const emp = {
    id: "E" + String(n + 1).padStart(2, "0"),
    name: NAMES[n % NAMES.length],
    phase: "채용 중", detail: "", progress: 0, ready: false,
    game: new Game(1000 + n * 37), qa: null,
    steer: 0, thrust: 0, dnHz: 0, spikes: 0, brainMs: 0,
    bugs: [], vision: new Float32Array(GW * GH), runs: 0, startedAt: Date.now(),
  };
  emp.qa = new QA({ seed: 1000 + n * 37, W: emp.game.W, H: emp.game.H });

  const w = new Worker(new URL("./fly.worker.js", import.meta.url), { type: "module" });
  emp.worker = w;
  w.onmessage = (e) => onMsg(emp, e.data);
  w.postMessage({
    t: "hire", id: emp.id, grid: { w: GW, h: GH },
    brainUrl: new URL("./data/brain.bin", import.meta.url).href,
    metaUrl: new URL("./data/meta.json", import.meta.url).href,
  });

  company.push(emp);
  if (!sel) sel = emp;
  renderEmps();
}

function onMsg(emp, m) {
  if (m.t === "status") { emp.phase = m.phase; emp.detail = m.detail || ""; renderEmps(); }
  else if (m.t === "hired") {
    emp.ready = true; emp.phase = "근무 중"; emp.detail = "";
    emp.info = m;
    emp.worker.postMessage({ t: "start" });
    renderEmps();
  }
  else if (m.t === "motor") {
    emp.steer = m.steer; emp.thrust = Math.max(0.25, Math.min(1, m.drive));
    emp.dnHz = m.hz; emp.spikes = m.totalSpikes; emp.brainMs = m.brainMs;
  }
  else if (m.t === "error") { emp.phase = "오류"; emp.detail = m.msg; renderEmps(); }
}

/* ── 게임 루프 ───────────────────────────────── */
function tick() {
  for (const e of company) {
    if (!e.ready) continue;
    const g = e.game;

    g.step(e.steer, e.thrust);
    const st = g.state();
    const before = e.qa.findings.length;
    e.qa.observe(st, e.steer, e.thrust);
    e.qa.progress(st, Math.hypot(st.x - g.goal.x, st.y - g.goal.y));
    if (e.qa.findings.length > before) {
      const fresh = e.qa.findings.slice(before);
      for (const f of fresh) { f.by = e.name; e.bugs.push(f); totalBugs++; }
      renderBugs();
    }

    // 초파리가 자기 자리에서 보는 1인칭 시야를 만들어 보낸다
    g.visionField(GW, GH, e.vision);
    e.worker.postMessage({ t: "vision", frame: e.vision });

    // 한 판이 끝나면 다음 판
    if (st.won || st.escaped || st.frame > 6000) {
      e.runs++; runs++;
      g.reset(); e.qa.reset();
      e.worker.postMessage({ t: "reset" });
    }
  }
  draw();
  requestAnimationFrame(tick);
}

function draw() {
  const e = sel;
  if (!e) return;
  e.game.draw(gctx);
  const st = e.game.state();
  $("#bPos").textContent = `(${st.x}, ${st.y})`;
  $("#bFrame").textContent = `${st.frame}f`;
  $("#bState").textContent = !e.ready ? e.phase
    : st.escaped ? "맵 이탈" : st.won ? "도착" : st.hasKey ? (st.doorOpen ? "문 열림" : "열쇠 있음") : "탐색 중";
  $("#who").textContent = `${e.name} (${e.id})`;

  // 눈에 들어가는 밝기 격자
  drawEye(eyeLc, e.vision, 0);
  drawEye(eyeRc, e.vision, 1);

  const s = e.steer;
  const mi = $("#mSteer");
  mi.style.left = s < 0 ? `${50 + s * 50}%` : "50%";
  mi.style.width = `${Math.abs(s) * 50}%`;
  mi.style.background = Math.abs(s) < .08 ? "var(--dim)" : "var(--accent)";
  $("#vSteer").textContent = (s > 0 ? "→" : s < 0 ? "←" : "·") + Math.abs(s * 100).toFixed(0);
  $("#mThr").style.width = `${e.thrust * 100}%`;
  $("#vThr").textContent = (e.thrust * 100).toFixed(0);
  $("#mDn").style.width = `${Math.min(100, e.dnHz)}%`;
  $("#vDn").textContent = e.dnHz.toFixed(1) + "Hz";

  $("#sTime").textContent = Math.floor((Date.now() - t0) / 60000) + "분";
  $("#sBugs").textContent = totalBugs;
  $("#sSpk").textContent = company.reduce((a, x) => a + x.spikes, 0).toLocaleString();
  $("#sRuns").textContent = runs;
  renderEmpsLive();
}

function drawEye(ctx, v, half) {
  const w = GW / 2, img = ctx.createImageData(w, GH);
  for (let y = 0; y < GH; y++) for (let x = 0; x < w; x++) {
    const val = v[y * GW + x + half * w] * 255;
    const i = (y * w + x) * 4;
    img.data[i] = val * .5; img.data[i + 1] = val * .85; img.data[i + 2] = val; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

/* ── 렌더 ────────────────────────────────────── */
function renderEmps() {
  $("#emps").innerHTML = company.map((e) => `
    <div class="emp ${e === sel ? "sel" : ""}" data-id="${e.id}">
      <div class="hd">
        <span class="nm">${esc(e.name)} <span class="small dim mono">${e.id}</span></span>
        <span class="st"><i class="dot ${e.ready ? "ok" : e.phase === "오류" ? "err" : "busy"}"></i> ${esc(e.phase)}</span>
      </div>
      ${e.detail ? `<div class="small dim">${esc(e.detail)}</div>` : ""}
      <div class="kv">
        <span>버그 <b class="bn">${e.bugs.length}</b></span>
        <span>플레이 <b class="rn">${e.runs}</b></span>
        <span>뇌시간 <b class="tn">${(e.brainMs / 1000).toFixed(0)}s</b></span>
      </div>
    </div>`).join("");
  $("#emps").querySelectorAll(".emp").forEach((el) =>
    el.onclick = () => { sel = company.find((x) => x.id === el.dataset.id); renderEmps(); });
  $("#hire").disabled = company.length >= 6;
}
function renderEmpsLive() {
  $("#emps").querySelectorAll(".emp").forEach((el) => {
    const e = company.find((x) => x.id === el.dataset.id);
    if (!e) return;
    el.querySelector(".bn").textContent = e.bugs.length;
    el.querySelector(".rn").textContent = e.runs;
    el.querySelector(".tn").textContent = (e.brainMs / 1000).toFixed(0) + "s";
  });
}

function renderBugs() {
  const all = company.flatMap((e) => e.bugs).sort((a, b) => b.ts - a.ts).slice(0, 30);
  $("#bugN").textContent = all.length ? `(${all.length})` : "";
  if (!all.length) return;
  $("#bugs").innerHTML = all.map((f, i) => `
    <div class="bug ${f.sev}">
      <div class="t"><span class="lb">${esc(f.label)}</span>
        <span class="small dim mono">${f.frame}f · ${esc(f.by)}</span></div>
      <div class="de">${esc(f.detail)}</div>
      <div class="de mono small">위치 (${f.at.x}, ${f.at.y}) · 시드 ${f.repro.seed} · 입력 ${f.repro.inputs.length}스텝</div>
      <div class="ac">
        <button data-r="${i}">♻️ 재현</button>
        <button data-d="${i}">⬇️ 재현 파일</button>
      </div>
    </div>`).join("");
  $("#bugs").querySelectorAll("[data-r]").forEach((b) =>
    b.onclick = () => doReplay(all[+b.dataset.r]));
  $("#bugs").querySelectorAll("[data-d]").forEach((b) =>
    b.onclick = () => {
      const f = all[+b.dataset.d];
      const a = document.createElement("a");
      a.href = URL.createObjectURL(QA.reproBlob(f));
      a.download = `bug_${f.code}_${f.frame}.json`; a.click();
      URL.revokeObjectURL(a.href);
    });
}

/* ── 재현 ────────────────────────────────────── */
let replayTimer = null;
function doReplay(f) {
  clearInterval(replayTimer);
  const g = new Game(f.repro.seed);
  const inp = f.repro.inputs;
  let i = 0;
  const speed = Math.max(1, Math.floor(inp.length / 240));   // 4초 안에 끝나게
  $("#rState").textContent = "재현 중…";
  replayTimer = setInterval(() => {
    for (let k = 0; k < speed && i < inp.length; k++, i++) g.step(inp[i][0], inp[i][1]);
    g.draw(rctx);
    if (i >= inp.length) {
      clearInterval(replayTimer);
      const ok = (g.x | 0) === f.at.x && (g.y | 0) === f.at.y;
      $("#rState").textContent = ok
        ? `✅ 재현 성공 — (${g.x | 0}, ${g.y | 0}) 원본과 일치`
        : `재현 결과 (${g.x | 0}, ${g.y | 0}) / 원본 (${f.at.x}, ${f.at.y})`;
    }
  }, 16);
}

/* ── 시작 ────────────────────────────────────── */
$("#hire").onclick = hire;
hire();                       // 링크 열면 바로 한 명 채용해 일을 시작한다
requestAnimationFrame(tick);
