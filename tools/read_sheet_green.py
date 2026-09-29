"""팀 Google 시트의 «초록 칸»을 세어 기획자 검수 완료 수를 파일로 남긴다.

무엇을 하나
-----------
기획자는 검수를 마친 아티클 줄을 초록(#00ff00)으로 칠해 표시한다. 그 색을 Apps Script
`readWithColor`로 읽어 대단원별로 세고 `산출물/검수완료_시트.json` 에 적는다.
대시보드(`산출물/도구/build-dashboard.js`)가 그 파일을 읽어 KPI와 대단원별 표시를 만든다.

왜 파일로 남기나
----------------
대시보드 집계 원본은 로컬 파일이라는 것이 2026-09-16 사용자 결정이다("로컬로 처리하는게 맞을듯").
대시보드를 만들 때마다 시트를 부르면 네트워크가 끊길 때 수치가 조용히 달라진다.
읽기(이 스크립트)와 집계(대시보드)를 갈라 두면 언제 값이 바뀌었는지도 화면에 적을 수 있다.

2026-09-29 이전에는 이 수를 기계로 알 길이 없어 사용자가 불러 주는 숫자를
`build-dashboard.js`의 `DISPLAY_ADJUST.reviewNeed`에 손으로 적었다. 이 스크립트가 그것을 대신한다.

쓰는 법
-------
    py tools/read_sheet_green.py

1시간마다 자동으로도 돈다 — `tools/auto_update.ps1` (작업 스케줄러 STORY-Quiz-Dashboard-Hourly).
"""

import os
import sys
import json
import time
import datetime
from pathlib import Path

import requests
from dotenv import load_dotenv


# Windows 콘솔 기본 코드페이지(cp949)로는 탭 이름의 `—`(em dash)를 찍지 못해 죽는다.
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass


ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "산출물" / "검수완료_시트.json"

load_dotenv(ROOT / ".env")
URL = os.getenv("GOOGLE_SHEET_WEBAPP_URL")
SECRET = os.getenv("GOOGLE_SHEET_SECRET")

if not URL or not SECRET:
    raise RuntimeError("GOOGLE_SHEET_WEBAPP_URL / GOOGLE_SHEET_SECRET 이 .env에 없습니다.")


# ── 탭 이름 (2026-09-29 사용자가 시트에서 복사해 준 것) ────────────────────────
# ⚠️ 두 가지 함정이 있다. 둘 다 실제로 겪었고, 추측으로는 맞힐 수 없었다.
#   ① 대단원명과 부제 사이는 하이픈(-)이 아니라 **em dash(—)** 다.
#      목차 xlsx와 `산출물/대단원별/*.csv`는 하이픈이라 그대로 보내면 못 찾는다.
#   ② **공백이 두 칸인 자리가 있다** — `0. 프롤로그␣␣과학이란`, `1.␣␣빅뱅`.
#      0·1·8번은 `N. 이름 — 부제` 규칙에서도 벗어난다(8번은 `에필로그 우리의 미래 —`).
# 우리 쪽 파일에는 탭 이름이 어디에도 없다. 퀴즈 전송이 탭을 **단원 번호**로 찾기 때문이다
# (`quiz_update.json`의 `"unit": 8` → 탭 찾기는 Apps Script `doPost`가 한다).
# 그래서 이름이 바뀌면 시트에서 복사해 여기만 고치면 된다.
TABS = [
    (0, "0. 프롤로그  과학이란 무엇인가 — 자연을 읽는 언어"),
    (1, "1.  빅뱅 — 우주의 시작"),
    (2, "2. 별 — 원소를 만드는 공장"),
    (3, "3. 물질 — 원자가 만드는 세계"),
    (4, "4. 힘과 에너지 — 변화의 법칙"),
    (5, "5. 빛과 전자기 — 정보의 언어"),
    (6, "6. 지구 — 살아 있는 행성"),
    (7, "7. 생명 — 진화하는 정보"),
    (8, "8. 에필로그 우리의 미래 — 138억 년의 다음 장"),
]

# ⚠️ **B열(중단원)까지 읽는다.** 기획자가 아티클 칸(C)이 아니라 중단원 칸(B)을 칠할 때가 있다.
# 2026-09-29에 B열 10칸이 그렇게 칠해져 있었고(나중에 C열로 옮겨졌다), C열만 세던 때는
# 그 10건이 통째로 빠져 52건으로 나왔다. 실제는 63건이었다.
# 9개 탭을 17열 x 900행까지 훑어 초록이 B·C 밖에는 없음을 확인했다.
# 가장 긴 7단원이 42아티클 x 7행 + 머리글 1행 = 295행이라 300이면 넉넉하다.
# ⚠️ **400으로 늘리지 마라.** 범위를 키우면 웹앱이 데이터 대신 기본 응답을 돌려주는 일이 잦아진다
# (아래 read_tab 주석 참고). 필요한 만큼만 요청하는 것이 이 엔드포인트에서는 안정성 문제다.
RANGE = "A1:C300"

# 아티클 한 건 = 7행이고 첫 아티클이 2행에서 시작한다. 블록 번호 = (행 - 2) // 7.
# **칸이 아니라 블록을 센다** — 한 아티클의 B와 C를 둘 다 칠해도 1건으로 세기 위해서다.
BLOCK_ROWS = 7
FIRST_ROW = 2

TRIES = 4           # 실패 시 재시도 횟수
PAUSE = 1.5         # 탭 사이 쉬는 시간(초) — 몰아치면 엔드포인트가 흔들린다


def fetch(tab_name):
    """탭 하나의 값+배경색을 받아 온다. 흔들리는 응답을 재시도로 넘긴다.

    ⚠️ **이 엔드포인트는 실패를 «성공처럼» 돌려준다.** 2026-09-29에 확인한 실제 응답:

        A1:C400 →  {"ok": true, "message": "Apps Script Web App is running"}   ← values 없음
        A1:C40  →  정상
        C1:C400 →  정상

    `ok`가 true라서 오류 검사를 통과하고, `values`가 없으니 «아티클 0개»로 읽힌다.
    그대로 저장하면 그 대단원이 화면에서 통째로 0이 된다 — 10:01 자동 실행에서 0단원·8단원이
    실제로 그렇게 덮였다. 그래서 **`values` 키가 없으면 실패로 보고 다시 시도한다.**
    요청을 몰아치면 JSON이 아닌 HTML 오류 페이지가 오기도 하므로 그것도 재시도 대상이다.
    """
    last = ""
    for attempt in range(TRIES):
        try:
            r = requests.post(
                URL,
                json={"secret": SECRET, "action": "readWithColor",
                      "sheet": tab_name, "range": RANGE},
                timeout=90,
            )
            r.raise_for_status()
            data = r.json()

            if not data.get("ok"):
                # 탭 이름이 틀린 것은 다시 시도해도 소용없다 — 바로 세운다.
                raise SystemExit(f"[중단] {tab_name} — {data.get('error', 'Apps Script 오류')}")

            if "values" in data:
                return data["values"], attempt

            last = str(data)[:120]          # ok:true 인데 values 없음 = 위에 적은 그 현상
        except SystemExit:
            raise
        except Exception as e:
            last = f"{type(e).__name__}: {e}"

        time.sleep(2 + 2 * attempt)

    raise RuntimeError(f"{tab_name} — {TRIES}번 시도했지만 값을 받지 못했습니다. 마지막 응답: {last}")


def read_tab(tab_name):
    """탭 하나를 읽어 (아티클 이름 목록, 검수 완료 아티클 이름 목록)을 돌려준다."""

    rows, retried = fetch(tab_name)
    if retried:
        print(f"  [참고] {tab_name} — {retried}번 다시 시도해서 받았습니다.")

    # ── 초록이 칠해진 «블록 번호»를 모은다 (B열이든 C열이든) ──
    green_blocks = set()
    for r_index, row in enumerate(rows, start=1):
        if r_index < FIRST_ROW:
            continue
        if any(c.get("isGreen") for c in row):
            green_blocks.add((r_index - FIRST_ROW) // BLOCK_ROWS)

    # ── 아티클 이름은 C열에서 읽는다 (블록 첫 행에만 적혀 있다) ──
    names, green = [], []
    for r_index, row in enumerate(rows, start=1):
        if r_index < FIRST_ROW or len(row) < 3:
            continue
        value = (row[2].get("value") or "").strip()
        if not value:
            continue
        names.append(value)
        if (r_index - FIRST_ROW) // BLOCK_ROWS in green_blocks:
            green.append(value)

    # 블록 수와 이름 수가 어긋나면 7행 묶음 가정이 깨진 것이므로 조용히 넘기지 않는다.
    if len(green) != len(green_blocks):
        print(f"  [주의] {tab_name} — 초록 블록 {len(green_blocks)}개인데 아티클명은 "
              f"{len(green)}개입니다. 7행 묶음이 아닌 자리가 있는지 확인하세요.")

    return names, green


def main():
    print()
    print("팀 시트에서 초록 칸(= 기획자 검수 완료)을 읽습니다.")
    print("-" * 72)

    previous = {}
    if OUT.exists():
        try:
            with open(OUT, encoding="utf-8") as f:
                previous = json.load(f)
        except Exception:
            previous = {}
    prev_units = previous.get("대단원", {})

    units = {}
    total_arts = total_green = 0
    suspicious = []

    for no, tab in TABS:
        names, green = read_tab(tab)

        # ⚠️ 빈 응답으로 좋은 값을 덮어쓰지 않는다.
        # 2026-09-29 10:01 자동 실행에서 0단원·8단원이 «아티클 0개»로 들어와 파일에 그대로 적혔다.
        # 오류가 아니라 정상 응답이었고(ok: true), 곧바로 다시 읽으니 5개·6개가 멀쩡히 나왔다.
        # 원인은 못 밝혔지만(시트 편집 중이었을 수 있다), 한 번의 이상한 읽기가 대시보드를
        # 0으로 만들어서는 안 된다. 전에 있던 아티클이 통째로 사라지면 **파일을 쓰지 않고 멈춘다.**
        was = int((prev_units.get(str(no)) or {}).get("아티클", 0))
        if not names and was:
            suspicious.append(f"{no}단원({tab}) — 전에는 {was}개였는데 이번엔 0개")

        units[str(no)] = {
            "탭": tab,
            "아티클": len(names),
            "검수완료": len(green),
            "검수완료_아티클": green,
        }
        total_arts += len(names)
        total_green += len(green)
        print(f"{no}단원  아티클 {len(names):3d} · 검수 완료 {len(green):3d}   {tab}")
        time.sleep(PAUSE)      # 몰아치면 엔드포인트가 흔들린다 (fetch 주석 참고)

    print("-" * 72)
    print(f"합계    아티클 {total_arts:3d} · 검수 완료 {total_green:3d}")

    if suspicious:
        print()
        print("[중단] 아티클이 통째로 비어 돌아온 탭이 있어 파일을 고치지 않았습니다.")
        for line in suspicious:
            print("   ", line)
        print("    잠시 뒤 다시 돌려 보세요. 계속 그렇다면 시트 탭이 바뀌었는지 확인하세요.")
        raise SystemExit(1)

    # 값이 그대로면 파일을 건드리지 않는다.
    # 이 스크립트는 1시간마다 자동으로 돈다(`tools/auto_update.ps1`). 매번 시각을 새로 적으면
    # 초록 칸이 하나도 안 바뀐 날에도 파일이 달라져 **빈 커밋이 하루 24개씩 쌓인다.**
    # 그래서 `갱신시각`은 «마지막으로 읽은 때»가 아니라 «수치가 마지막으로 바뀐 때»다.
    if prev_units == units and previous.get("검수완료수") == total_green:
        print()
        print("지난번과 같습니다 — 파일을 고치지 않았습니다.",
              f"(마지막 변화: {previous.get('갱신시각', '모름')})")
        return

    result = {
        "갱신시각": datetime.datetime.now().isoformat(timespec="seconds"),
        "출처": "팀 Google 시트 · readWithColor · B·C열 배경색(#00ff00 = 검수 완료) · 아티클 7행 묶음 단위",
        "아티클수": total_arts,
        "검수완료수": total_green,
        "대단원": units,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print()
    print("저장:", OUT.relative_to(ROOT))
    print('이어서 대시보드를 갱신하세요:  node "산출물/도구/build-dashboard.js"')


if __name__ == "__main__":
    main()
