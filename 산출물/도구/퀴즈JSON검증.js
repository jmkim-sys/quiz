/* 퀴즈데이터 JSON 구조 검증기
 *
 *   node 퀴즈JSON검증.js                     ← 산출물/퀴즈데이터/*.json 전부 검사
 *   node 퀴즈JSON검증.js <파일.json> [...]   ← 지정한 파일만 검사
 *
 * 왜 필요한가: `퀴즈생성자`는 파일을 쓰지 못하므로 사람(또는 호출자)이 결과를 JSON으로 옮겨 담는다.
 * 그 과정에서 정답 번호를 잘못 적으면 미리보기가 **틀린 답을 정답으로 표시**한다. 문항 14개의 정답
 * 키를 손으로 옮기는 단계가 있는 한 이 검사는 매번 돌리는 것이 맞다.
 *
 * 검사하는 것 — 구조와 자기 일관성:
 *   · 7문항 고정 배열(유형·난이도)이 SPEC과 일치하는가
 *   · 문항별 형식이 정확히 하나이고 유형에 맞는가
 *   · 정답 번호가 보기 범위 안인가 / 복수 정답이 정확히 2개인가
 *   · 순서배열 정답이 1~4의 순열인가 (중복·누락 없음)
 *   · 순서배열 검수 정보의 `정답 1` 표기가 라벨 형식(`나-라-가-다`)인가
 *   · 직접 입력의 발문이 고정 문구인가, 빈칸 밑줄 표기가 정답과 글자 수·띄어쓰기까지 맞는가
 *   · 5번 슬롯에 exFirst가 없는가 (발문 먼저, 예문 박스 뒤)
 *   · A안·B안의 직접 입력 정답 용어가 서로 다른가
 *   · 예문을 쓰지 않는 유형의 예문 칸이 `-` 인가
 *
 * 검사하지 못하는 것: **정답이 원고 내용에 비추어 맞는지.** 그것은 사람이 미리보기에서 풀어보며
 * 확인해야 한다. 이 스크립트가 "통과"라고 해도 과학적 사실 검토를 건너뛰면 안 된다.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const QZ_DIR = path.join(ROOT, '산출물', '퀴즈데이터');

const FIXED_Q = '빈칸에 들어갈 알맞은 말을 쓰세요.';
const ORD_LABEL = ['가', '나', '다', '라'];
const KINDS = ['blanks', 'ox', 'single', 'multi', 'order', 'text'];
/* SPEC 4장의 7문항 고정 배열 */
const EXPECT = [
  { type: '인라인', lv: '하', kind: 'blanks' },
  { type: 'OX', lv: '하', kind: 'ox' },
  { type: '사지선다 (단수)', lv: '중', kind: 'single' },
  { type: '순서배열', lv: '중-상', kind: 'order' },
  { type: '직접 입력', lv: '상', kind: 'text' },
  { type: '사지선다 (복수)', lv: '중', kind: 'multi' },
  { type: '순서배열', lv: '중-상', kind: 'order' },
];

const C = { r: '\x1b[31m', g: '\x1b[32m', y: '\x1b[33m', b: '\x1b[1m', x: '\x1b[0m' };

function checkFile(file) {
  const bad = [];
  const tag = path.basename(file, '.json');
  let d;
  try { d = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); }
  catch (e) { return [[tag, '-', 'JSON 파싱 실패: ' + e.message]]; }

  ['articleId', 'meta', 'slots'].forEach(k => { if (!d[k]) bad.push([tag, '-', k + ' 없음']); });
  if (d.meta) ['분과', '대단원', '중단원', '아티클', 'csv', '행', '원고'].forEach(k => {
    if (!d.meta[k]) bad.push([tag, 'meta', k + ' 없음']);
  });
  if (!Array.isArray(d.slots) || d.slots.length !== 7) {
    bad.push([tag, '-', 'slots 가 7개가 아님 (' + (d.slots ? d.slots.length : 0) + ')']);
    return bad;
  }

  d.slots.forEach((sl, i) => {
    const e = EXPECT[i];
    if (sl.no !== i + 1) bad.push([tag, i + 1, 'no 가 ' + sl.no]);
    if (sl.type !== e.type) bad.push([tag, i + 1, 'type ' + sl.type + ' (기대 ' + e.type + ')']);
    if (sl.lv !== e.lv) bad.push([tag, i + 1, 'lv ' + sl.lv + ' (기대 ' + e.lv + ')']);
    if (!sl.axis) bad.push([tag, i + 1, 'axis 없음']);

    ['A', 'B'].forEach(k => {
      const a = sl[k], loc = String(i + 1) + k;
      if (!a) { bad.push([tag, loc, '안(案)이 없음']); return; }
      const kinds = KINDS.filter(x => a[x]);
      if (kinds.length !== 1 || kinds[0] !== e.kind) {
        bad.push([tag, loc, '형식 [' + kinds + '] (기대 ' + e.kind + ')']); return;
      }
      if (!a.q) bad.push([tag, loc, 'q(문제) 없음']);
      if (!a.sol) bad.push([tag, loc, 'sol(정답해설) 없음']);
      const v = a[e.kind];

      if (e.kind === 'blanks') {
        if (v.length !== 2) bad.push([tag, loc, '빈칸 ' + v.length + '개 (기대 2)']);
        v.forEach((bl, bi) => {
          if (!Array.isArray(bl.opts) || bl.opts.length !== 3)
            bad.push([tag, loc, '빈칸' + (bi + 1) + ' 선택지 ' + (bl.opts || []).length + '개 (기대 3)']);
          if (!(bl.ans >= 1 && bl.ans <= (bl.opts || []).length))
            bad.push([tag, loc, '빈칸' + (bi + 1) + ' ans ' + bl.ans + ' 범위 밖']);
        });
        [1, 2].forEach(nb => {
          if (String(a.ex || '').indexOf('[' + nb + ']') < 0)
            bad.push([tag, loc, '예문에 [' + nb + '] 표기 없음']);
        });
      } else if (e.kind === 'ox') {
        if (String(v.opts) !== 'O,X') bad.push([tag, loc, 'ox 보기 ' + v.opts + ' (기대 O,X)']);
        if (v.ans !== 1 && v.ans !== 2) bad.push([tag, loc, 'ox ans ' + v.ans]);
      } else if (e.kind === 'single') {
        if ((v.opts || []).length !== 4) bad.push([tag, loc, '보기 ' + (v.opts || []).length + '개 (기대 4)']);
        if (!(v.ans >= 1 && v.ans <= 4)) bad.push([tag, loc, 'ans ' + v.ans + ' 범위 밖']);
      } else if (e.kind === 'multi') {
        if ((v.opts || []).length !== 4) bad.push([tag, loc, '보기 ' + (v.opts || []).length + '개 (기대 4)']);
        const ans = v.ans || [];
        if (ans.length !== 2 || new Set(ans).size !== 2)
          bad.push([tag, loc, '복수 정답 [' + ans + '] — 정확히 2개여야 함']);
        if (ans.some(x => !(x >= 1 && x <= 4))) bad.push([tag, loc, 'ans [' + ans + '] 범위 밖']);
        if (String(a.q).indexOf('모두') < 0) bad.push([tag, loc, '발문에 복수 정답 신호(모두) 없음']);
      } else if (e.kind === 'order') {
        if ((v.opts || []).length !== 4) bad.push([tag, loc, '문장 ' + (v.opts || []).length + '개 (기대 4)']);
        const srt = (v.ans || []).slice().sort().join(',');
        if (srt !== '1,2,3,4') bad.push([tag, loc, 'ans [' + v.ans + '] 가 1~4 순열 아님']);
        /* 화면에는 가·나·다·라로 표시되지만 JSON은 숫자 배열이 정상이다 */
        if ((v.ans || []).some(x => typeof x !== 'number'))
          bad.push([tag, loc, 'ans 에 숫자가 아닌 값 — JSON은 숫자 배열로 둔다(라벨 변환은 화면이 담당)']);
        /* 검수 정보(raw)의 `정답 1`은 그대로 17열 시트에 들어갈 값이므로 라벨 형식이어야 한다.
           숫자 표기(`2-4-1-3`)는 옛 형식이다 — 2026-08-28 라벨 전환 때 20건이 숫자로 남아 있었다. */
        const labAns = (v.ans || []).map(n => ORD_LABEL[n - 1] || n).join('-');
        const mRaw = String(a.raw || '').match(new RegExp('정답 1 = <code>([^<]*)</code>'));
        if (mRaw && mRaw[1] !== labAns)
          bad.push([tag, loc, '검수 정보의 정답 1 표기 "' + mRaw[1] + '" — 라벨 형식 "' + labAns + '" 이어야 함']);
      } else if (e.kind === 'text') {
        if (a.q !== FIXED_Q) bad.push([tag, loc, '발문이 고정 문구가 아님: "' + String(a.q).slice(0, 24) + '"']);
        if ('exFirst' in a) bad.push([tag, loc, 'exFirst 있음 — 5번은 발문이 먼저여야 함']);
        const ans = v.ans;
        if (!ans) { bad.push([tag, loc, '정답 없음']); return; }
        /* 빈칸은 정답을 글자 단위로 밑줄 `_`로 바꾸고, 띄어쓰기는 그대로 살려 표기한다
           (2026-08-31 확정). `태양 중성미자 문제` → `__ ____ __`
           표기가 정답에서 기계적으로 정해지므로, 그 표기가 예문에 정확히 한 번 들어 있고
           다른 자리에 밑줄이 없으면 통과다. 밑줄 개수(= 공백 제외 글자 수)는 자동으로 따라온다. */
        const ex = String(a.ex || '');
        const mask = String(ans).replace(/[^ ]/g, '_');
        const nMask = ex.split(mask).length - 1;
        const nBar = (ex.match(/_/g) || []).length;
        if (nMask === 0)
          bad.push([tag, loc, '예문에 빈칸 표기 "' + mask + '" 없음 (정답 "' + ans + '")']);
        else if (nMask > 1)
          bad.push([tag, loc, '예문에 빈칸 표기 "' + mask + '" 가 ' + nMask + '군데 — 하나여야 함']);
        else if (nBar !== (mask.match(/_/g) || []).length)
          bad.push([tag, loc, '예문의 밑줄 ' + nBar + '개 — 빈칸 "' + mask + '" 밖에 밑줄이 더 있음']);
        if (ex.indexOf('○') >= 0)
          bad.push([tag, loc, '옛 표기 ○ 가 남아 있음 — 밑줄 표기로 바꿔야 함']);
        if (/\[\s*빈칸\s*\]/.test(ex))
          bad.push([tag, loc, '옛 표기 [ 빈칸 ] 가 남아 있음 — 밑줄 표기로 바꿔야 함']);
      }

      /* 예문을 쓰지 않는 유형은 `-` 로 자리를 지킨다 (X 금지 — OX 정답과 혼동) */
      if (e.kind !== 'blanks' && e.kind !== 'text' && String(a.ex).trim() !== '-')
        bad.push([tag, loc, "예문이 '-' 가 아님: \"" + String(a.ex).slice(0, 20) + '"']);
    });

    /* 5번은 A·B 발문이 같으므로 정답 용어가 겹치면 사실상 같은 문항이 된다 */
    if (e.kind === 'text' && sl.A && sl.B && sl.A.text && sl.B.text
        && sl.A.text.ans === sl.B.text.ans)
      bad.push([tag, (i + 1) + 'A/B', '정답 용어가 동일: ' + sl.A.text.ans]);
  });

  return bad;
}

/* ===== 실행 ===== */
let files = process.argv.slice(2);
if (!files.length) {
  if (!fs.existsSync(QZ_DIR)) { console.error('산출물/퀴즈데이터 폴더가 없습니다.'); process.exit(1); }
  files = fs.readdirSync(QZ_DIR).filter(f => f.endsWith('.json')).sort()
    .map(f => path.join(QZ_DIR, f));
}
if (!files.length) { console.log('검사할 JSON이 없습니다.'); process.exit(0); }

let all = [];
files.forEach(f => { all = all.concat(checkFile(f)); });

console.log(C.b + '퀴즈 JSON 검증' + C.x + ' — 파일 ' + files.length + '건 · 문항 ' + (files.length * 14) + '개');
if (all.length) {
  console.log('\n' + C.r + '[불일치 ' + all.length + '건]' + C.x);
  all.forEach(([t, l, msg]) => console.log('  ' + t.padEnd(30) + String(l).padEnd(6) + msg));
  console.log('\n' + C.y + '※ 구조 검사입니다. 정답이 원고 내용에 맞는지는 미리보기에서 사람이 확인해야 합니다.' + C.x);
  process.exit(1);
}
console.log('\n' + C.g + '전항목 통과' + C.x
  + ' — 고정 배열 · 정답 범위 · 순서 순열 · 라벨 표기 · 빈칸 밑줄 표기 · 고정 발문 · A/B 정답 분리 · 예문 표기');
console.log(C.y + '※ 구조만 검사했습니다. 정답이 원고 내용에 맞는지는 미리보기에서 사람이 확인해야 합니다.' + C.x);
