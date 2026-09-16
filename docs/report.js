/**
 * 초파리 직원 — 세션 리포트
 *
 * 퍼저의 산출물은 화면이 아니라 문서다. 개발자가 받아서 읽고, 붙여넣고,
 * 그대로 재현할 수 있어야 한다. 그래서 자체 완결형 HTML 한 장으로 만든다.
 * 이미지도 재현 파일도 안에 들어 있어서 인터넷 없이 열린다.
 */

const esc = (s) => String(s ?? "").replace(/[&<>"]/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/** 재현 입력열은 길다. 너무 길면 싣지 않고 그 사실을 적는다. */
const MAX_INPUTS = 6000;

function findingBlock(f, i) {
  const repro = f.repro && f.repro.inputs && f.repro.inputs.length;
  const tooBig = repro > MAX_INPUTS;
  const json = repro && !tooBig ? JSON.stringify({
    code: f.code, label: f.label, detail: f.detail, frame: f.frame, at: f.at,
    seed: f.repro.seed, inputs: f.repro.inputs,
  }) : null;
  return `
<section class="f">
  <div class="fh">
    <span class="sev ${esc(f.sev)}">${esc(f.sev)}</span>
    <h3>${esc(f.label)}</h3>
    <code>${esc(f.code)}</code>
    <span class="meta">${esc(f.place || "Lab")} · frame ${f.frame} · found by ${esc(f.by || "—")}</span>
  </div>
  <p>${esc(f.detail)}</p>
  ${f.shot ? `<img class="ev" src="${f.shot}" alt="screen at the moment of the finding">
              <div class="cap">The screen at the moment the rule fired.</div>` : ""}
  ${repro ? (tooBig
      ? `<div class="cap">Reproduction: seed <code>${f.repro.seed}</code>, ${repro.toLocaleString()} recorded inputs
         — too long to embed here; export it from the app instead.</div>`
      : `<div class="cap">Reproduction: seed <code>${f.repro.seed}</code>, ${repro.toLocaleString()} recorded inputs.
         Feeding the same seed and sequence back reproduces this exactly.</div>
         <script type="application/json" id="repro${i}">${json.replace(/</g, "\\u003c")}<\/script>
         <button onclick="save(${i},'${esc(f.code)}_${f.frame}')">Download reproduction file</button>`)
    : `<div class="cap">No reproduction file — this target is external, so we do not control its seed
       or see its internal state. We record the inputs we sent, but exact replay is only guaranteed
       for the built-in Lab game.</div>`}
</section>`;
}

/**
 * @param {{targets:string[], policy:string, policyNote:string, runs:number,
 *          spikes:number, minutes:number, staff:number, measured:Array}} s
 * @param {Array} findings
 */
export function buildReport(s, findings) {
  const kinds = [...new Set(findings.map((f) => f.code))];
  const bySev = (a, b) => ({ critical: 0, high: 1, medium: 2 }[a.sev] - { critical: 0, high: 1, medium: 2 }[b.sev]);
  const list = [...findings].sort(bySev);

  return `<!doctype html><meta charset="utf-8">
<title>Fly Worker — QA session report</title>
<style>
 :root{color-scheme:light}
 body{margin:0;background:#fff;color:#16161a;font:15px/1.6 -apple-system,BlinkMacSystemFont,system-ui,sans-serif}
 .wrap{max-width:860px;margin:0 auto;padding:44px 24px 90px}
 h1{font-size:27px;margin:0 0 4px;letter-spacing:-.02em}
 h2{font-size:17px;margin:38px 0 12px;letter-spacing:-.01em}
 h3{font-size:16px;margin:0;letter-spacing:-.01em}
 .lede{color:#6b6b73;margin:0 0 26px}
 table{border-collapse:collapse;width:100%;font-size:14px}
 th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #e6e6ea}
 th{color:#6b6b73;font-weight:500}
 code{font:13px ui-monospace,Menlo,monospace;background:#f3f3f6;padding:1px 5px;border-radius:4px}
 .f{border:1px solid #e6e6ea;border-radius:12px;padding:18px;margin:14px 0}
 .fh{display:flex;align-items:center;gap:9px;flex-wrap:wrap}
 .fh .meta{margin-left:auto;color:#8b8b93;font-size:13px}
 .sev{font-size:11px;padding:2px 8px;border-radius:5px;background:#fff1e0;color:#a2590a;text-transform:uppercase;letter-spacing:.04em}
 .sev.critical,.sev.high{background:#ffe9e7;color:#b3221a}
 .f p{margin:10px 0 0}
 .ev{display:block;margin:14px 0 6px;max-width:100%;border:1px solid #e6e6ea;border-radius:8px;image-rendering:pixelated}
 .cap{color:#8b8b93;font-size:13px;margin-top:6px}
 button{margin-top:10px;font:inherit;font-size:13px;padding:7px 13px;border:1px solid #d5d5dc;
   background:#fafafc;border-radius:8px;cursor:pointer}
 button:hover{background:#f0f0f4}
 .warn{border-left:3px solid #d5d5dc;padding:2px 0 2px 14px;color:#4a4a52;margin:12px 0}
 footer{margin-top:44px;padding-top:18px;border-top:1px solid #e6e6ea;color:#8b8b93;font-size:13px}
</style>
<div class="wrap">
<h1>QA session report</h1>
<p class="lede">Fly Worker · generated ${esc(new Date().toISOString().replace("T", " ").slice(0, 16))} UTC</p>

<table>
 <tr><th>Targets played</th><td>${esc(s.targets.join(", ") || "—")}</td></tr>
 <tr><th>Policy (what generated the input)</th><td>${esc(s.policy)}</td></tr>
 <tr><th>Session length</th><td>${s.minutes} min · ${s.runs.toLocaleString()} runs · ${s.staff} concurrent instance(s)</td></tr>
 <tr><th>Neuron spikes simulated</th><td>${s.spikes.toLocaleString()}</td></tr>
 <tr><th>Findings</th><td><b>${findings.length}</b> across <b>${kinds.length}</b> symptom type(s): ${esc(kinds.join(", ")) || "—"}</td></tr>
</table>

<div class="warn">
 <b>Read the count carefully.</b> The number of findings is not a quality measure — a policy that
 drives straight into one wall can report the same freeze a hundred times. What matters is how many
 <i>distinct symptom types</i> were reached and how much of the game was covered. This report lists
 ${kinds.length} type(s).
</div>

<h2>Findings</h2>
${list.length ? list.map(findingBlock).join("") : "<p>Nothing was found in this session.</p>"}

${s.measured && s.measured.length ? `
<h2>How this policy compares</h2>
<p class="cap">Measured on the built-in Lab game, 24,000 frames each, identical detector.</p>
<table>
 <tr><th>Policy</th><th>Map coverage</th><th>Symptom types</th></tr>
 ${s.measured.map((m) => `<tr><td>${esc(m.label)}</td><td>${m.pct}%</td><td>${m.kinds}</td></tr>`).join("")}
</table>
<p class="cap">The fly connectome is not the best policy here and we do not claim otherwise.
The framework is what is being offered; the policy is a part you swap.</p>` : ""}

<footer>
 Generated by Fly Worker — a QA fuzzer for browser games. No LLM inference was used: every rule in
 this report is deterministic. Connectome data from FlyWire v783 (CC-BY 4.0).
</footer>
</div>
<script>
function save(i, name){
  var t = document.getElementById('repro'+i).textContent;
  var a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([t], {type:'application/json'}));
  a.download = 'repro_' + name + '.json'; a.click();
  URL.revokeObjectURL(a.href);
}
<\/script>`;
}
