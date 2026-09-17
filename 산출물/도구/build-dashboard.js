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
const QCSV_DIR = path.join(ROOT, '산출물', '퀴즈CSV');

/* ── 화면 표시 보정 (2026-09-16 사용자 지시) ────────────────────────────────────
   사용자 지시 원문: *"고정값으로 두지 말고 진행 중에 +1 검수 필요 파일에 -6해"*
   (그 전에는 14·7 **고정값**이었는데, 집계가 바뀌어도 숫자가 안 움직여서 가감값으로 바꿨다.)
   ⚠️ **계산값에 더하고 빼는 보정이다.** 집계 원본이 바뀌면 보정폭을 유지한 채 따라 움직인다.
   콘솔에는 보정 없는 계산값을 그대로 찍으므로, **화면과 콘솔이 다르면 이 블록 때문이다.**
   보정을 그만두려면 값을 `0`으로 바꿔라. */
const DISPLAY_ADJUST = {
  started: +1,      /* 진행 중인 아티클 */
  reviewNeed: -8,   /* 기획자 검수 필요 파일 */
};
/* 2026-09-17 사용자 지시: *"진행 중인 아티클 참고로 23개, 검수 필요 파일 14개다 대시보드 html 그에 맞게 수정해"*
   그날 검수용 CSV가 22건이 되었고(1-5) 은하의 세계 3건 추가), 그 위에서 23 / 14가 되도록
   reviewNeed를 -6 → -8로 바꿨다. started는 +1 그대로다. ⚠️ 이것도 가감값이므로 검수용 CSV가
   늘면 두 숫자가 함께 따라 오른다 — 사용자가 다시 실수를 알려주면 이 값을 고친다. */

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
  const REVIEW = loadReviewCsv();
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
    const arts = []; const overRows = []; let cur = null;
    for (const r of body) {
      if ((r[2] || '').trim()) { cur = { div: r[0].trim(), mid: r[1].trim(), art: r[2].trim(), rows: [] }; arts.push(cur); }
      if (!cur) throw new Error(`${f}: 첫 행에 아티클명이 없습니다.`);
      cur.rows.push(r);
    }
    for (const a of arts) {
      a.filled = a.rows.filter(r => (r[6] || '').trim()).length;   /* 대단원 CSV에 반영된 행 */
      a.total = a.rows.length;
      const rv = REVIEW[quizKey(f, a.art)];
      a.made = rv ? rv.rows : 0;                                   /* 검수용 CSV에 있는 문항 */
      /* 화면에 쓰는 값. 둘 중 큰 쪽을 쓰되 **아티클의 행 수를 넘지 못하게 막는다.**
         큰 쪽을 쓰는 이유: 검수용 CSV 없이 반영된 옛 건(샘플·수기)도 살리기 위해서다.
         상한을 두는 이유: 넘으면 done(shown === total)이 영영 false가 되는데 "일부만 채워진"
         경고는 shown < total 조건이라 걸리지 않아 조용히 완료 집계에서 빠진다.
         (`_보관_20260915_AB14문항/퀴즈CSV/`에 같은 파일명의 14행 CSV가 12개 있다.) */
      if (a.made > a.total) overRows.push(`${a.art} (검수용 CSV ${a.made}행 > ${a.total}행)`);
      a.shown = Math.min(a.total, Math.max(a.made, a.filled));
    }
    /* 17열 검사는 헤더 1줄이 아니라 내용이 있는 모든 행을 본다.
       데이터 행 하나가 16열·18열이 되어도 헤더만 보면 알 수 없다. */
    const offCols = [];
    rows.forEach((r, i) => { if (r.some(c => (c || '').trim()) && r.length !== 17) offCols.push(`${i + 1}행(${r.length}열)`); });
    if (overRows.length) {
      warn(`${f}: 검수용 CSV가 아티클 행 수보다 깁니다 — ${overRows.join(' · ')}`);
      dim('   옛 14문항 CSV가 산출물/퀴즈CSV/로 돌아온 것이 아닌지 확인하세요. 집계는 행 수에 맞춰 잘랐습니다.');
    }
    const mids = [];
    for (const a of arts) { let m = mids[mids.length - 1]; if (!m || m.name !== a.mid) { m = { name: a.mid, arts: [] }; mids.push(m); } m.arts.push(a); }
    return {
      file: f, label: euLabels[i], no: f.slice(0, 2), arts, mids,
      rowCount: body.length, offCols,
      filled: body.filter(r => (r[6] || '').trim()).length,        /* 대단원 CSV 반영분 */
      shown: arts.reduce((s, a) => s + a.shown, 0),                 /* 화면에 쓰는 문항 수 (아티클별 shown의 합) */
      done: arts.filter(a => a.shown === a.total).length,
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
    filled: units.reduce((s, u) => s + u.filled, 0),   /* 대단원 CSV에 반영된 문항 */
    made: units.reduce((s, u) => s + u.shown, 0),     /* 화면에 쓰는 문항 수 합 — 주로 검수용 CSV 기준 */
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
               : made ? '7문항 생성 완료 · 검수 대기'
               : '처리 대기';
    return { f, hit, filled, total, note };
  });

  return { units, T, divs, queue, waiting: queue.filter(q => q.filled === 0).length, colsNote, skipped, REVIEW };
}

/* ===== 대단원 CSV에 반영된 문항이 퀴즈데이터와 아직 같은지 확인 =====
 * 이 검사는 2026-09-10부터 `산출물/퀴즈데이터/*.json`을 읽었다 — '미리보기 후보'는 JSON 안의
 * A안·B안 14개를 부르던 이름이었을 뿐, 미리보기 HTML을 읽은 적은 없다(HISTORY 2026-09-10 ④).
 * 그런데 2026-09-15에 A안·B안이 사라지면서 `s.A`·`s.B`가 전부 undefined가 되어 후보가 0건이
 * 되었고, "대조할 후보가 없어 건너뜁니다"만 찍으며 검사가 죽어 있었다. 여기서 되살린다.
 * 이제 `산출물/퀴즈데이터/*.json` 전체를 훑어, CSV에 반영된 아티클마다
 * 반영된 각 행의 문제·예문·정답해설이 그 아티클의 문항과 일치하는지 본다.
 * 번호가 아니라 내용으로 짝짓는 이유: 기획자가 자리를 다시 배치한 사례가 있다
 * (2026-08-31 「B. 우주론」 — 1번 자리에 1A·1B를 함께 넣어 번호가 밀렸다).
 * 보관된 옛 A안·B안 구조 JSON도 그대로 후보로 받는다. */
function checkQuizSync(units) {
  if (!fs.existsSync(QZ_DIR)) return warn('산출물/퀴즈데이터 폴더가 없어 문항 동기화 확인을 건너뜁니다.');
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
    const key = quizKey(path.basename(m.csv), m.아티클);
    const cands = (pool[key] = pool[key] || []);
    d.slots.forEach(s => {
      if (!s) return;
      /* 2026-09-15~ 슬롯에 문항이 바로 들어 있다. 그 전 구조는 슬롯 안에 A·B가 있었다. */
      const sides = (s.A || s.B) ? ['A', 'B'] : [null];
      sides.forEach(side => {
        const it = side ? s[side] : s;
        if (it && it.q) cands.push({ no: s.no, side, q: String(it.q).trim(), ex: blank(it.ex), sol: blank(it.sol) });
      });
    });
  }
  if (!Object.keys(pool).length) return warn('대조할 퀴즈데이터가 없어 동기화 확인을 건너뜁니다.');

  let checked = 0, quiet = 0, drifted = 0;
  for (const u of units) for (const a of u.arts) {
    /* 아직 아무것도 반영되지 않은 아티클은 어긋날 것도 없으므로 건너뛴다 */
    if (!a.filled) continue;
    const cands = pool[quizKey(u.file, a.art)];
    if (!cands) { quiet++; continue; }   /* 퀴즈데이터 없이 반영된 아티클 (샘플·수기 반영 등) */
    checked++;
    const diff = [];
    const label = c => c.side ? `${c.no}-${c.side}안` : `${c.no}번`;
    a.rows.forEach((r, i) => {
      const q = String(r[6] || '').trim();
      if (!q) return;
      /* 직접 입력(5번)은 발문이 `빈칸에 들어갈 알맞은 말을 쓰세요.` 로 고정이라 문제가 서로 같다.
         문제만 보고 첫 후보를 집으면 애먼 문항과 대조하게 되므로, 문제가 같은 후보를 모두 모은 뒤
         예문·정답해설까지 맞는 것이 하나라도 있으면 통과로 본다. */
      const same = cands.filter(c => c.q === q);
      if (!same.length) { diff.push(`문항 ${i + 1}: 퀴즈데이터 ${cands.length}개 중 같은 문제가 없음`); return; }
      const ex = blank(r[15]), sol = blank(r[16]);
      if (same.some(c => c.ex === ex && c.sol === sol)) return;
      const near = same[0];
      if (near.ex !== ex) diff.push(`문항 ${i + 1} 예문 (퀴즈데이터 ${label(near)}과 다름)`);
      if (near.sol !== sol) diff.push(`문항 ${i + 1} 정답해설 (퀴즈데이터 ${label(near)}과 다름)`);
    });
    if (diff.length) {
      drifted++;
      warn(`${u.no} 「${a.art}」의 CSV 반영분이 퀴즈데이터와 달라졌습니다 — ${diff.join(', ')}`);
      dim('   대단원 CSV만 고치고 퀴즈데이터·검수용 CSV를 갱신하지 않으면 두 곳이 서로 다른 문항을 담게 됩니다.');
    }
  }
  if (checked && !drifted) ok(`CSV 반영 아티클 ${checked}건 = 퀴즈데이터와 일치 (문제·예문·정답해설)`);
  else if (checked) warn(`CSV 반영 아티클 ${checked}건 중 ${drifted}건이 퀴즈데이터와 어긋납니다.`);
  if (quiet) dim(`   퀴즈데이터 없이 반영된 아티클 ${quiet}건은 대조하지 않았습니다.`);
}

/* ===== 검수용 CSV가 퀴즈데이터 JSON보다 낡지 않았는지 확인 =====
 * 검수용 CSV(`산출물/퀴즈CSV/*.csv`)는 만들 때의 문항을 옮겨 담은 스냅샷이다.
 * JSON만 고치고 `퀴즈CSV생성.js`를 다시 돌리지 않으면 기획자가 검수하는 파일만 옛 문항으로 남는데,
 * 위 checkQuizSync는 JSON만 읽으므로 그 경우를 잡지 못한다. 여기서 둘을 직접 맞춰 본다.
 * 대조하는 칸은 문제·예문·정답해설 세 칸이다 — 정답·보기 칸의 표기 변환(OX 라벨·순서배열 라벨·
 * 직접 입력의 빈 보기)은 생성기 쪽 규칙이라, 여기서 다시 계산하면 규칙을 두 군데서 관리하게 된다. */
function checkReviewCsv() {
  if (!fs.existsSync(QZ_DIR) || !fs.existsSync(QCSV_DIR)) return;
  const blank = v => { const t = String(v == null ? '' : v).trim(); return t === '-' ? '' : t; };
  let checked = 0, stale = 0;
  for (const f of fs.readdirSync(QZ_DIR).filter(n => n.endsWith('.json')).sort()) {
    let d;
    try { d = JSON.parse(fs.readFileSync(path.join(QZ_DIR, f), 'utf8').replace(/^\uFEFF/, '')); }
    catch (e) { continue; }   /* 읽기 실패는 loadReviewCsv가 이미 경고한다 */
    if (!Array.isArray(d.slots)) continue;
    /* 옛 A안·B안 구조는 14행이라 번호가 1:1로 맞지 않는다 — 보관본이므로 대조하지 않는다 */
    if (d.slots.some(s => s && (s.A || s.B))) continue;
    const name = (d.fileName || d.articleId || '') + '.csv';
    const csv = path.join(QCSV_DIR, name);
    if (!fs.existsSync(csv)) continue;
    let rows;
    try { rows = parseCSV(fs.readFileSync(csv, 'utf8')).filter(r => r.some(c => (c || '').trim())).slice(1); }
    catch (e) { warn(`검수용 CSV를 읽지 못해 대조를 건너뜁니다: ${name} (${e.message})`); continue; }
    checked++;
    const diff = [];
    if (rows.length !== d.slots.length) diff.push(`행 수 ${rows.length}행 vs 문항 ${d.slots.length}개`);
    rows.forEach((r, i) => {
      const s = d.slots[i];
      if (!s) return;
      if (String(r[6] || '').trim() !== String(s.q || '').trim()) diff.push(`문항 ${i + 1} 문제`);
      if (blank(r[15]) !== blank(s.ex)) diff.push(`문항 ${i + 1} 예문`);
      if (blank(r[16]) !== blank(s.sol)) diff.push(`문항 ${i + 1} 정답해설`);
    });
    if (diff.length) {
      stale++;
      warn(`검수용 CSV가 퀴즈데이터보다 낡았습니다 — ${name}: ${diff.join(', ')}`);
      dim(`   node "산출물/도구/퀴즈CSV생성.js" "산출물/퀴즈데이터/${f}" 로 다시 만드세요.`);
    }
  }
  if (checked && !stale) ok(`검수용 CSV ${checked}건 = 퀴즈데이터 JSON과 같은 문항`);
}

/* ===== 검수용 CSV 링크 목록을 퀴즈데이터에서 자동으로 만든다 =====
   `산출물/퀴즈데이터/*.json` 을 훑어 meta(아티클·csv)로 짝을 짓고, 실제 파일이 있는 것만 링크한다.
   아티클명은 대단원이 다르면 겹칠 수 있으므로 키를 `<대단원 CSV 파일명>|<아티클명>` 으로 잡는다.
   (2026-09-15 이전에는 `산출물/퀴즈미리보기/*.html`을 걸었다 — 그 생성이 끊겨 CSV로 바꿨다.) */
function quizKey(file, art) { return file + '|' + norm(art); }

function loadReviewCsv() {
  const map = {};
  if (!fs.existsSync(QZ_DIR)) { warn('산출물/퀴즈데이터 폴더가 없어 검수용 CSV 링크를 붙이지 않습니다.'); return map; }
  const files = fs.readdirSync(QZ_DIR).filter(n => n.endsWith('.json')).sort();
  let missing = 0;
  for (const f of files) {
    let d;
    try { d = JSON.parse(fs.readFileSync(path.join(QZ_DIR, f), 'utf8').replace(/^\uFEFF/, '')); }
    catch (e) { warn(`퀴즈데이터를 읽지 못해 건너뜁니다: ${f} (${e.message})`); continue; }
    const m = d.meta || {};
    if (!m.아티클 || !m.csv) { warn(`meta에 아티클·csv가 없어 건너뜁니다: ${f}`); continue; }
    const name = (d.fileName || d.articleId || '') + '.csv';
    if (!fs.existsSync(path.join(QCSV_DIR, name))) {
      warn(`검수용 CSV가 없어 링크를 뺐습니다: ${name}`); missing++; continue;
    }
    const key = quizKey(path.basename(m.csv), m.아티클);
    if (map[key]) warn(`같은 아티클에 검수용 CSV가 둘입니다 — 나중 것을 씁니다: ${key}`);
    /* 행 수까지 센다 — 2026-09-16부터 대시보드의 '만든 문항'을 이 파일에서 읽기 때문이다.
       퀴즈를 만들면 검수용 CSV가 바로 생기지만 대단원 CSV 반영은 그 뒤 단계라, 대단원 CSV만
       보면 이미 만든 퀴즈가 화면에 안 잡힌다. 사용자 지시: "어짜피 퀴즈 만들면 csv 만들어지니까
       그냥 그걸로 대시보드 읽자" */
    let rows = 0;
    try {
      rows = parseCSV(fs.readFileSync(path.join(QCSV_DIR, name), 'utf8'))
        .filter(r => r.some(c => (c || '').trim())).length - 1;   /* 헤더 제외 */
    } catch (e) { warn(`검수용 CSV 행 수를 세지 못했습니다: ${name} (${e.message})`); }
    map[key] = { href: '퀴즈CSV/' + encodeURI(name), rows: Math.max(0, rows) };
  }
  const n = Object.keys(map).length;
  if (n) ok(`검수용 CSV 링크 ${n}개 연결 (퀴즈데이터 ${files.length}건${missing ? `, CSV 없음 ${missing}건` : ''})`);
  else warn('연결할 검수용 CSV가 없습니다.');
  return map;
}

/* ===================== HTML ===================== */
function buildHTML(d, stamp) {
  const { units, T, divs, queue, waiting, colsNote, skipped, REVIEW } = d;
  const maxArt = Math.max(...units.map(u => u.arts.length));
  const maxDiv = divs[0][1];
  const biggest = units.slice().sort((a, b) => b.arts.length - a.arts.length)[0];

  /* KPI 3종 —
     진행 중인 아티클 = 퀴즈를 만들었거나(검수용 CSV 존재) 대단원 CSV에 한 행이라도 반영된 아티클
     검수 대기 아티클 = 검수용 CSV는 있는데 아직 7행이 다 반영되지 않은 아티클
                       (옆 칸 「기획자 검수 완료 퀴즈」는 문항 수다 — 단위가 다르므로 라벨로 구분한다) */
  const allArts = units.flatMap(u => u.arts.map(a => ({ file: u.file, a })));
  const hasQuiz = x => !!REVIEW[quizKey(x.file, x.a.art)];
  const startedCalc = allArts.filter(x => hasQuiz(x) || x.a.shown > 0).length;
  /* 기획자가 열어 볼 검수용 CSV 파일 수 = 만들어 둔 아티클 수.
     반영 여부와 무관하다 — 반영했다고 검수가 끝난 것은 아니기 때문이다. */
  const reviewNeedCalc = allArts.filter(hasQuiz).length;
  /* 위 DISPLAY_ADJUST 참고 — 계산값에 보정폭을 더한다. 음수로 내려가지는 않게 막는다. */
  const started = Math.max(0, startedCalc + DISPLAY_ADJUST.started);
  const reviewNeed = Math.max(0, reviewNeedCalc + DISPLAY_ADJUST.reviewNeed);

  const accordion = units.map((u, i) => {
    /* 2026-09-16 사용자 지시 *"갈색 바 게이지 끝까지 넣어"* — 바깥 막대를 대단원 크기에 비례해
       줄이던 것을 그만두고 항상 트랙 전체로 잡는다. 그래야 완료율 100%인 대단원(프롤로그 5/5)의
       채움이 트랙 끝까지 간다. 대단원 크기는 오른쪽 `N / M` 숫자가 그대로 보여준다. */
    const pct = '100';
    const fill = u.arts.length ? (u.done / u.arts.length * 100).toFixed(1) : '0';
    const links = [`<a class="filelink" href="${esc(encodeURI('대단원별/' + u.file))}">CSV 열기</a>`];
    /* 검수용 CSV가 둘 이상인 대단원에서 "N건"이라고만 쓰고 첫 건만 걸면 라벨과 동작이 어긋난다.
       검수용 CSV 하나에 링크 하나씩 걸고, 어느 아티클인지 이름으로 밝힌다. */
    const mine = u.arts.filter(a => REVIEW[quizKey(u.file, a.art)]);
    mine.forEach(a => links.push(`<a class="filelink alt" href="${esc(REVIEW[quizKey(u.file, a.art)].href)}">검수용 CSV · ${esc(a.art)}</a>`));
    const mids = u.mids.map(m => `      <div class="mid">
        <div class="mid-name">${esc(m.name)} <span class="mid-n">${m.arts.length}개</span></div>
        <ul class="arts">
${m.arts.map(a => {
      const done = a.shown === a.total;
      const href = (REVIEW[quizKey(u.file, a.art)] || {}).href;
      const name = href
        ? `<a class="cand" href="${esc(href)}">${esc(a.art)}</a>`
        : esc(a.art);
      return `          <li${done ? ' class="done"' : ''}><span class="an">${name}</span><span class="dv">${esc(a.div)}</span><span class="cnt">${a.shown}/${a.total}</span></li>`;
    }).join('\n')}
        </ul>
      </div>`).join('\n');
    return `    <details class="eu">
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
      <span class="v">산출물/대단원별/*.csv<br>산출물/퀴즈데이터/*.json<br>산출물/퀴즈CSV/*.csv<br>재료/Story전체 목차_0730.csv</span>
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
      <p class="sub">아티클 1건 = 문항 7개. <b>만든 문항 수는 <code>산출물/퀴즈CSV/*.csv</code></b>에서, 중단원명·아티클명·분과와 전체 규모는 <code>산출물/대단원별/*.csv</code> ${units.length}개 파일에서, 대단원명은 <code>재료/Story전체 목차_0730.csv</code>에서 그대로 읽어 채운 값입니다.</p>
    </section>

    <section class="kpi-grid kpi-3">
      <div class="kpi">
        <span class="kpi-label">진행 중인 아티클</span>
        <div class="kpi-num"><span class="big">${started}</span><span class="of">/ ${T.art}</span></div>
        <div class="track"><i style="width:${(started / T.art * 100).toFixed(1)}%"></i></div>
        <div class="kpi-foot">퀴즈를 만들었거나 CSV에 반영한 아티클 · 대단원 ${units.length}개</div>
      </div>
      <div class="kpi">
        <span class="kpi-label">만든 문항</span>
        <div class="kpi-num"><span class="big">${T.made}</span><span class="of">/ ${T.rows}</span></div>
        <div class="track"><i style="width:${(T.made / T.rows * 100).toFixed(1)}%"></i></div>
        <div class="kpi-foot">검수용 CSV가 만들어진 문항 · 진행률 ${(T.made / T.rows * 100).toFixed(1)}% · 그중 ${T.filled}문항은 대단원별 CSV에도 반영됨</div>
      </div>
      <div class="kpi accent">
        <span class="kpi-label">기획자 검수 필요 파일</span>
        <div class="kpi-num"><span class="big">${reviewNeed}</span><span class="note">개</span></div>
        <div class="kpi-foot"><code>산출물/퀴즈CSV/</code>의 검수용 CSV 수 · 아티클 링크를 눌러 엑셀로 여세요</div>
      </div>
    </section>

    <section class="cols" id="matrix">
      <div class="panel span8">
        <div class="panel-head">
          <div><div class="panel-label">Volume &amp; Progress</div><h2>대단원별 규모와 진행</h2></div>
          <div class="hint"><b>주황 채움</b> = 완료 아티클 비율(7문항이 다 찬 아티클) · 아티클 수는 오른쪽 숫자 · 행을 클릭하면 펼쳐집니다</div>
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
      <b>집계 방법</b> 아티클 = 아티클명이 적힌 행부터 다음 아티클명 전까지 / <b>만든 문항</b> = <code>산출물/퀴즈CSV/&lt;아티클&gt;.csv</code>의 행 수(퀴즈를 만들면 바로 생기는 파일입니다). 그 파일이 없는 아티클은 대단원별 CSV에서 <code>문제</code> 열이 채워진 행을 셉니다 — 검수용 CSV가 없던 시절에 반영된 건을 잃지 않기 위해서입니다 / <b>진행 중인 아티클</b> = 문항이 하나라도 만들어졌거나 반영된 아티클 / <b>기획자 검수 필요 파일</b> = <code>산출물/퀴즈CSV/</code>에 만들어진 검수용 CSV 파일 수(문항 수가 아니라 파일 수입니다). 대단원별 CSV 반영 여부와는 별개입니다 — 반영했다고 검수가 끝난 것은 아닙니다.<br>
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
  console.log(`  ${C.b}아티클 ${d.T.art}${C.x} · 전체 문항 ${d.T.rows} · ${C.b}만든 문항 ${d.T.made}${C.x} (대단원 CSV 반영 ${d.T.filled}) · 완료 아티클 ${d.T.done} · 대기 원고 ${d.waiting}`);
  /* 화면에 손으로 지정한 값을 쓰고 있으면 반드시 알린다 — 조용히 다르면 나중에 못 찾는다 */
  const ov = Object.entries(DISPLAY_ADJUST).filter(([, v]) => v);
  if (ov.length) {
    warn(`화면 표시 보정이 켜져 있습니다 — ${ov.map(([k, v]) => `${k} ${v > 0 ? '+' : ''}${v}`).join(' · ')} (화면 숫자는 계산값에 이만큼 더한 값)`);
    dim('   끄려면 산출물/도구/build-dashboard.js 의 DISPLAY_ADJUST 값을 0 으로 바꾸세요.');
  }
  console.log(`  분과별 ${d.divs.map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  const partial = [];
  d.units.forEach(u => u.arts.forEach(a => { if (a.shown > 0 && a.shown < a.total) partial.push(`${u.no} ${a.art} (${a.shown}/${a.total})`); }));
  if (partial.length) { warn(`7문항 중 일부만 채워진 아티클 ${partial.length}건 — 붙여넣기 전에 확인하세요:`); partial.forEach(p => dim('   ' + p)); }
  checkQuizSync(d.units);
  checkReviewCsv();
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
  console.log(`\n${C.b}자동 감시 시작${C.x} — 산출물/대단원별/ · 퀴즈데이터/ · 퀴즈CSV/ · 재료/최종 원고/ 와 목차 CSV를 지켜봅니다.`);
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
    /* 검수용 CSV가 새로 생기면 KPI(진행 중·검토 대기)와 링크가 바뀌므로 함께 지켜본다 */
    if (fs.existsSync(QZ_DIR)) fs.watch(QZ_DIR, (ev, f) => { if (f && f.endsWith('.json')) bump('퀴즈데이터/' + f); });
    if (fs.existsSync(QCSV_DIR)) fs.watch(QCSV_DIR, (ev, f) => { if (f && f.endsWith('.csv')) bump('퀴즈CSV/' + f); });
  } catch (e) { err('폴더 감시를 시작하지 못했습니다: ' + e.message); }
}
