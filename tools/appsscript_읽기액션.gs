/* ============================================================================
   STORY 퀴즈 — Apps Script 읽기 액션 (2026-09-16 신설)

   무엇을 하나: 팀 Google 시트를 **읽어서** JSON으로 돌려준다. 대시보드를 시트 기준으로
   집계하려면 이 기능이 필요하다 — 현재 웹앱의 `doGet`은 파라미터를 무시하고 상태 문구만
   돌려주고 있어(`action=list/sheets/read/status` 모두 같은 응답) 시트를 읽을 방법이 없다.

   어떻게 넣나:
     1) 팀 시트에서 [확장 프로그램] → [Apps Script] 를 연다.
     2) **기존 `doGet` 함수를 아래 `doGet`으로 교체**한다. (지금 것은 상태 문구만 돌려주므로
        잃을 기능이 없다. `doPost`는 건드리지 않는다 — 반영 기능은 그대로 둔다.)
     3) 아래 나머지 함수들을 파일 끝에 붙여 넣는다.
     4) [배포] → [배포 관리] → 연필 아이콘 → 버전 `새 버전` → [배포].
        ⚠️ **URL이 바뀌지 않도록 "새 배포"가 아니라 "배포 관리"에서 버전만 올린다.**
        URL이 바뀌면 `.env`의 `GOOGLE_SHEET_WEBAPP_URL`도 함께 고쳐야 한다.

   확인:
     python -c "import os,requests;from dotenv import load_dotenv;load_dotenv('.env');
       print(requests.get(os.getenv('GOOGLE_SHEET_WEBAPP_URL'),
       params={'secret':os.getenv('GOOGLE_SHEET_SECRET'),'action':'tabs'}).text[:500])"

   보안: 기존 `doPost`와 같은 `secret`을 요구한다. 시트를 **읽기만** 하고 쓰지 않는다.
   ============================================================================ */

function doGet(e) {
  var p = (e && e.parameter) || {};

  if (p.secret !== SECRET_VALUE_()) {
    return json_({ success: false, message: '인증 실패' });
  }

  var action = p.action || '';

  try {
    if (action === 'tabs')  return json_({ success: true, tabs: listTabs_() });
    if (action === 'dump')  return json_({ success: true, sheets: dumpSheets_(p.sheet) });
    /* action이 없거나 모르는 값이면 종전처럼 상태 문구를 돌려준다 (기존 동작 유지) */
    return json_({
      success: true,
      message: 'STORY 퀴즈 Google Sheets API가 정상 작동 중입니다.',
      actions: ['tabs', 'dump']
    });
  } catch (err) {
    return json_({ success: false, message: String(err) });
  }
}

/* ── secret 값을 한 군데서 가져온다 ───────────────────────────────────────────
   기존 doPost가 secret을 어떤 이름으로 들고 있는지 모르므로, 여기서 그 값을 그대로
   돌려주도록 한 줄만 맞춰 주면 된다.
   예) 기존 코드가 `var SECRET = 'xxxx';` 라면  →  return SECRET;
       스크립트 속성을 쓰고 있다면          →  return PropertiesService.getScriptProperties().getProperty('SECRET');
   ⚠️ 이 파일에 secret 값을 직접 적지 않는다 (git에 올라간다). */
function SECRET_VALUE_() {
  return SECRET;   /* ← 기존 doPost가 쓰는 secret 변수/함수 이름으로 맞출 것 */
}

/* ── 탭 목록 ─────────────────────────────────────────────────────────────── */
function listTabs_() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheets().map(function (sh) {
    return {
      name: sh.getName(),
      rows: sh.getLastRow(),
      cols: sh.getLastColumn()
    };
  });
}

/* ── 탭 내용 ─────────────────────────────────────────────────────────────────
   sheetName을 주면 그 탭만, 없으면 전부 돌려준다.
   값은 **시트에 있는 그대로** 문자열로 담는다 — 여기서 가공하면 대시보드 수치가
   시트와 달라진다 (CLAUDE.md 규칙 3번: 원본에 없는 값을 만들지 않는다). */
function dumpSheets_(sheetName) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = sheetName ? [ss.getSheetByName(sheetName)] : ss.getSheets();

  if (sheetName && !sheets[0]) throw new Error('탭을 찾을 수 없습니다: ' + sheetName);

  return sheets.map(function (sh) {
    var lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
    var values = (lastRow < 1 || lastCol < 1)
      ? []
      : sh.getRange(1, 1, lastRow, lastCol).getDisplayValues();
    return { name: sh.getName(), rows: values };
  });
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
