/* ============================================================================
   원고 변환기 — 구글 드라이브에서 받은 .docx 를 에이전트가 읽을 수 있는 .md 로 바꾼다.

     node "산출물/도구/원고변환.js"                  ← 안 바뀐 원고만 골라 전부 변환
     node "산출물/도구/원고변환.js" "<docx 경로>"     ← 한 건만 변환
     node "산출물/도구/원고변환.js" --force           ← 이미 있는 변환본도 다시 만든다
     node "산출물/도구/원고변환.js" --list            ← 변환이 필요한 목록만 보고 끝낸다

   입력  재료/최종 원고/<대단원>/<중단원>/<이름>.docx
   출력  재료/최종 원고_텍스트변환/<대단원>/<중단원>/<이름>.docx.md   (UTF-8 BOM 포함)

   왜 있나: `퀴즈생성자`는 Read/Glob/Grep만 가지고 있어 바이너리인 .docx 를 열지 못한다.
   원고가 구글 문서(.md 내려받기)가 아니라 .docx 로 들어오게 바뀌었으므로(2026-08-19),
   사람이 손으로 변환하지 않고 이 스크립트가 대신한다.

   외부 패키지를 쓰지 않는다 — .docx 는 ZIP이고 ZIP은 Node 내장 zlib 로 풀 수 있다.
   패키지를 깔지 않아도 도는 것이 이 이관 패키지의 전제이기 때문이다.

   재료/ 는 읽기 전용 폴더지만 **새 원고 추가**는 허용된다(CLAUDE.md). 이 스크립트도
   `최종 원고_텍스트변환/` 에 새 파일을 만들 뿐, 기존 .docx 는 절대 건드리지 않는다.
   ============================================================================ */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC_DIR = path.join(ROOT, '재료', '최종 원고');
const OUT_DIR = path.join(ROOT, '재료', '최종 원고_텍스트변환');

const ARGS = process.argv.slice(2);
const FORCE = ARGS.includes('--force');
const LIST_ONLY = ARGS.includes('--list');
const TARGET = ARGS.find(a => !a.startsWith('--'));

const COLOR = !!process.stdout.isTTY && !process.env.NO_COLOR;
const C = COLOR
  ? { g: '\x1b[32m', y: '\x1b[33m', r: '\x1b[31m', d: '\x1b[90m', b: '\x1b[1m', x: '\x1b[0m' }
  : { g: '', y: '', r: '', d: '', b: '', x: '' };
const ok = s => console.log(`${C.g}✓${C.x} ${s}`);
const warn = s => console.log(`${C.y}![주의]${C.x} ${s}`);
const err = s => console.log(`${C.r}✗${C.x} ${s}`);
const dim = s => console.log(`${C.d}${s}${C.x}`);

/* ===================== .docx(ZIP) 에서 파일 하나 꺼내기 =====================
   ZIP 끝에 있는 중앙 디렉터리(End of Central Directory)를 찾아 항목 목록을 읽고,
   원하는 항목의 로컬 헤더 위치로 가서 압축을 푼다. 저장(0)·Deflate(8)만 다루는데
   워드가 만드는 .docx 는 이 둘 중 하나만 쓴다. */
function readZipEntry(buf, wantName) {
  /* EOCD 표식 0x06054b50 을 뒤에서부터 찾는다 (주석이 붙어 있을 수 있어 뒤에서 훑는다) */
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 65535; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('ZIP 구조가 아닙니다 (.docx 가 맞는지 확인하세요)');

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);          // 중앙 디렉터리 시작 위치

  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('ZIP 중앙 디렉터리가 깨졌습니다');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);

    if (name === wantName) {
      /* 로컬 헤더는 길이가 중앙 디렉터리와 다를 수 있으므로 여기서 다시 읽는다 */
      if (buf.readUInt32LE(localOff) !== 0x04034b50) throw new Error('ZIP 로컬 헤더가 깨졌습니다');
      const lNameLen = buf.readUInt16LE(localOff + 26);
      const lExtraLen = buf.readUInt16LE(localOff + 28);
      const start = localOff + 30 + lNameLen + lExtraLen;
      const raw = buf.subarray(start, start + compSize);
      if (method === 0) return raw;
      if (method === 8) return zlib.inflateRawSync(raw);
      throw new Error(`지원하지 않는 압축 방식(${method})입니다`);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`.docx 안에 ${wantName} 이 없습니다`);
}

/* ===================== document.xml → 문단 텍스트 =====================
   워드 문서는 문단(<w:p>) 안에 조각(<w:t>)으로 글자가 흩어져 있다. 한 문장이
   서식 때문에 여러 조각으로 쪼개져 있으므로 조각을 이어 붙여야 원문이 된다. */
const XML_ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
const unescapeXml = s => s
  .replace(/&(amp|lt|gt|quot|apos);/g, m => XML_ENT[m])
  .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d));

function paragraphText(pXml) {
  let out = '';
  /* <w:t>글자</w:t> · <w:tab/> · <w:br/> 를 나온 순서대로 이어 붙인다.
     삭제된 글자(<w:delText>)는 넣지 않는다 — 변경내용 추적이 켜진 문서 대비. */
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:br\s*\/>|<w:cr\s*\/>/g;
  let m;
  while ((m = re.exec(pXml)) !== null) {
    if (m[1] !== undefined) out += unescapeXml(m[1]);
    else if (m[0].startsWith('<w:tab')) out += '\t';
    else out += '\n';
  }
  return out;
}

function docxToText(buf) {
  const xml = readZipEntry(buf, 'word/document.xml').toString('utf8');
  const body = xml.slice(xml.indexOf('<w:body'), xml.lastIndexOf('</w:body>') + 9) || xml;

  /* 표는 셀 문단이 <w:p> 로 들어 있어 아래 문단 훑기에 자연히 포함된다.
     지금까지의 원고 44건에는 표가 없었고, 있어도 셀 내용이 문단으로 이어진다. */
  const paras = [];
  const pRe = /<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>|<w:p(?:\s[^>]*)?\/>/g;
  let m;
  while ((m = pRe.exec(body)) !== null) {
    const t = m[1] ? paragraphText(m[1]) : '';
    /* 문단 안의 강제 줄바꿈은 살리고, 양끝 공백만 정리한다 */
    const lines = t.split('\n').map(s => s.replace(/[ \t]+$/g, '').trim());
    const clean = lines.join('\n').trim();
    paras.push(clean);
  }

  /* 빈 문단이 연달아 나오면 하나로 줄인다 (워드는 빈 줄을 문단으로 만든다) */
  const kept = [];
  for (const p of paras) {
    if (p === '' && (kept.length === 0 || kept[kept.length - 1] === '')) continue;
    kept.push(p);
  }
  while (kept.length && kept[kept.length - 1] === '') kept.pop();

  /* 기존 변환본(구글 문서 내려받기)과 같은 모양: 문단 사이에 빈 줄 하나 */
  return kept.filter(p => p !== '').join('\n\n') + '\n';
}

/* ===================== 대상 찾기 ===================== */
function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.docx$/i.test(name) && !name.startsWith('~$')) out.push(p);
  }
  return out;
}

const outPathFor = src => path.join(OUT_DIR, path.relative(SRC_DIR, src) + '.md');

function needsWork(src) {
  const dst = outPathFor(src);
  if (!fs.existsSync(dst)) return '새 원고';
  if (FORCE) return '강제 재변환';
  if (fs.statSync(src).mtimeMs > fs.statSync(dst).mtimeMs) return '원고가 더 최신';
  return null;
}

/* ===================== 실행 ===================== */
console.log(`${C.b}STORY 퀴즈 — 원고 변환 (.docx → .md)${C.x}`);
dim(`  프로젝트: ${ROOT}`);

let targets;
if (TARGET) {
  const p = path.resolve(TARGET);
  if (!fs.existsSync(p)) { err(`파일이 없습니다: ${TARGET}`); process.exit(1); }
  if (!/\.docx$/i.test(p)) { err(`.docx 파일이 아닙니다: ${TARGET}`); process.exit(1); }
  if (!p.startsWith(SRC_DIR)) {
    err(`재료/최종 원고/ 안의 파일만 변환합니다.\n   받은 경로: ${p}`);
    process.exit(1);
  }
  targets = [p];
} else {
  if (!fs.existsSync(SRC_DIR)) { err(`원고 폴더가 없습니다: ${SRC_DIR}`); process.exit(1); }
  targets = walk(SRC_DIR);
}

const todo = targets.map(t => ({ src: t, why: TARGET ? (needsWork(t) || '지정한 파일') : needsWork(t) }))
                    .filter(t => t.why);

if (!todo.length) {
  ok(`변환할 원고가 없습니다 — .docx ${targets.length}건이 모두 최신 변환본을 가지고 있습니다.`);
  dim('   다시 만들려면 --force 를 붙이세요.');
  process.exit(0);
}

if (LIST_ONLY) {
  console.log(`\n변환 대상 ${todo.length}건:`);
  todo.forEach(t => dim('   ' + path.relative(SRC_DIR, t.src) + `  (${t.why})`));
  process.exit(0);
}

let done = 0, failed = 0;
for (const { src, why } of todo) {
  const rel = path.relative(SRC_DIR, src);
  const dst = outPathFor(src);
  try {
    const text = docxToText(fs.readFileSync(src));
    if (!text.trim()) throw new Error('본문에서 글자를 찾지 못했습니다 (빈 문서이거나 형식이 다릅니다)');
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    /* 기존 변환본과 같게 UTF-8 BOM 을 붙인다 */
    fs.writeFileSync(dst, '﻿' + text, 'utf8');
    const chars = text.replace(/\s/g, '').length;
    ok(`${rel}  ${C.d}(${why} · ${chars.toLocaleString('ko-KR')}자)${C.x}`);
    done++;
  } catch (e) {
    err(`${rel} — ${e.message}`);
    failed++;
  }
}

console.log(`\n${C.b}변환 ${done}건${C.x}${failed ? ` · ${C.r}실패 ${failed}건${C.x}` : ''}`);
dim(`  저장 위치: 재료/최종 원고_텍스트변환/`);
if (done) dim('  이제 퀴즈생성자에게 변환본(.md) 경로를 주면 된다. 목차에 없는 새 아티클이면');
if (done) dim('  재료/Story전체 목차_0730.csv 에 있는지 먼저 확인한다.');
if (failed) process.exitCode = 1;
