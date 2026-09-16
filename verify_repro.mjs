/**
 * 내보낸 재현 파일이 정말 되살리는지, 앱 밖에서 확인한다.
 *
 * 앱 안에서 Replay 버튼이 도는 것과, 개발자가 받아간 파일이 다른 곳에서
 * 도는 것은 다른 주장이다. QA 도구의 값어치는 후자에 있다.
 *
 *   node verify_repro.mjs <리포트.html | 재현.json> ...
 *
 * 리포트를 주면 안에 박힌 재현 파일을 전부 꺼내 확인한다.
 */
import { readFileSync } from 'fs';
import { Game } from './docs/game.js';
import { replay } from './docs/qa.js';

const args = process.argv.slice(2);
if (!args.length) {
  console.error('사용법: node verify_repro.mjs <리포트.html | 재현.json> ...');
  process.exit(2);
}

/** 리포트 HTML 이면 박혀 있는 JSON 블록을 전부 꺼낸다 */
function extract(path) {
  const t = readFileSync(path, 'utf8');
  if (path.endsWith('.json')) return [JSON.parse(t)];
  return [...t.matchAll(/<script type="application\/json" id="repro\d+">([\s\S]*?)<\/script>/g)]
    .map((m) => JSON.parse(m[1].replace(/\\u003c/g, '<')));
}

let ok = 0, total = 0;
for (const path of args) {
  const items = extract(path);
  if (!items.length) { console.log(`${path} — 재현 파일 없음`); continue; }
  console.log(`${path} — 재현 파일 ${items.length}개`);
  for (const f of items) {
    total++;
    const g = replay(Game, { seed: f.seed, inputs: f.inputs });
    const hit = (g.x | 0) === f.at.x && (g.y | 0) === f.at.y;
    if (hit) ok++;
    console.log(`  ${String(f.code).padEnd(9)} ${String(f.inputs.length).padStart(5)}프레임` +
      ` → (${g.x | 0},${g.y | 0}) vs 기록 (${f.at.x},${f.at.y})  ${hit ? '일치' : '불일치'}`);
  }
}
console.log(`\n${ok}/${total} 일치`);
process.exit(ok === total ? 0 : 1);
