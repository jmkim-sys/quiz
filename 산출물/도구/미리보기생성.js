/* 퀴즈 미리보기 HTML 생성기 (v3 형식)
 *
 *   node 미리보기생성.js <퀴즈데이터.json> [출력.html]
 *
 * 템플릿은 사용자가 승인한 `산출물/퀴즈미리보기/01_빅뱅_A_특수상대성이론_v3.html`을 그대로 읽어
 * **데이터 블록과 아티클 이름표만** 갈아끼운다. CSS·JS는 한 글자도 건드리지 않으므로
 * 화면과 동작이 승인본과 동일하다는 것이 보장된다.
 *
 * ⚠️ 템플릿 파일을 고치면 이후 생성물 전체에 반영된다 (의도된 동작 — 단일 출처).
 * 교체 지점은 각각 정확히 1번씩만 나와야 하며, 아니면 생성을 중단한다.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
/* 템플릿은 생성 결과물과 겹치지 않는 별도 파일이다.
   예전에는 `퀴즈미리보기/01_빅뱅_A_특수상대성이론_v3.html`을 템플릿으로 읽었는데, 그 파일 자신을
   다시 생성하면 데이터 블록이 새 형식으로 덮여 교체 표시를 찾지 못하게 되어 이후 생성이 전부
   실패했다(2026-08-15). 템플릿을 도구 폴더로 떼어 자기 자신을 덮어쓸 수 없게 했다. */
const TEMPLATE = path.join(ROOT, '산출물', '도구', '미리보기_템플릿.html');
const OUTDIR = path.join(ROOT, '산출물', '퀴즈미리보기');

function die(msg) { console.error('[중단] ' + msg); process.exit(1); }

/* 정확히 1번만 나오는지 확인하고 치환한다 */
function replaceOnce(src, find, repl, label) {
  const n = src.split(find).length - 1;
  if (n !== 1) die(label + ' — 교체 지점이 ' + n + '번 발견됨 (1번이어야 함).\n  찾던 문자열: ' + find);
  return src.replace(find, () => repl);
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function build(data) {
  const need = ['articleId', 'meta', 'slots'];
  need.forEach(k => { if (!data[k]) die('JSON에 `' + k + '` 가 없습니다.'); });
  const m = data.meta;
  ['분과', '대단원', '중단원', '아티클', 'csv', '행', '원고'].forEach(k => {
    if (!m[k]) die('meta.' + k + ' 가 없습니다.');
  });
  if (data.slots.length !== 7) die('slots 가 7개가 아닙니다 (' + data.slots.length + '개).');
  data.slots.forEach((s, i) => {
    if (s.no !== i + 1) die('slots[' + i + '].no 가 ' + (i + 1) + ' 이 아닙니다.');
    ['lv', 'type', 'axis'].forEach(k => { if (!s[k]) die('slots[' + i + '].' + k + ' 가 없습니다.'); });
    ['A', 'B'].forEach(k => {
      if (!s[k]) die('slots[' + i + '].' + k + ' 안(案)이 없습니다.');
      if (!s[k].q) die('slots[' + i + '].' + k + '.q (문제) 가 없습니다.');
      if (!s[k].sol) die('slots[' + i + '].' + k + '.sol (정답해설) 이 없습니다.');
      const kinds = ['blanks', 'ox', 'single', 'multi', 'order', 'text'].filter(x => s[k][x]);
      if (kinds.length !== 1) die('slots[' + i + '].' + k + ' 의 문항 형식이 ' + kinds.length + '개입니다 (1개여야 함).');
      if (!s[k].raw) s[k].raw = '<b>' + k + '안</b>';
    });
  });

  let html = fs.readFileSync(TEMPLATE, 'utf8');

  /* 템플릿이 호출하는 화면 전용 헬퍼가 정의돼 있는지 확인한다.
     2026-08-31: 순서배열 라벨 함수 ordLabel()·ordAnsText() 정의가 템플릿에서 사라진 채
     미리보기 5건이 생성되어, 순서배열 문항에서 ReferenceError로 화면이 그려지지 않았다.
     정의가 없으면 생성물이 전부 깨지므로 만들기 전에 멈춘다. */
  ['ordLabel', 'ordAnsText'].forEach(fn => {
    if (html.indexOf('function ' + fn + '(') < 0)
      die('템플릿에 ' + fn + '() 정의가 없습니다 — 순서배열 렌더가 깨집니다.');
  });

  /* 1. 타이틀 */
  html = replaceOnce(html,
    '<title>퀴즈 미리보기 — A. 특수 상대성 이론 (14개 중 7개 선택, v3)</title>',
    '<title>퀴즈 미리보기 — ' + esc(m.아티클) + ' (14개 중 7개 선택, v3)</title>', '타이틀');

  /* 2. 레일 반영 대상 */
  html = replaceOnce(html,
    '<span class="v">산출물/대단원별/01_빅뱅_우주의_시작.csv · 2~8행</span>',
    '<span class="v">' + esc(m.csv) + ' · ' + esc(m.행) + '</span>', '레일 반영 대상');

  /* 3. 히어로 제목 */
  html = replaceOnce(html,
    '      <h1>A. 특수 상대성 이론</h1>',
    '      <h1>' + esc(m.아티클) + '</h1>', '히어로 제목');

  /* 4. 히어로 칩 3개 */
  html = replaceOnce(html,
    '        <span class="chip k">물리</span>\n' +
    '        <span class="chip">1. 빅뱅 — 우주의 시작</span>\n' +
    '        <span class="chip">1-1) 시간과 공간의 본질</span>',
    '        <span class="chip k">' + esc(m.분과) + '</span>\n' +
    '        <span class="chip">' + esc(m.대단원) + '</span>\n' +
    '        <span class="chip">' + esc(m.중단원) + '</span>', '히어로 칩');

  /* 5. 데이터 블록 전체 (ARTICLE_ID / META / SLOTS / TAG / MAX) */
  /* 따옴표 종류에 흔들리지 않도록 정규식으로 찾는다 */
  const startRe = /var ARTICLE_ID = [^;]*;/;
  const endMark = 'var MAX = 7;';
  const sm = html.match(startRe);
  if (!sm) die('데이터 블록의 시작 표시(var ARTICLE_ID = …;)를 찾지 못했습니다.');
  const si = sm.index, ei = html.indexOf(endMark);
  if (ei < 0 || ei < si) die('데이터 블록의 끝 표시(var MAX = 7;)를 찾지 못했습니다.');
  const block =
    'var ARTICLE_ID = ' + JSON.stringify(data.articleId) + ';\n' +
    'var META = ' + JSON.stringify(m, null, 0) + ';\n\n' +
    '/* 자리마다 후보 2안(A/B). 두 안은 서로 다른 내용을 묻거나 다른 방식으로 묻는다.\n' +
    '   A·B는 대등한 후보이며, 14개 중 고른 7개만 CSV에 반영된다. */\n' +
    'var SLOTS = ' + JSON.stringify(data.slots, null, 1) + ';\n' +
    "var TAG = { A:'A안', B:'B안' };\n" +
    'var MAX = 7;';
  html = html.slice(0, si) + block + html.slice(ei + endMark.length);

  return html;
}

/* ===== 실행 ===== */
const arg = process.argv[2];
if (!arg) die('사용법: node 미리보기생성.js <퀴즈데이터.json> [출력.html]');
if (!fs.existsSync(arg)) die('JSON 파일이 없습니다: ' + arg);
if (!fs.existsSync(TEMPLATE)) die('템플릿이 없습니다: ' + TEMPLATE);

let data;
try { data = JSON.parse(fs.readFileSync(arg, 'utf8').replace(/^﻿/, '')); }
catch (e) { die('JSON 파싱 실패: ' + e.message); }

const html = build(data);
const out = process.argv[3] || path.join(OUTDIR, (data.fileName || data.articleId) + '.html');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html, 'utf8');

/* 생성 직후 자체 점검 */
const m2 = data.meta;
const checks = [
  ['div 짝', (html.match(/<div/g) || []).length === (html.match(/<\/div>/g) || []).length],
  ['details 짝', (html.match(/<details/g) || []).length === (html.match(/<\/details>/g) || []).length],
  ['script 짝', (html.match(/<script>/g) || []).length === (html.match(/<\/script>/g) || []).length],
  ['Tailwind 없음', !/tailwind/i.test(html)],
  ['Material Symbols 없음', !/material\s*symbols/i.test(html)],
  /* 이름표가 실제로 갈렸는지만 본다. 본문(문항)에 템플릿 아티클명이 나오는 것은 정상이다 —
     예: 「일반 상대성 이론」 문항이 「특수 상대성 이론」을 언급하는 경우 */
  ['타이틀 교체됨', html.includes('<title>퀴즈 미리보기 — ' + esc(m2.아티클) + ' (')],
  ['히어로 제목 교체됨', html.includes('<h1>' + esc(m2.아티클) + '</h1>')],
  ['분과 칩 교체됨', html.includes('<span class="chip k">' + esc(m2.분과) + '</span>')],
  ['반영 대상 교체됨', html.includes(esc(m2.csv) + ' · ' + esc(m2.행))],
  ['ARTICLE_ID 교체됨', html.includes('var ARTICLE_ID = ' + JSON.stringify(data.articleId) + ';')],
  ['사람 확인 지점 있음', html.includes('class="confirm"')]
];
const bad = checks.filter(c => !c[1]).map(c => c[0]);
console.log('생성: ' + out);
console.log('  문항 ' + (data.slots.length * 2) + '개 / ' + Math.round(html.length / 1024) + 'KB');
console.log('  점검: ' + (bad.length ? '실패 — ' + bad.join(', ') : '전항목 통과 (' + checks.length + '개)'));
if (bad.length) process.exit(1);
