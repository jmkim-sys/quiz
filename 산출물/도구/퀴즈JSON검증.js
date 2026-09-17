/* 퀴즈데이터 JSON 구조 검증기
 *
 *   node 퀴즈JSON검증.js                     ← 산출물/퀴즈데이터/*.json 전부 검사
 *   node 퀴즈JSON검증.js <파일.json> [...]   ← 지정한 파일만 검사
 *
 * 왜 필요한가: `퀴즈생성자`는 파일을 쓰지 못하므로 사람(또는 호출자)이 결과를 JSON으로 옮겨 담는다.
 * 그 과정에서 정답 번호를 잘못 적으면 검수용 CSV에 **틀린 답이 정답으로 실린다.** 문항 7개의 정답
 * 키를 손으로 옮기는 단계가 있는 한 이 검사는 매번 돌리는 것이 맞다.
 *
 * ⛔ 2026-09-15 — 원고 1건 = 7문항이다 (사용자 지시:
 *    "앞으로 14문제 말고 7문제만 만들어 원고 한 개당 7문항만 나오게").
 *    슬롯 안에 문항 내용을 바로 둔다 — { no, lv, type, q, ex, sol, <유형별 데이터> }.
 *    옛 A안·B안 구조(`slots[i].A` / `.B`)를 만나면 그 사실을 알려 준다.
 *
 * 검사하는 것 — 구조와 자기 일관성:
 *   · 7문항 고정 배열(유형·난이도)이 SPEC과 일치하는가
 *     (meta.배열예외가 있으면 배열 일치 대신 "유형과 데이터가 맞는지"만 본다 — 2026-09-15 이전에
 *      기획자 선택으로 배열이 달라진 채 CSV에 확정된 아티클용 예외다)
 *   · 문항별 형식이 정확히 하나이고 유형에 맞는가
 *   · 정답 번호가 보기 범위 안인가 / 복수 정답이 정확히 2개인가
 *   · 순서배열 정답이 1~4의 순열인가 (중복·누락 없음)
 *   · 순서배열 검수 정보의 `정답 1` 표기가 라벨 형식(`나-라-가-다`)인가
 *   · 직접 입력의 발문이 고정 문구인가, 빈칸 밑줄 표기가 정답과 글자 수·띄어쓰기까지 맞는가
 *   · 5번 슬롯에 exFirst가 없는가 (발문 먼저, 예문 박스 뒤)
 *   · 예문을 쓰지 않는 유형의 예문 칸이 `-` 인가
 *
 * 검사하지 못하는 것: **정답이 원고 내용에 비추어 맞는지.** 그것은 사람이 검수용 CSV를 열어
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
/* 배열예외 파일에서 "이 유형이면 이 데이터" 를 판정하기 위한 표 */
const KIND_OF = {
  '인라인': 'blanks', 'OX': 'ox', '사지선다 (단수)': 'single',
  '순서배열': 'order', '직접 입력': 'text', '사지선다 (복수)': 'multi',
};

/* ── 2026-09-17 신설 상수 ─────────────────────────────────────────────── */

/* 순서배열 보기에 쓸 수 없는 시점 표기. `1676년`·`1610`·`20세기`·`1960년대` 를 잡는다.
   (2026-09-17 사용자 지시: "너 순서배열 만들 때 숫자 년도 넣지 마")
   → 순서 근거는 **필연적 인과**만 남는다. [문제]·[정답해설]의 연도는 그대로 허용한다. */
const YEAR_IN_OPT = /(?:1[0-9]{3}|20[0-9]{2})\s*년?(?:대|경|쯤|무렵)?|[0-9]{1,2}\s*세기/;

/* 연도 금지 규칙(2026-09-17) 이전에 만들어 **이미 확정된** 아티클 15건.
   사용자가 "보기 칸만 금지 · 앞으로만"으로 정했으므로 기존 산출물은 고치지 않는다.
   → 이 목록의 파일은 연도 검사에서만 빠진다. 다른 검사는 그대로 받는다.
   ⚠️ 이 목록에 새 파일을 더하지 않는다. 늘어난다면 새 문항이 옛 규칙으로 나온 것이다. */
const YEAR_OK = new Set([
  '00_프롤로그_A_단위',
  '00_프롤로그_A_자연과학소개',
  '00_프롤로그_B_과학연구의목표',
  '00_프롤로그_B_과학연구의측정',
  '01_빅뱅_A_구면천문학',
  '01_빅뱅_A_우리은하와외부은하',
  '01_빅뱅_A_우주의구성성분',
  '01_빅뱅_A_특수상대성이론',
  '01_빅뱅_A_표준우주모형',
  '01_빅뱅_B_우주의3차원구조',
  '01_빅뱅_B_은하의다양한모습과특성',
  '01_빅뱅_B_일반상대성이론',
  '01_빅뱅_B_측광과분광',
  '01_빅뱅_C_관측기기',
  '02_별_B_별의관측',
]);

/* 규칙 10번(과학자 표기)도 2026-09-17 신설이라, 그 전에 확정된 아티클 4건은 보기 칸에 풀네임이 있다.
   연도와 같은 이유로 면제한다 — 사용자가 "앞으로만"으로 정했다. 새 파일을 여기 더하지 않는다. */
const NAME_OK = new Set([
  '00_프롤로그_A_자연과학소개',
  '00_프롤로그_B_과학연구의측정',
  '01_빅뱅_A_우주의구성성분',
  '01_빅뱅_C_관측기기',
]);

/* 순서배열 문장 첫머리 금지어 — 다른 문장을 가리키거나 순서를 드러내 정답을 흘린다 (규칙 3번) */
const ORDER_LEAD = ['그 결과', '그 뒤', '그 후', '그 충돌로', '그래서', '그러나', '그러자', '그리고',
  '결국', '마침내', '뒤이어', '이렇게', '이로써', '이에', '이후', '따라서', '그리하여', '이때', '먼저',
  '다음으로', '끝으로', '처음에', '한편'];

/* 보기·정답 칸에 쓰면 안 되는 과학자 **풀네임** (규칙 10번 · 2026-09-17).
   ⚠️ **사전 방식이다 — 여기 없는 인물은 검사되지 않는다.** 새 인물이 나오면 `이름 성` 형태로 더한다.
   패턴(`[가-힣]{2,6} 성`)으로 잡으려 했으나 `궤도를 케플러`처럼 앞말을 이름으로 오인해 사전으로 바꿨다. */
const FULLNAMES = ['에드윈 허블', '요하네스 케플러', '갈릴레오 갈릴레이', '베라 루빈', '라인하르트 겐첼',
  '앤드리아 게즈', '치아차오 린', '프랭크 슈', '할로 섀플리', '히버 커티스', '윌리엄 허셜', '에드먼드 핼리',
  '올레 뢰머', '프리츠 츠비키', '아이작 뉴턴', '알베르트 아인슈타인', '아르노 펜지어스', '로버트 윌슨',
  '조르주 르메트르', '알렉산드르 프리드만', '조지 가모프', '아서 에딩턴', '한스 베테', '막스 플랑크',
  '니콜라우스 코페르니쿠스', '티코 브라헤', '수브라마니안 찬드라세카르', '크리스티안 도플러',
  '루트비히 볼츠만', '에르빈 슈뢰딩거', '베르너 하이젠베르크', '닐스 보어', '어니스트 러더퍼드',
  '마이클 패러데이', '제임스 맥스웰', '앨버트 마이컬슨', '에드워드 몰리', '볼프강 파울리', '엔리코 페르미',
  '마리 퀴리', '드미트리 멘델레예프', '앙투안 라부아지에', '존 돌턴', '아메데오 아보가드로',
  '헨리에타 리비트', '하인리히 슈바베', '아노 앨런', '헨리 러셀', '에이나르 헤르츠스프룽', '조지프 프라운호퍼',
  '세실리아 페인', '프리드리히 베셀', '하인리히 헤르츠', '아서 콤프턴', '폴 디랙', '리처드 파인만',
  '머리 겔만', '피터 힉스', '볼프강 파노프스키', '아서 홈스', '알프레트 베게너'];

/* 한 칸(문자열) 안에서 같은 인물을 풀네임과 성 단독으로 섞어 적었는지 (규칙 10번).
   실제로 `00_프롤로그_A_자연과학소개`가 `요하네스 케플러`와 `케플러는`을 한 문항에 함께 썼다. */
function 표기혼용(txt) {
  const s = String(txt || '');
  const mixed = [];
  FULLNAMES.forEach(fn => {
    if (s.indexOf(fn) < 0) return;
    const sn = fn.split(' ').pop();
    const rest = s.split(fn).join('\u0000');
    if (new RegExp('(?:^|[^가-힣])' + sn).test(rest)) mixed.push(fn + ' ↔ ' + sn);
  });
  return mixed;
}

/* 풀네임이 들어 있으면 그 이름을 돌려준다 (보기·정답 칸 판정용) */
function 풀네임(txt) {
  const s = String(txt || '');
  return FULLNAMES.filter(fn => s.indexOf(fn) >= 0);
}

const C = { r: '\x1b[31m', g: '\x1b[32m', y: '\x1b[33m', b: '\x1b[1m', x: '\x1b[0m' };

function checkFile(file) {
  const bad = [];
  const tag = path.basename(file, '.json');
  let d;
  try { d = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
  catch (e) { return [[tag, '-', 'JSON 파싱 실패: ' + e.message]]; }

  ['articleId', 'meta', 'slots'].forEach(k => { if (!d[k]) bad.push([tag, '-', k + ' 없음']); });
  if (d.meta) ['분과', '대단원', '중단원', '아티클', 'csv', '행', '원고'].forEach(k => {
    if (!d.meta[k]) bad.push([tag, 'meta', k + ' 없음']);
  });
  if (!Array.isArray(d.slots) || d.slots.length !== 7) {
    bad.push([tag, '-', 'slots 가 7개가 아님 (' + (d.slots ? d.slots.length : 0) + ')']);
    return bad;
  }
  if (d.slots.some(s => s && (s.A || s.B))) {
    bad.push([tag, '-', '옛 A안·B안 구조 (slots[i].A / .B) — 2026-09-15부터 슬롯에 문항을 바로 둔다: '
      + '{ no, lv, type, q, ex, sol, <유형별 데이터> }']);
    return bad;
  }

  /* 배열예외: 2026-09-15 이전에 기획자 선택으로 난이도·유형 배열이 달라진 채 CSV에 확정된 아티클 */
  const 예외 = d.meta && d.meta.배열예외;

  d.slots.forEach((sl, i) => {
    const e = EXPECT[i];
    const loc = String(i + 1);
    if (sl.no !== i + 1) bad.push([tag, loc, 'no 가 ' + sl.no]);

    let kind;
    if (예외) {
      kind = KIND_OF[sl.type];
      if (!kind) { bad.push([tag, loc, '모르는 유형: ' + sl.type]); return; }
    } else {
      if (sl.type !== e.type) bad.push([tag, loc, 'type ' + sl.type + ' (기대 ' + e.type + ')']);
      if (sl.lv !== e.lv) bad.push([tag, loc, 'lv ' + sl.lv + ' (기대 ' + e.lv + ')']);
      kind = e.kind;
    }

    const kinds = KINDS.filter(x => sl[x]);
    if (kinds.length !== 1 || kinds[0] !== kind) {
      bad.push([tag, loc, '형식 [' + kinds + '] (기대 ' + kind + ')']); return;
    }
    if (!sl.q) bad.push([tag, loc, 'q(문제) 없음']);
    if (!sl.sol) bad.push([tag, loc, 'sol(정답해설) 없음']);
    const v = sl[kind];

    if (kind === 'blanks') {
      if (v.length !== 2) bad.push([tag, loc, '빈칸 ' + v.length + '개 (기대 2)']);
      v.forEach((bl, bi) => {
        if (!Array.isArray(bl.opts) || bl.opts.length !== 3)
          bad.push([tag, loc, '빈칸' + (bi + 1) + ' 선택지 ' + (bl.opts || []).length + '개 (기대 3)']);
        if (!(bl.ans >= 1 && bl.ans <= (bl.opts || []).length))
          bad.push([tag, loc, '빈칸' + (bi + 1) + ' ans ' + bl.ans + ' 범위 밖']);
      });
      [1, 2].forEach(nb => {
        if (String(sl.ex || '').indexOf('[' + nb + ']') < 0)
          bad.push([tag, loc, '예문에 [' + nb + '] 표기 없음']);
      });
    } else if (kind === 'ox') {
      if (String(v.opts) !== 'O,X') bad.push([tag, loc, 'ox 보기 ' + v.opts + ' (기대 O,X)']);
      if (v.ans !== 1 && v.ans !== 2) bad.push([tag, loc, 'ox ans ' + v.ans]);
    } else if (kind === 'single') {
      if ((v.opts || []).length !== 4) bad.push([tag, loc, '보기 ' + (v.opts || []).length + '개 (기대 4)']);
      if (!(v.ans >= 1 && v.ans <= 4)) bad.push([tag, loc, 'ans ' + v.ans + ' 범위 밖']);
    } else if (kind === 'multi') {
      if ((v.opts || []).length !== 4) bad.push([tag, loc, '보기 ' + (v.opts || []).length + '개 (기대 4)']);
      const ans = v.ans || [];
      if (ans.length !== 2 || new Set(ans).size !== 2)
        bad.push([tag, loc, '복수 정답 [' + ans + '] — 정확히 2개여야 함']);
      if (ans.some(x => !(x >= 1 && x <= 4))) bad.push([tag, loc, 'ans [' + ans + '] 범위 밖']);
      if (String(sl.q).indexOf('모두') < 0) bad.push([tag, loc, '발문에 복수 정답 신호(모두) 없음']);
    } else if (kind === 'order') {
      if ((v.opts || []).length !== 4) bad.push([tag, loc, '문장 ' + (v.opts || []).length + '개 (기대 4)']);
      const srt = (v.ans || []).slice().sort().join(',');
      if (srt !== '1,2,3,4') bad.push([tag, loc, 'ans [' + v.ans + '] 가 1~4 순열 아님']);
      /* 화면에는 가·나·다·라로 표시되지만 JSON은 숫자 배열이 정상이다 */
      if ((v.ans || []).some(x => typeof x !== 'number'))
        bad.push([tag, loc, 'ans 에 숫자가 아닌 값 — JSON은 숫자 배열로 둔다(라벨 변환은 CSV 생성기가 담당)']);
      /* 검수 정보(raw)의 `정답 1`은 그대로 17열 시트에 들어갈 값이므로 라벨 형식이어야 한다.
         숫자 표기(`2-4-1-3`)는 옛 형식이다 — 2026-08-28 라벨 전환 때 20건이 숫자로 남아 있었다. */
      const labAns = (v.ans || []).map(n => ORD_LABEL[n - 1] || n).join('-');
      const mRaw = String(sl.raw || '').match(new RegExp('정답 1 = <code>([^<]*)</code>'));
      if (mRaw && mRaw[1] !== labAns)
        bad.push([tag, loc, '검수 정보의 정답 1 표기 "' + mRaw[1] + '" — 라벨 형식 "' + labAns + '" 이어야 함']);
      /* 2026-09-17 — 보기 문장에 연도·세기 숫자를 쓰지 않는다 (문항 규칙 4번 개정).
         근거가 시점 표기로만 서는 소재는 순서배열로 쓰지 않고 다른 소재로 바꾼다. */
      (v.opts || []).forEach((o, oi) => {
        const my = YEAR_OK.has(tag) ? null : String(o).match(YEAR_IN_OPT);
        if (my) bad.push([tag, loc, '보기' + (oi + 1) + '에 시점 표기 "' + my[0]
          + '" — 순서배열 보기에는 연도·세기를 쓰지 않는다 (규칙 4번, 2026-09-17)']);
        const lead = ORDER_LEAD.find(w => String(o).trim().indexOf(w) === 0);
        if (lead) bad.push([tag, loc, '보기' + (oi + 1) + ' 첫머리 "' + lead
          + '" — 순서를 흘린다 (규칙 3번)']);
      });
      if (String(sl.q).indexOf('카드') >= 0)
        bad.push([tag, loc, "발문에 '카드' — 학습자에게는 '문장'이라고 부른다 (규칙 8번)"]);
    } else if (kind === 'text') {
      if (sl.q !== FIXED_Q) bad.push([tag, loc, '발문이 고정 문구가 아님: "' + String(sl.q).slice(0, 24) + '"']);
      if ('exFirst' in sl) bad.push([tag, loc, 'exFirst 있음 — 직접 입력은 발문이 먼저여야 함']);
      const ans = v.ans;
      if (!ans) { bad.push([tag, loc, '정답 없음']); return; }
      /* 빈칸은 정답을 글자 단위로 밑줄 `_`로 바꾸고, 띄어쓰기는 그대로 살려 표기한다
         (2026-08-31 확정). `태양 중성미자 문제` → `__ ____ __`
         표기가 정답에서 기계적으로 정해지므로, 그 표기가 예문에 정확히 한 번 들어 있고
         다른 자리에 밑줄이 없으면 통과다. 밑줄 개수(= 공백 제외 글자 수)는 자동으로 따라온다. */
      const ex = String(sl.ex || '');
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
    if (kind !== 'blanks' && kind !== 'text' && String(sl.ex).trim() !== '-')
      bad.push([tag, loc, "예문이 '-' 가 아님: \"" + String(sl.ex).slice(0, 20) + '"']);

    /* ── 규칙 10번 — 보기·정답 칸은 성 한 단어, 한 칸 안에서 표기를 섞지 않는다 (2026-09-17) ── */
    const optCells = [];
    if (kind === 'blanks') (Array.isArray(v) ? v : []).forEach(bl => optCells.push(...(bl.opts || [])));
    else if (kind === 'text') { if (v && v.ans) optCells.push(v.ans); }
    else optCells.push(...(v.opts || []));
    optCells.forEach(o => {
      (NAME_OK.has(tag) ? [] : 풀네임(o)).forEach(fn => bad.push([tag, loc, '보기/정답 "' + fn
        + '" — 보기·정답 칸은 성 한 단어만 쓴다 (규칙 10번)']));
      표기혼용(o).forEach(m => bad.push([tag, loc, '보기 칸 표기 혼용 ' + m + ' (규칙 10번)']));
    });
    ['q', 'ex', 'sol'].forEach(f => 표기혼용(sl[f]).forEach(m =>
      bad.push([tag, loc, f + ' 칸 표기 혼용 ' + m + ' — 한 칸 안에서 섞지 않는다 (규칙 10번)'])));

    /* ── 규칙 11번(경고) — 3·6번 정답 문구가 [문제]·[예문]에 글자 그대로 드러나는가 ──
       5번(직접 입력)은 예문이 정답을 유추하게 하는 것이 설계이므로 대상이 아니다. */
    if (kind === 'single' || kind === 'multi') {
      const idx = kind === 'single' ? [v.ans] : (v.ans || []);
      const stem = String(sl.q || '') + ' ' + String(sl.ex || '');
      idx.forEach(n => {
        const t = String((v.opts || [])[n - 1] || '').trim();
        if (t.length >= 3 && stem.indexOf(t) >= 0)
          bad.push([tag, loc, '정답 보기 "' + t
            + '" 가 [문제]/[예문]에 그대로 있음 (규칙 11번) — 사람이 판단', 'W']);
      });
    }
  });

  /* ── 규칙 12번(경고) — 1번 두 빈칸 · 3번 단수 · 6번 복수의 정답 번호가 몰리지 않는가 (2026-09-17) ──
     자연스러운 배열(크기순·시간순)을 지키느라 몰린 것이면 자기검수 23번에 사유를 적으면 통과다.
     그래서 오류가 아니라 경고다. */
  const nums = [];
  if (d.slots[0] && Array.isArray(d.slots[0].blanks)) d.slots[0].blanks.forEach(bl => nums.push(bl.ans));
  if (d.slots[2] && d.slots[2].single) nums.push(d.slots[2].single.ans);
  if (d.slots[5] && d.slots[5].multi) nums.push(...(d.slots[5].multi.ans || []));
  if (nums.length >= 4) {
    const cnt = {};
    nums.forEach(n => { cnt[n] = (cnt[n] || 0) + 1; });
    const top = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0];
    if (top[1] >= nums.length - 1)
      bad.push([tag, '1·3·6', '정답 번호 [' + nums.join(' ') + '] — ' + top[0] + '번이 '
        + top[1] + '/' + nums.length + ' (규칙 12번) — 사유가 있으면 통과', 'W']);
  }

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
const errs = all.filter(r => r[3] !== 'W');
const warns = all.filter(r => r[3] === 'W');

console.log(C.b + '퀴즈 JSON 검증' + C.x + ' — 파일 ' + files.length + '건 · 문항 ' + (files.length * 7) + '개');
if (warns.length) {
  console.log(C.y + '[경고 ' + warns.length + '건 — 사람이 판단, 실패로 세지 않음]' + C.x);
  warns.forEach(([t, l, msg]) => console.log('  ' + t.padEnd(30) + String(l).padEnd(6) + msg));
}
if (errs.length) {
  console.log('\n' + C.r + '[불일치 ' + errs.length + '건]' + C.x);
  errs.forEach(([t, l, msg]) => console.log('  ' + t.padEnd(30) + String(l).padEnd(6) + msg));
  console.log('\n' + C.y + '※ 구조 검사입니다. 정답이 원고 내용에 맞는지는 검수용 CSV에서 사람이 확인해야 합니다.' + C.x);
  process.exit(1);
}
console.log('\n' + C.g + '전항목 통과' + C.x
  + ' — 고정 배열 · 정답 범위 · 순서 순열 · 라벨 표기 · 빈칸 밑줄 표기 · 고정 발문 · 예문 표기');
console.log(C.y + '※ 구조만 검사했습니다. 정답이 원고 내용에 맞는지는 검수용 CSV에서 사람이 확인해야 합니다.' + C.x);
