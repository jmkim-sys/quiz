"""팀 Google 시트의 «초록 칸»을 세어 기획자 검수 완료 수를 파일로 남긴다.

무엇을 하나
-----------
기획자는 검수를 마친 아티클의 이름 칸(각 탭 C열)을 초록(#00ff00)으로 칠해 표시한다.
그 색을 Apps Script `readWithColor`로 읽어 대단원별로 세고,
`산출물/검수완료_시트.json` 에 적는다. 대시보드(`산출물/도구/build-dashboard.js`)가
그 파일을 읽어 「기획자 검수 필요 파일」 수를 계산한다.

왜 파일로 남기나
----------------
대시보드 집계 원본은 로컬 파일이라는 것이 2026-09-16 사용자 결정이다("로컬로 처리하는게 맞을듯").
대시보드를 만들 때마다 시트를 부르면 네트워크가 끊길 때 수치가 조용히 달라진다.
읽기(이 스크립트)와 집계(대시보드)를 갈라 두면, 언제 읽은 값인지도 화면에 적을 수 있다.

2026-09-29 이전에는 이 수를 기계로 알 길이 없어 사용자가 불러 주는 숫자를
`build-dashboard.js`의 `DISPLAY_ADJUST.reviewNeed`에 손으로 적었다. 이 스크립트가 그것을 대신한다.

쓰는 법
-------
    py tools/read_sheet_green.py

⚠️ 탭 이름은 아래 TABS에 적힌 «글자 그대로»여야 한다 (규칙 3번 — 추측해서 넣지 않는다).
"""

import os
import sys
import json
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

# 아티클 이름이 있는 열. 초록은 이 칸에만 칠해져 있다.
# 400행이면 가장 긴 7단원(42아티클 x 7행 = 294행)도 넉넉히 덮는다.
RANGE = "C1:C400"


def read_tab(tab_name):
    """탭 하나의 C열을 읽어 (아티클 이름 목록, 초록인 이름 목록)을 돌려준다."""

    r = requests.post(
        URL,
        json={"secret": SECRET, "action": "readWithColor",
              "sheet": tab_name, "range": RANGE},
        timeout=90,
    )
    r.raise_for_status()
    data = r.json()

    if not data.get("ok"):
        raise RuntimeError(f"{tab_name} — {data.get('error', 'Apps Script 오류')}")

    cells = [c for row in data.get("values", []) for c in row]
    filled = [c for c in cells if (c.get("value") or "").strip()]

    # C1은 머리글(`아티클`)이므로 뺀다. 이 한 칸을 빼야 로컬 CSV의 아티클 수와 맞는다.
    arts = filled[1:]

    names = [c["value"].strip() for c in arts]
    green = [c["value"].strip() for c in arts if c.get("isGreen")]
    return names, green


def main():
    print()
    print("팀 시트에서 초록 칸(= 기획자 검수 완료)을 읽습니다.")
    print("-" * 72)

    units = {}
    total_arts = total_green = 0

    for no, tab in TABS:
        names, green = read_tab(tab)
        units[str(no)] = {
            "탭": tab,
            "아티클": len(names),
            "검수완료": len(green),
            "검수완료_아티클": green,
        }
        total_arts += len(names)
        total_green += len(green)
        print(f"{no}단원  아티클 {len(names):3d} · 검수 완료 {len(green):3d}   {tab}")

    print("-" * 72)
    print(f"합계    아티클 {total_arts:3d} · 검수 완료 {total_green:3d}")

    # 2026-09-29 — 값이 그대로면 파일을 건드리지 않는다.
    # 이 스크립트는 1시간마다 자동으로 돈다(`tools/auto_update.ps1`). 매번 시각을 새로 적으면
    # 초록 칸이 하나도 안 바뀐 날에도 파일이 달라져 **빈 커밋이 하루 24개씩 쌓인다.**
    # 그래서 검수 완료 수와 아티클 목록이 이전과 같으면 그대로 두고 끝낸다.
    # `갱신시각`은 따라서 «마지막으로 읽은 때»가 아니라 «수치가 마지막으로 바뀐 때»다.
    previous = {}
    if OUT.exists():
        try:
            with open(OUT, encoding="utf-8") as f:
                previous = json.load(f)
        except Exception:
            previous = {}

    if previous.get("대단원") == units and previous.get("검수완료수") == total_green:
        print()
        print("지난번과 같습니다 — 파일을 고치지 않았습니다.",
              f"(마지막 변화: {previous.get('갱신시각', '모름')})")
        return

    result = {
        "갱신시각": datetime.datetime.now().isoformat(timespec="seconds"),
        "출처": "팀 Google 시트 · readWithColor · 각 탭 C열 배경색(#00ff00 = 검수 완료)",
        "아티클수": total_arts,
        "검수완료수": total_green,
        "대단원": units,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print()
    print("저장:", OUT.relative_to(ROOT))
    print("이어서 대시보드를 갱신하세요:  node \"산출물/도구/build-dashboard.js\"")


if __name__ == "__main__":
    main()
