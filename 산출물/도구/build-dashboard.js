/* ============================================================================
   대시보드 생성기 — 산출물/대단원별/*.csv 를 읽어 퀴즈제작현황_대시보드_v2.html 을 다시 만든다.
   실행: 산출물/도구/대시보드_새로고침.bat (더블클릭)  또는  node build-dashboard.js [옵션]
   옵션: --open   생성 후 기본 브라우저로 대시보드를 연다
         --watch  CSV 폴더를 계속 감시하며 파일이 바뀔 때마다 자동으로 다시 만든다
   원칙: 수치·아티클명·중단원명·대단원명을 전부 원본 CSV에서 읽어 채운다 (지어내지 않음).
        재료/ 안의 파일은 읽기만 한다. 출력은 산출물/ 안의 대시보드 HTML 한 개뿐이다.
   ============================================================================ */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');           // 프로젝트 루트 (0730 실습 폴더)
const EU_DIR = path.join(ROOT, '산출물', '대단원별');
const TOC = path.join(ROOT, '재료', 'Story전체 목차_0730.csv');
const MS_DIR = path.join(ROOT, '재료', '최종 원고');
const OUT = path.join(ROOT, '산출물', '퀴즈제작현황_대시보드_v2.html');
const QZ_DIR = path.join(ROOT, '산출물', '퀴즈데이터');
const PREV_DIR = path.join(ROOT, '산출물', '퀴즈미리보기');

const ARGS = process.argv.slice(2);
const WATCH = ARGS.includes('--watch');
const OPEN = ARGS.includes('--open');

/* 색은 실제 콘솔 창에서만 쓴다. 출력을 파일·파이프로 넘기면 이스케이프 문자가 글자로 보이므로 끈다. */
const COLOR = !!process.stdout.isTTY && !process.env.NO_COLOR;
const C = COLOR
  ? { g: '\x1b[32m', y: '\x1b[33m', r: '\x1b[31m', d: '\x1b[90m', b: '\x1b[1m', x: '\x1b[0m' }
  : { g: '', y: '', r: '', d: '', b: '', x: '' };
const ok = s => console.log(`${C.g}✓${C.x} ${s}`);
const warn = s => console.log(`${C.y}![주의]${C.x} ${s}`);
const err = s => console.log(`${C.r}✗${C.x} ${s}`);
const dim = s => console.log(`${C.d}${s}${C.x}`);

function parseCSV(t) {
  if (t.charCodeAt(0) === 0xFEFF) t = t.slice(1);
  const rows = []; let f = '', row = [], q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\r') { }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows;
}
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/* 하위 폴더까지 훑어 파일명만 모은다 (원고가 대단원/중단원 폴더로 나뉘어 있기 때문) */
function walkFiles(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) out.push(...walkFiles(p));
    else out.push(name);
  }
  return out;
}
const norm = s => String(s).replace(/\s*\n\s*/g, ' ').trim();
/* ===== 목차 CSV 이후의 변경 (재료/는 수정 금지 폴더 — CLAUDE.md 규칙 2) =====
 * `재료/Story전체 목차_0730.csv`는 팀 기획자 확정본이지만 읽기 전용이라 고칠 수 없다.
 * 그 이후 팀이 통보한 소주제 삭제·개편을 여기에 적어 두고 집계 시 반영한다.
 * 목록의 항목을 목차에서 찾지 못하면 경고가 나오므로, 목차가 갱신되면 해당 줄을 지운다.
 * 경위는 `산출물/목차_변경이력.md` 참고. */
const TOC_REMOVED = [
  /* 2026-08-28 팀 통보: 소주제 129개 -> 128개 */
  { mid: '6-7) 용액의 화학', art: 'D. 수용액 반응' },
];
const TOC_RENAMED = [
  /* 2026-08-28 팀 통보: D 삭제에 따라 E가 D로 승격 */
  { mid: '6-7) 용액의 화학', from: 'E. 수용액 평형', to: 'D. 수용액 평형' },
];

const today = () => { const d = new Date(); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };

/* ===================== 집계 ===================== */
function collect() {
  const toc = parseCSV(fs.readFileSync(TOC, 'utf8'));
  const H = toc[0];
  const cEU = H.indexOf('대단원'), cMID = H.indexOf('중단원'), cART = H.indexOf('소단원'), cDIV = H.indexOf('분과');
  if (cEU < 0 || cMID < 0 || cART < 0 || cDIV < 0) throw new Error('목차 CSV에서 대단원/중단원/소단원/분과 열을 찾지 못했습니다.');
  const euLabels = []; const tocRows = [];
  let curEU = '', curMID = '';
  for (const r of toc.slice(1)) {
    if (!r.some(c => (c || '').trim())) continue;
    if ((r[cEU] || '').trim()) { curEU = norm(r[cEU]); if (!euLabels.includes(curEU)) euLabels.push(curEU); }
    if ((r[cMID] || '').trim()) curMID = norm(r[cMID]);
    tocRows.push({ eu: curEU, mid: curMID, art: norm(r[cART]), div: norm(r[cDIV]) });
  }

  /* 목차 원본을 고치지 않고, 팀이 통보한 삭제·개편을 여기서 반영한다 */
  for (const rm of TOC_REMOVED) {
    const before = tocRows.length;
    for (let i = tocRows.length - 1; i >= 0; i--)
      if (tocRows[i].mid === rm.mid && tocRows[i].art === rm.art) tocRows.splice(i, 1);
    if (tocRows.length === before)
      warn('목차 삭제 목록의 «' + rm.mid + ' ' + rm.art + '»를 목차 CSV에서 찾지 못했습니다 — 목차가 갱신되었다면 build-dashboard.js의 TOC_REMOVED에서 그 줄을 지우세요.');
  }
  for (const rn of TOC_RENAMED) {
    const hit = tocRows.filter(r => r.mid === rn.mid && r.art === rn.from);
    if (!hit.length)
      warn('목차 개편 목록의 «' + rn.mid + ' ' + rn.from + '»을 목차 CSV에서 찾지 못했습니다 — 목차가 갱신되었다면 build-dashboard.js의 TOC_RENAMED에서 그 줄을 지우세요.');
    hit.forEach(r => { r.art = rn.to; });
  }

  /* 대단원 CSV는 `00_` ~ `08_` 처럼 두 자리 번호로 시작한다.
     같은 폴더에 놓인 샘플·백업 CSV(예: 퀴즈샘플_260831.csv)까지 세면 대단원 수가 어긋나
     집계가 통째로 멈추므로, 번호로 시작하는 파일만 대단원으로 본다.
     번호는 목차 순서와 짝을 이룬다(00 = 목차 첫 대단원). 정렬 순서에만 기대면 번호가
     겹치거나 건너뛸 때 화면의 대단원명이 조용히 어긋나므로 번호 자체를 검증한다. */
  const allCSV = fs.readdirSync(EU_DIR).filter(f => f.endsWith('.csv')).sort();
  const byNo = new Map(); const skipped = [];
  for (const f of allCSV) {
    const m = f.match(/^(\d{2})_/);
    if (!m) { skipped.push(f); continue; }
    if (byNo.has(m[1]))
      throw new Error(`대단원 번호 ${m[1]}이 둘입니다 — ${byNo.get(m[1])} / ${f}
   사본이라면 산출물/대단원별/ 밖으로 옮기거나 번호로 시작하지 않는 이름으로 바꾸세요.`);
    byNo.set(m[1], f);
  }
  if (skipped.length) dim(`   대단원이 아닌 CSV ${skipped.length}건은 집계에서 제외: ${skipped.join(', ')}`);
  const files = [...byNo.keys()].sort().map(k => byNo.get(k));
  if (files.length !== euLabels.length)
    throw new Error(`대단원 CSV ${files.length}개 vs 목차 대단원 ${euLabels.length}개 — 개수가 달라 매핑할 수 없습니다.`);
  files.forEach((f, i) => {
    if (Number(f.slice(0, 2)) !== i)
      throw new Error(`${f}의 번호가 목차 ${i + 1}번째 대단원 «${euLabels[i]}»의 자리와 맞지 않습니다 — 번호가 건너뛰지 않았는지 확인하세요.`);
  });

  const units = files.map((f, i) => {
    const rows = parseCSV(fs.readFileSync(path.join(EU_DIR, f), 'utf8'));
    const body = rows.slice(1).filter(r => r.some(c => (c || '').trim()));
    const arts = []; let cur = null;
    for (const r of body) {
      if ((r[2] || '').trim()) { cur = { div: r[0].trim(), mid: r[1].trim(), art: r[2].trim(), rows: [] }; arts.push(cur); }
      if (!cur) throw new Error(`${f}: 첫 행에 아티클명이 없습니다.`);
      cur.rows.push(r);
    }
    for (const a of arts) { a.filled = a.rows.filter(r => (r[6] || '').trim()).length; a.total = a.rows.length; }
    /* 17열 검사는 헤더 1줄이 아니라 내용이 있는 모든 행을 본다.
       데이터 행 하나가 16열·18열이 되어도 헤더만 보면 알 수 없다. */
    const offCols = [];
    rows.forEach((r, i) => { if (r.some(c => (c || '').trim()) && r.length !== 17) offCols.push(`${i + 1}행(${r.length}열)`); });
    const mids = [];
    for (const a of arts) { let m = mids[mids.length - 1]; if (!m || m.name !== a.mid) { m = { name: a.mid, arts: [] }; mids.push(m); } m.arts.push(a); }
    return {
      file: f, label: euLabels[i], no: f.slice(0, 2), arts, mids,
      rowCount: body.length, offCols,
      filled: body.filter(r => (r[6] || '').trim()).length,
      done: arts.filter(a => a.filled === a.total).length,
    };
  });

  euLabels.forEach((lbl, i) => {
    const n = tocRows.filter(r => r.eu === lbl).length;
    if (n !== units[i].arts.length) throw new Error(`${lbl}: 목차 ${n}개 vs CSV ${units[i].arts.length}개 — 아티클 수가 맞지 않습니다.`);
  });
  const badCols = units.filter(u => u.offCols.length);
  if (badCols.length) warn(`17열이 아닌 행: ${badCols.map(u => `${u.file} ${u.offCols.join('·')}`).join(' / ')}`);
  const linesChecked = units.reduce((n, u) => n + u.rowCount + 1, 0);   /* 헤더 포함 */
  const colsNote = badCols.length
    ? `17열이 아닌 행이 있습니다 — ${badCols.map(u => `${u.file} ${u.offCols.join('·')}`).join(' / ')}`
    : `헤더를 포함한 ${linesChecked}행을 모두 세어 17열 구조임을 확인했습니다`;

  const T = {
    art: units.reduce((s, u) => s + u.arts.length, 0),
    rows: units.reduce((s, u) => s + u.rowCount, 0),
    filled: units.reduce((s, u) => s + u.filled, 0),
    done: units.reduce((s, u) => s + u.done, 0),
  };
  const divCount = {};
  units.forEach(u => u.arts.forEach(a => divCount[a.div] = (divCount[a.div] || 0) + 1));
  const divs = Object.entries(divCount).sort((a, b) => b[1] - a[1]);

  /* 원고 큐 — 원고는 `대단원/중단원/` 하위 폴더에 있으므로 재귀로 훑는다.
     (예전에는 최상위만 읽어, 원고가 폴더로 정리된 뒤로 큐가 0건이 되어 있었다) */
  let msFiles = [];
  try { msFiles = walkFiles(MS_DIR).filter(f => /\.(md|docx)$/i.test(f)).sort(); }
  catch (e) { warn(`재료/최종 원고/ 폴더를 읽지 못했습니다 — 원고 큐를 비웁니다.`); }

  /* 퀴즈데이터가 이미 있는 아티클 — 큐의 상태 문구를 실제 파일에서 정한다
     (예전에는 원고 파일명 2개에 상태 문구를 코드에 박아 두어 금세 낡았다) */
  const madeArts = new Set();
  try {
    for (const f of fs.readdirSync(QZ_DIR).filter(n => n.endsWith('.json'))) {
      const m = (JSON.parse(fs.readFileSync(path.join(QZ_DIR, f), 'utf8').replace(/^﻿/, '')).meta) || {};
      if (m.아티클) madeArts.add(norm(m.중단원 || '') + '|' + norm(m.아티클));
    }
  } catch (e) { /* 퀴즈데이터가 없으면 전부 '처리 대기'로 둔다 */ }

  const queue = msFiles.map(f => {
    const m = f.match(/^(\d+)_(\d+)\)_([A-Z])/);
    let hit = null;
    if (m) {
      const midPrefix = `${m[1]}-${m[2]})`, letter = m[3] + '.';
      const cands = tocRows.filter(r => r.mid.startsWith(midPrefix) && r.art.startsWith(letter));
      if (cands.length === 1) hit = cands[0];
    }
    let filled = 0, total = 0;
    if (hit) for (const u of units) for (const a of u.arts)
      if (a.art === hit.art && a.mid === hit.mid) { filled = a.filled; total = a.total; }
    const made = hit && madeArts.has(norm(hit.mid) + '|' + norm(hit.art));
    const note = (total && filled === total) ? 'CSV 반영 완료'
               : filled ? `CSV ${filled}/${total}행 반영 중`
               : made ? '후보 A/B 생성 완료 · 선택 대기'
               : '처리 대기';
    return { f, hit, filled, total, note };
  });

  return { units, T, divs, queue, waiting: queue.filter(q => q.filled === 0).length, colsNote, skipped };
}

/* ===== CSV에 반영된 문항이 그 아티클의 미리보기 후보와 아직 같은지 확인 =====
 * 예전에는 「A. 특수 상대성 이론」 미리보기 파일 하나를 코드에 박아 두고 A안만 대조했다.
 * 그 파일이 사라진 뒤로는 매번 "미리보기가 없어 건너뜁니다" 경고만 나와 검사가 죽어 있었다.
 * 이제 `산출물/퀴즈데이터/*.json` 전체를 훑어, CSV에 반영된 아티클마다
 * 반영된 각 행의 문제·예문·정답해설이 그 아티클의 A안·B안 14개 후보 중 하나와 일치하는지 본다.
 * (기획자가 자리마다 A·B 중 무엇을 골랐는지는 정해져 있지 않으므로 번호가 아니라 내용으로 짝짓는다.) */
function checkPreviewSync(units) {
  if (!fs.existsSync(QZ_DIR)) return warn('산출물/퀴즈데이터 폴더가 없어 미리보기 동기화 확인을 건너뜁니다.');
  /* SPEC 4장 17열 표: 예문·정답해설은 "비워두거나 `-`로 표시"가 모두 허용된다.
     둘을 다른 값으로 비교하면 같은 뜻인데 어긋났다고 경고하므로 하나로 맞춘다. */
  const blank = v => { const t = String(v == null ? '' : v).trim(); return t === '-' ? '' : t; };

  /* 아티클별 후보 풀: `<대단원 CSV 파일명>|<아티클명>` -> [{no, side, q, ex, sol}] */
  const pool = {};
  for (const f of fs.readdirSync(QZ_DIR).filter(n => n.endsWith('.json'))) {
    let d;
    try { d = JSON.parse(fs.readFileSync(path.join(QZ_DIR, f), 'utf8').replace(/^\uFEFF/, '')); }
    catch (e) { warn(`퀴즈데이터를 읽지 못해 동기화 확인에서 뺍니다: ${f} (${e.message})`); continue; }
    const m = d.meta || {};
    if (!m.아티클 || !m.csv || !Array.isArray(d.slots)) continue;
    const key = prevKey(path.basename(m.csv), norm(m.아티클));
    const cands = (pool[key] = pool[key] || []);
    d.slots.forEach(s => ['A', 'B'].forEach(side => {
      const it = s && s[side];
      if (it && it.q) cands.push({ no: s.no, side, q: String(it.q).trim(), ex: blank(it.ex), sol: blank(it.sol) });
    }));
  }
  if (!Object.keys(pool).length) return warn('대조할 미리보기 후보가 없어 동기화 확인을 건너뜁니다.');

  let checked = 0, quiet = 0, drifted = 0;
  for (const u of units) for (const a of u.arts) {
    /* 아직 아무것도 반영되지 않은 아티클은 어긋날 것도 없으므로 건너뛴다 */
    if (!a.filled) continue;
    const cands = pool[prevKey(u.file, norm(a.art))];
    if (!cands) { quiet++; continue; }   /* 미리보기 없이 반영된 아티클 (샘플·수기 반영 등) */
    checked++;
    const diff = [];
    a.rows.forEach((r, i) => {
      const q = String(r[6] || '').trim();
      if (!q) return;
      /* 직접 입력(5번)은 발문이 `빈칸에 들어갈 알맞은 말을 쓰세요.` 로 고정이라 A안·B안의 문제가 같다.
         문제만 보고 첫 후보를 집으면 기획자가 B안을 골랐을 때 애먼 A안과 대조하게 되므로,
         문제가 같은 후보를 모두 모은 뒤 예문·정답해설까지 맞는 것이 하나라도 있으면 통과로 본다. */
      const same = cands.filter(c => c.q === q);
      if (!same.length) { diff.push(`문항 ${i + 1}: 후보 14개 중 같은 문제가 없음`); return; }
      const ex = blank(r[15]), sol = blank(r[16]);
      if (same.some(c => c.ex === ex && c.sol === sol)) return;
      const near = same[0];
      if (near.ex !== ex) diff.push(`문항 ${i + 1} 예문 (후보 ${near.no}-${near.side}안과 다름)`);
      if (near.sol !== sol) diff.push(`문항 ${i + 1} 정답해설 (후보 ${near.no}-${near.side}안과 다름)`);
    });
    if (diff.length) {
      drifted++;
      warn(`${u.no} 「${a.art}」의 CSV 반영분이 미리보기 후보와 달라졌습니다 — ${diff.join(', ')}`);
      dim('   CSV를 고친 뒤 미리보기를 다시 만들지 않으면 두 화면이 서로 다른 문항을 보여줍니다.');
    }
  }
  if (checked && !drifted) ok(`CSV 반영 아티클 ${checked}건 = 미리보기 후보와 일치 (문제·예문·정답해설)`);
  else if (checked) warn(`CSV 반영 아티클 ${checked}건 중 ${drifted}건이 미리보기와 어긋납니다.`);
  if (quiet) dim(`   미리보기 없이 반영된 아티클 ${quiet}건은 대조하지 않았습니다.`);
}

/* ===== 미리보기 HTML이 퀴즈데이터 JSON보다 낡지 않았는지 확인 =====
 * 미리보기 HTML은 만들 때의 문항을 그대로 박아 넣은 스냅샷이다(`var SLOTS = [...]`).
 * JSON만 고치고 `미리보기생성.js`를 다시 돌리지 않으면 사람이 보는 화면만 옛 문항으로 남는데,
 * 위 checkPreviewSync는 JSON만 읽으므로 그 경우를 잡지 못한다. 여기서 둘을 직접 맞춰 본다. */
function checkPreviewHTML() {
  if (!fs.existsSync(QZ_DIR) || !fs.existsSync(PREV_DIR)) return;
  let checked = 0, stale = 0;
  for (const f of fs.readdirSync(QZ_DIR).filter(n => n.endsWith('.json')).sort()) {
    let d;
    try { d = JSON.parse(fs.readFileSync(path.join(QZ_DIR, f), 'utf8').replace(/^﻿/, '')); }
    catch (e) { continue; }   /* 읽기 실패는 loadPreviews가 이미 경고한다 */
    const html = path.join(PREV_DIR, (d.fileName || d.articleId || '') + '.html');
    if (!fs.existsSync(html)) continue;
    let embedded;
    try {
      const src = fs.readFileSync(html, 'utf8');
      const a = src.indexOf('var SLOTS = ['), b = src.indexOf('var TAG =', a);
      if (a < 0 || b < 0) throw new Error('SLOTS 블록을 찾지 못함');
      embedded = new Function(src.slice(a, b) + '; return SLOTS;')();
    } catch (e) { warn(`미리보기에서 문항을 읽지 못해 대조를 건너뜁니다: ${path.basename(html)} (${e.message})`); continue; }
    checked++;
    /* `raw`는 미리보기생성.js가 비어 있을 때 채워 넣는 화면 전용 값이라(같은 파일 51행)
       JSON에 없어도 HTML에는 생긴다. 그대로 비교하면 방금 만든 미리보기도 낡았다고 나온다. */
    const noRaw = arr => JSON.stringify(arr, (k, v) => k === 'raw' ? undefined : v);
    if (noRaw(embedded) !== noRaw(d.slots)) {
      stale++;
      warn(`미리보기가 퀴즈데이터보다 낡았습니다 — ${path.basename(html)}`);
      dim(`   node "산출물/도구/미리보기생성.js" "산출물/퀴즈데이터/${f}" 로 다시 만드세요.`);
    }
  }
  if (checked && !stale) ok(`미리보기 HTML ${checked}건 = 퀴즈데이터 JSON과 같은 문항`);
}

/* ===== 미리보기 링크 목록을 퀴즈데이터에서 자동으로 만든다 =====
   예전에는 파일명 2개를 코드에 박아 두어, 미리보기가 늘어도 링크가 붙지 않았다.
   이제 `산출물/퀴즈데이터/*.json` 을 훑어 meta(아티클·csv)로 짝을 짓고,
   실제 HTML이 있는 것만 링크한다. 아티클명은 대단원이 다르면 겹칠 수 있으므로
   키를 `<대단원 CSV 파일명>|<아티클명>` 으로 잡는다. */
function prevKey(file, art) { return file + '|' + art; }

function loadPreviews() {
  const map = {};
  if (!fs.existsSync(QZ_DIR)) { warn('산출물/퀴즈데이터 폴더가 없어 미리보기 링크를 붙이지 않습니다.'); return map; }
  const files = fs.readdirSync(QZ_DIR).filter(n => n.endsWith('.json')).sort();
  let missing = 0;
  for (const f of files) {
    let d;
    try { d = JSON.parse(fs.readFileSync(path.join(QZ_DIR, f), 'utf8').replace(/^﻿/, '')); }
    catch (e) { warn(`퀴즈데이터를 읽지 못해 건너뜁니다: ${f} (${e.message})`); continue; }
    const m = d.meta || {};
    if (!m.아티클 || !m.csv) { warn(`meta에 아티클·csv가 없어 건너뜁니다: ${f}`); continue; }
    const html = (d.fileName || d.articleId || '') + '.html';
    if (!fs.existsSync(path.join(PREV_DIR, html))) {
      warn(`미리보기 파일이 없어 링크를 뺐습니다: ${html}`); missing++; continue;
    }
    const key = prevKey(path.basename(m.csv), norm(m.아티클));
    if (map[key]) warn(`같은 아티클에 미리보기가 둘입니다 — 나중 것을 씁니다: ${key}`);
    map[key] = '퀴즈미리보기/' + encodeURI(html);
  }
  const n = Object.keys(map).length;
  if (n) ok(`미리보기 링크 ${n}개 연결 (퀴즈데이터 ${files.length}건${missing ? `, HTML 없음 ${missing}건` : ''})`);
  else warn('연결할 미리보기가 없습니다.');
  return map;
}

/* ===================== HTML ===================== */
function buildHTML(d, stamp) {
  const { units, T, divs, queue, waiting, colsNote, skipped } = d;
  const maxArt = Math.max(...units.map(u => u.arts.length));
  const maxDiv = divs[0][1];
  const biggest = units.slice().sort((a, b) => b.arts.length - a.arts.length)[0];
  const PREV = loadPreviews();

  /* KPI 3종 —
     진행 중인 아티클 = 퀴즈를 만들었거나(미리보기 존재) CSV에 한 행이라도 반영된 아티클
     검토 대기 퀴즈  = 미리보기는 있는데 아직 7행이 다 반영되지 않은 아티클 */
  const allArts = units.flatMap(u => u.arts.map(a => ({ file: u.file, a })));
  const hasPrev = x => !!PREV[prevKey(x.file, x.a.art)];
  const started = allArts.filter(x => hasPrev(x) || x.a.filled > 0).length;
  const reviewWait = allArts.filter(x => hasPrev(x) && x.a.filled < x.a.total).length;

  const accordion = units.map((u, i) => {
    const pct = (u.arts.length / maxArt * 100).toFixed(1);
    const fill = u.arts.length ? (u.done / u.arts.length * 100).toFixed(1) : '0';
    const links = [`<a class="filelink" href="${esc(encodeURI('대단원별/' + u.file))}">CSV 열기</a>`];
    /* 미리보기가 둘 이상인 대단원에서 "N건"이라고만 쓰고 첫 건만 걸면 라벨과 동작이 어긋난다.
       미리보기 하나에 링크 하나씩 걸고, 어느 아티클인지 이름으로 밝힌다. */
    const mine = u.arts.filter(a => PREV[prevKey(u.file, a.art)]);
    mine.forEach(a => links.push(`<a class="filelink alt" href="${esc(PREV[prevKey(u.file, a.art)])}" target="_blank" rel="noopener">후보 A/B · ${esc(a.art)} <span aria-hidden="true">↗</span></a>`));
    const mids = u.mids.map(m => `      <div class="mid">
        <div class="mid-name">${esc(m.name)} <span class="mid-n">${m.arts.length}개</span></div>
        <ul class="arts">
${m.arts.map(a => {
      const done = a.filled === a.total;
      const href = PREV[prevKey(u.file, a.art)];
      const name = href
        ? `<a class="cand" href="${esc(href)}" target="_blank" rel="noopener">${esc(a.art)}</a>`
        : esc(a.art);
      return `          <li${done ? ' class="done"' : ''}><span class="an">${name}</span><span class="dv">${esc(a.div)}</span><span class="cnt">${a.filled}/${a.total}</span></li>`;
    }).join('\n')}
        </ul>
      </div>`).join('\n');
    return `    <details class="eu"${i === 1 ? ' open' : ''}>
      <summary>
        <span class="chev" aria-hidden="true"></span>
        <span class="eu-name">${u.no} · ${esc(u.label)}</span>
        <span class="bar-track"><span class="bar-scale" style="width:${pct}%"><span class="bar-fill" style="width:${fill}%"></span></span></span>
        <span class="bar-val"><b>${u.done}</b> / ${u.arts.length}</span>
      </summary>
      <div class="eu-body">
        <div class="filelinks">${links.join(' ')}</div>
${mids}
      </div>
    </details>`;
  }).join('\n');

  const divBars = divs.map(([k, v]) => `      <div class="bar-row">
        <span class="bar-name">${esc(k)}</span>
        <span class="bar-track"><span class="bar-scale neutral" style="width:${(v / maxDiv * 100).toFixed(1)}%"></span></span>
        <span class="bar-val"><b>${v}</b> ${(v / T.art * 100).toFixed(1)}%</span>
      </div>`).join('\n');

  const CSS = fs.readFileSync(path.join(__dirname, 'dashboard.css'), 'utf8');

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>퀴즈 제작 현황 — STORY 퀴즈 (v2)</title>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>
${CSS}</style>
</head>
<body>

<aside class="rail">
  <div class="brand">
    <div class="brand-mark">Q</div>
    <div class="brand-name">STORY_QUIZ</div>
  </div>
  <div class="brand-rule"></div>
  <nav class="nav">
    <div class="grp">현황</div>
    <a class="active" href="#overview"><span class="dot"></span>현황 개요</a>
    <a href="#matrix"><span class="dot"></span>대단원별 규모와 진행</a>
  </nav>
  <div class="rail-foot">
    <div class="rail-card">
      <span class="k">Data source</span>
      <span class="v">산출물/대단원별/*.csv<br>산출물/퀴즈데이터/*.json<br>산출물/퀴즈미리보기/*.html<br>재료/Story전체 목차_0730.csv</span>
    </div>
  </div>
</aside>

<div class="shell">
  <header class="topbar">
    <span class="crumb">STORY 퀴즈 / 제작 현황</span>
    <span class="stamp">집계 ${stamp} · 정적 스냅샷 · v2</span>
  </header>

  <main>
    <section id="overview">
      <div class="eyebrow"><span class="sq"></span><span>Production Overview</span></div>
      <h1>퀴즈 제작 현황</h1>
      <p class="sub">아티클 1건 = 문항 7개. 문항 수·완료 여부와 중단원명·아티클명·분과는 <code>산출물/대단원별/*.csv</code> ${units.length}개 파일에서, 미리보기 유무는 <code>산출물/퀴즈데이터/</code>·<code>산출물/퀴즈미리보기/</code>에서, 대단원명은 <code>재료/Story전체 목차_0730.csv</code>에서 그대로 읽어 채운 값입니다.</p>
    </section>

    <section class="kpi-grid kpi-3">
      <div class="kpi">
        <span class="kpi-label">진행 중인 아티클</span>
        <div class="kpi-num"><span class="big">${started}</span><span class="of">/ ${T.art}</span></div>
        <div class="track"><i style="width:${(started / T.art * 100).toFixed(1)}%"></i></div>
        <div class="kpi-foot">퀴즈를 만들었거나 CSV에 반영한 아티클 · 대단원 ${units.length}개</div>
      </div>
      <div class="kpi">
        <span class="kpi-label">기획자 검수 완료 퀴즈</span>
        <div class="kpi-num"><span class="big">${T.filled}</span><span class="of">/ ${T.rows}</span></div>
        <div class="track"><i style="width:${(T.filled / T.rows * 100).toFixed(1)}%"></i></div>
        <div class="kpi-foot">검수를 마치고 대단원별 CSV에 반영된 문항 · 진행률 ${(T.filled / T.rows * 100).toFixed(1)}%</div>
      </div>
      <div class="kpi accent">
        <span class="kpi-label">검토 대기 퀴즈</span>
        <div class="kpi-num"><span class="big">${reviewWait}</span><span class="note">미리보기</span></div>
        <div class="kpi-foot">14개 중 7개를 고르면 CSV에 반영됩니다</div>
      </div>
    </section>

    <section class="cols" id="matrix">
      <div class="panel span8">
        <div class="panel-head">
          <div><div class="panel-label">Volume &amp; Progress</div><h2>대단원별 규모와 진행</h2></div>
          <div class="hint">막대 길이 = 아티클 수 · <b>주황 채움</b> = 완료 아티클 · 행을 클릭하면 펼쳐집니다</div>
        </div>
        <div>
${accordion}
        </div>
      </div>
      <div class="panel span4">
        <div class="panel-head"><div><div class="panel-label">Distribution</div><h3>분과별 아티클 분포</h3></div></div>
        <div class="bars">
${divBars}
        </div>
        <div class="callout">
          가장 큰 대단원은 <b>${esc(biggest.no + ' ' + biggest.label)}</b>(${biggest.arts.length}개)로 전체의 ${(biggest.arts.length / T.art * 100).toFixed(1)}%를 차지합니다.
          분과 기준으로도 <b>${esc(divs[0][0])}</b>이 ${divs[0][1]}개로 가장 많습니다.
        </div>
      </div>
    </section>

    <footer class="note">
      <b>데이터 기준</b> ${stamp}. 집계 원본은 <code>산출물/대단원별/</code>의 대단원 CSV ${units.length}개 파일이며, ${colsNote}.${skipped.length ? ` 같은 폴더의 <code>${skipped.map(esc).join('</code>, <code>')}</code>는 대단원 파일이 아니므로 집계에서 제외했습니다.` : ''}<br>
      <b>집계 방법</b> 아티클 = 아티클명이 적힌 행부터 다음 아티클명 전까지 / <b>진행 중인 아티클</b> = 미리보기가 만들어졌거나 CSV에 한 행이라도 반영된 아티클 / <b>기획자 검수 완료 퀴즈</b> = <code>문제</code> 열이 채워진 행(검수를 마쳐야 반영하므로 반영 = 검수 완료) / <b>검토 대기 퀴즈</b> = 미리보기는 있으나 7행이 아직 다 반영되지 않은 아티클.<br>
      <b>대단원·중단원·아티클명</b>은 <code>재료/Story전체 목차_0730.csv</code>와 대단원별 CSV의 표기를 그대로 사용했습니다(대단원명의 줄바꿈만 공백으로 정규화).<br>
      <b>다시 만들기</b> <code>산출물/도구/대시보드_새로고침.bat</code> 더블클릭. CSV를 고치는 동안 계속 자동 갱신하려면 <code>대시보드_자동감시.bat</code>을 실행해 두세요.<br>
      <b>CSV 열기</b>는 브라우저 설정에 따라 다운로드로 처리될 수 있습니다. 원본을 편집하려면 저장된 위치에서 직접 여세요.<br>
      <b>디자인</b> Executive Kinetic (primary #904d00, Manrope). 근거가 된 <code>재료/design/</code>의 디자인 자료는 이 패키지에 넣지 않았으므로(<code>README_시작하기.md</code> 6장) 원본 폴더에서 확인해야 합니다. 외부 CDN 의존 없이 자체 CSS로 작성했고, 폰트만 Google Fonts에서 불러오며 실패 시 시스템 폰트로 대체됩니다.<br>
      <b>이 파일은 자동 생성됩니다</b> — 직접 고치면 다음 새로고침에서 사라집니다. 내용을 바꾸려면 <code>산출물/도구/build-dashboard.js</code>(구조)와 <code>dashboard.css</code>(디자인)를 고치세요.
    </footer>
  </main>
</div>

</body>
</html>
`;
}

/* ===================== 실행 ===================== */
function run() {
  const stamp = today();
  const d = collect();
  const html = buildHTML(d, stamp);
  try {
    fs.writeFileSync(OUT, html, 'utf8');
  } catch (e) {
    if (e.code === 'EPERM' || e.code === 'EBUSY')
      throw new Error(`대시보드 파일이 다른 프로그램에 잠겨 있어 저장하지 못했습니다.\n   브라우저나 편집기에서 ${path.basename(OUT)} 을 닫고 다시 실행하세요.`);
    throw e;
  }
  ok(`${path.basename(OUT)} 생성 (집계 ${stamp})`);
  console.log(`  ${C.b}아티클 ${d.T.art}${C.x} · 전체 문항 ${d.T.rows} · ${C.b}작성한 문항 ${d.T.filled}${C.x} · 완료 아티클 ${d.T.done} · 대기 원고 ${d.waiting}`);
  console.log(`  분과별 ${d.divs.map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  const partial = [];
  d.units.forEach(u => u.arts.forEach(a => { if (a.filled > 0 && a.filled < a.total) partial.push(`${u.no} ${a.art} (${a.filled}/${a.total})`); }));
  if (partial.length) { warn(`7문항 중 일부만 채워진 아티클 ${partial.length}건 — 붙여넣기 전에 확인하세요:`); partial.forEach(p => dim('   ' + p)); }
  checkPreviewSync(d.units);
  checkPreviewHTML();
  return OUT;
}

function openInBrowser(file) {
  try { spawn('cmd', ['/c', 'start', '', file], { detached: true, stdio: 'ignore' }).unref(); }
  catch (e) { warn('브라우저를 자동으로 열지 못했습니다. 파일을 직접 여세요: ' + file); }
}

console.log(`${C.b}STORY 퀴즈 — 대시보드 새로고침${C.x}`);
dim(`  프로젝트: ${ROOT}`);
try {
  const out = run();
  if (OPEN) openInBrowser(out);
} catch (e) {
  err(e.message);
  process.exitCode = 1;
}

if (WATCH && !process.exitCode) {
  console.log(`\n${C.b}자동 감시 시작${C.x} — 산출물/대단원별/ · 퀴즈데이터/ · 퀴즈미리보기/ · 재료/최종 원고/ 와 목차 CSV를 지켜봅니다.`);
  dim('  이 중 하나라도 저장되면 대시보드를 다시 만듭니다. 이 창을 닫으면 감시가 끝납니다. (Ctrl+C 로도 종료)');
  let timer = null;
  const bump = why => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      console.log(`\n${C.d}[${new Date().toLocaleTimeString('ko-KR')}] ${why} 변경 감지${C.x}`);
      try { run(); } catch (e) { err(e.message); }
    }, 500);
  };
  try {
    fs.watch(EU_DIR, (ev, f) => { if (f && f.endsWith('.csv')) bump(f); });
    fs.watch(path.dirname(TOC), (ev, f) => { if (f === path.basename(TOC)) bump(f); });
    /* 원고는 `대단원/중단원/` 하위 폴더에 있다 — recursive 없이 최상위만 보면 영영 감지되지 않는다 */
    if (fs.existsSync(MS_DIR)) fs.watch(MS_DIR, { recursive: true }, (ev, f) => { if (f) bump('최종 원고/' + f); });
    /* 미리보기가 새로 생기면 KPI(진행 중·검토 대기)와 링크가 바뀌므로 함께 지켜본다 */
    if (fs.existsSync(QZ_DIR)) fs.watch(QZ_DIR, (ev, f) => { if (f && f.endsWith('.json')) bump('퀴즈데이터/' + f); });
    if (fs.existsSync(PREV_DIR)) fs.watch(PREV_DIR, (ev, f) => { if (f && f.endsWith('.html')) bump('퀴즈미리보기/' + f); });
  } catch (e) { err('폴더 감시를 시작하지 못했습니다: ' + e.message); }
}
