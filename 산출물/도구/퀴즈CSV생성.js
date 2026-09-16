/* 퀴즈 CSV 생성기 (2026-09-15 신설 — 미리보기 HTML 대체 / 같은 날 7문항 전환)
 *
 *   node 퀴즈CSV생성.js <퀴즈데이터.json> [출력.csv]
 *
 * `산출물/퀴즈데이터/*.json`(7슬롯 × 1문항 = 7문항)을 읽어
 * `산출물/대단원별/*.csv`와 **완전히 같은 17열 형식**의 CSV로 낸다.
 * 행 수(7행)도 `문항 번호`(1~7)도 같으므로, 이 파일이 곧 대단원별 CSV에 들어갈 블록이다.
 * 기획자는 이 파일을 엑셀에서 열어 7문항을 검수하고, "확인했어" 뒤에 `대단원누적자`가 옮긴다.
 *
 * ⛔ 2026-09-15 — A안·B안 2안은 만들지 않는다 (사용자 지시:
 *    "앞으로 14문제 말고 7문제만 만들어 원고 한 개당 7문항만 나오게").
 *    옛 구조(`slots[i].A` / `.B`)를 만나면 변환 안내를 내고 멈춘다.
 *
 * 표기 규칙은 `산출물/대단원별/퀴즈샘플_260831.csv`(기획자 승인본)를 기준으로 맞췄다.
 *   - OX        정답 1 = 라벨 `O`/`X` (번호가 아니다)
 *   - 순서배열   정답 1 = `다-나-라-가` (CLAUDE.md 문항 규칙 8번)
 *   - 직접 입력  보기 1~6 모두 빈칸, 예문에 밑줄 빈칸
 *   - 예문 없음  `-` (빈칸이 아니다 · SPEC 17열 규칙)
 * UTF-8 BOM + CRLF — 대단원별 CSV와 동일하다 (CLAUDE.md 규칙 5번).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const OUTDIR = path.join(ROOT, '산출물', '퀴즈CSV');
const HEAD = ['분과','중단원','아티클','문항 번호','난이도','퀴즈 유형','문제',
              '정답 1','정답 2','보기 1','보기 2','보기 3','보기 4','보기 5','보기 6','예문','정답해설'];
const 라벨 = ['가','나','다','라','마','바'];

function die(msg) { console.error('[중단] ' + msg); process.exit(1); }

/* 한 문항 → 17열 중 [문제 … 정답해설] 11칸 */
function 문항칸(s, 자리) {
  const c = { 문제: s.q, 정답1: '', 정답2: '', 보기: ['','','','','',''], 예문: s.ex, 해설: s.sol };

  switch (s.type) {
    case '인라인': {
      const b = s.blanks || die(자리 + ' — 인라인인데 blanks가 없다.');
      if (b.length > 2) die(자리 + ' — 빈칸이 ' + b.length + '개다. 17열에는 정답 2칸까지만 있다.');
      b.forEach((x, i) => { c['정답' + (i + 1)] = String(x.ans); c.보기[i] = x.opts.join('/'); });
      break;
    }
    case 'OX': {
      const o = s.ox || die(자리 + ' — OX인데 ox가 없다.');
      /* 정답은 번호가 아니라 라벨로 적는다 — 승인본 표기 */
      c.정답1 = o.opts[o.ans - 1] || die(자리 + ' — ox.ans가 보기 범위를 벗어난다: ' + o.ans);
      o.opts.forEach((t, i) => { c.보기[i] = t; });
      break;
    }
    case '사지선다 (단수)': {
      const o = s.single || die(자리 + ' — 사지선다(단수)인데 single이 없다.');
      c.정답1 = String(o.ans);
      o.opts.forEach((t, i) => { c.보기[i] = t; });
      break;
    }
    case '사지선다 (복수)': {
      const o = s.multi || die(자리 + ' — 사지선다(복수)인데 multi가 없다.');
      if (o.ans.length > 2) die(자리 + ' — 정답이 ' + o.ans.length + '개다. 17열에는 정답 2칸까지만 있다.');
      o.ans.forEach((n, i) => { c['정답' + (i + 1)] = String(n); });
      o.opts.forEach((t, i) => { c.보기[i] = t; });
      break;
    }
    case '순서배열': {
      const o = s.order || die(자리 + ' — 순서배열인데 order가 없다.');
      /* ans=[3,2,4,1] → 보기3,보기2,보기4,보기1 순 → `다-나-라-가` (문항 규칙 8번) */
      c.정답1 = o.ans.map(n => 라벨[n - 1] || die(자리 + ' — order.ans가 보기 범위를 벗어난다: ' + n)).join('-');
      o.opts.forEach((t, i) => { c.보기[i] = t; });
      break;
    }
    case '직접 입력': {
      const o = s.text || die(자리 + ' — 직접 입력인데 text가 없다.');
      c.정답1 = o.ans;
      /* 보기 1~6은 모두 빈칸으로 둔다 */
      break;
    }
    default:
      die(자리 + ' — 모르는 유형: ' + s.type);
  }
  return [c.문제, c.정답1, c.정답2, ...c.보기, c.예문, c.해설];
}

function csv칸(v) {
  const s = String(v == null ? '' : v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/* ── 실행 ── */
const inArg = process.argv[2] || die('퀴즈데이터 JSON 경로를 인자로 넘겨라.\n  예: node 퀴즈CSV생성.js "산출물/퀴즈데이터/01_빅뱅_A_특수상대성이론.json"');
const inPath = path.resolve(ROOT, inArg);
if (!fs.existsSync(inPath)) die('파일이 없다: ' + inPath);

let j;
try { j = JSON.parse(fs.readFileSync(inPath, 'utf8').replace(/^\uFEFF/, '')); }
catch (e) { die('JSON을 읽지 못했다: ' + e.message); }

const m = j.meta || die('meta가 없다.');
if (!Array.isArray(j.slots) || j.slots.length !== 7) die('slots가 7개가 아니다: ' + (j.slots || []).length);
if (j.slots.some(s => s && (s.A || s.B)))
  die('옛 A안·B안 구조다 (slots[i].A / .B).\n'
    + '       2026-09-15부터 원고 1건 = 7문항이며, 슬롯 안에 문항 내용을 바로 둔다\n'
    + '       — { no, lv, type, q, ex, sol, <유형별 데이터> }.\n'
    + '       기존 14문항 JSON은 7문항으로 줄여 다시 저장해야 한다.');

const rows = [];
/* 7행. 분과·중단원·아티클은 첫 행에만 적는다 (대단원별 CSV와 같은 방식). */
for (const s of j.slots) {
  const 첫행 = rows.length === 0;
  rows.push([
    첫행 ? (m.분과 || '') : '',
    첫행 ? (m.중단원 || '') : '',
    첫행 ? (m.아티클 || '') : '',
    String(s.no), s.lv, s.type,
    ...문항칸(s, s.no + '번'),
  ]);
}

const out = process.argv[3]
  ? path.resolve(ROOT, process.argv[3])
  : path.join(OUTDIR, (j.fileName || path.basename(inPath, '.json')) + '.csv');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, '\uFEFF' + [HEAD, ...rows].map(r => r.map(csv칸).join(',')).join('\r\n') + '\r\n', 'utf8');

/* 점검 — 사람이 눈으로 확인할 수 있게 요약만 찍는다 */
console.log('생성: ' + path.relative(ROOT, out));
console.log('  아티클  : ' + m.분과 + ' · ' + m.중단원 + ' · ' + m.아티클);
console.log('  행      : ' + rows.length + '행 (7문항)');
console.log('  열      : ' + HEAD.length + '열 · UTF-8 BOM · CRLF');
console.log('  누적 대상: ' + (m.csv || '[확인 필요]') + ' ' + (m.행 || ''));
console.log('  정답 요약: ' + rows.map(r => r[3] + '=' + r[7] + (r[8] ? '/' + r[8] : '')).join(' · '));
if (m.축약) console.log('  축약 이력: ' + m.축약);
