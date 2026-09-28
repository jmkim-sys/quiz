import os
import sys
import json
import requests
from pathlib import Path
from dotenv import load_dotenv


# 2026-09-29 추가 — Windows 콘솔 기본 코드페이지(cp949)로는 아티클명의 `—`(em dash)를 찍지 못해
# 초록 칸 목록을 출력하는 마지막 루프에서 UnicodeEncodeError로 죽는다. 시트는 이미 읽어 온 뒤라
# 결과를 못 본 채 끝난다. `update_google_sheet.py`가 같은 이유로 이미 이 처리를 하고 있다.
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass


# ============================================================
# 프로젝트 경로
# ============================================================

ROOT = Path(__file__).resolve().parent.parent

ENV_FILE = ROOT / ".env"

OUTPUT_FILE = (
    ROOT
    / "AI"
    / "SHEET_READ.json"
)


# ============================================================
# .env 읽기
# ============================================================

load_dotenv(ENV_FILE)

URL = os.getenv(
    "GOOGLE_SHEET_WEBAPP_URL"
)

SECRET = os.getenv(
    "GOOGLE_SHEET_SECRET"
)


if not URL:
    raise RuntimeError(
        "GOOGLE_SHEET_WEBAPP_URL이 "
        ".env에 없습니다."
    )

if not SECRET:
    raise RuntimeError(
        "GOOGLE_SHEET_SECRET이 "
        ".env에 없습니다."
    )


# ============================================================
# Apps Script 요청
# ============================================================

def call_apps_script(
    sheet_name,
    range_name
):

    payload = {
        "secret": SECRET,
        "action": "readWithColor",
        "sheet": sheet_name,
        "range": range_name
    }

    response = requests.post(
        URL,
        json=payload,
        timeout=60
    )

    response.raise_for_status()

    try:
        data = response.json()

    except Exception:

        print()
        print(
            "Apps Script가 JSON이 아닌 "
            "응답을 반환했습니다."
        )

        print()
        print(response.text)

        raise

    if not data.get("ok"):

        raise RuntimeError(
            data.get(
                "error",
                "Apps Script 오류"
            )
        )

    return data


# ============================================================
# 열 번호 → A, B, C...
# ============================================================

def column_letter(number):

    result = ""

    while number:

        number, remainder = divmod(
            number - 1,
            26
        )

        result = (
            chr(65 + remainder)
            + result
        )

    return result


# ============================================================
# 시작 셀 좌표 계산
#
# A1:Q100 → row=1 / column=1
# G50:Q100 → row=50 / column=7
# ============================================================

def parse_start_cell(
    range_name
):

    import re

    start = range_name.split(":")[0]

    match = re.match(
        r"^([A-Za-z]+)(\d+)$",
        start
    )

    if not match:

        raise ValueError(
            "범위는 A1:Q100 같은 "
            "형식으로 입력하세요."
        )

    letters = (
        match.group(1).upper()
    )

    row = int(
        match.group(2)
    )

    column = 0

    for char in letters:

        column = (
            column * 26
            + ord(char)
            - ord("A")
            + 1
        )

    return row, column


# ============================================================
# Claude용 데이터 변환
# ============================================================

def convert_data(
    sheet_name,
    range_name,
    data
):

    rows = data.get(
        "values",
        []
    )

    start_row, start_column = (
        parse_start_cell(
            range_name
        )
    )

    result_rows = []

    green_cells = []


    for r_index, row in enumerate(
        rows
    ):

        actual_row = (
            start_row + r_index
        )

        converted_row = []


        for c_index, cell in enumerate(
            row
        ):

            actual_column = (
                start_column + c_index
            )

            col_letter = column_letter(
                actual_column
            )

            a1 = (
                f"{col_letter}"
                f"{actual_row}"
            )


            converted_cell = {

                "cell": a1,

                "row": actual_row,

                "column": actual_column,

                "value": cell.get(
                    "value",
                    ""
                ),

                "background": cell.get(
                    "background",
                    ""
                ),

                "isGreen": bool(
                    cell.get(
                        "isGreen",
                        False
                    )
                )

            }


            converted_row.append(
                converted_cell
            )


            if converted_cell[
                "isGreen"
            ]:

                green_cells.append(
                    converted_cell
                )


        result_rows.append(
            converted_row
        )


    return {

        "sheet": sheet_name,

        "range": range_name,

        "greenCellCount":
            len(green_cells),

        "greenCells":
            green_cells,

        "rows":
            result_rows

    }


# ============================================================
# 실행
# ============================================================

def main():

    # ----------------------------------------
    # 사용법 확인
    # ----------------------------------------

    if len(sys.argv) < 3:

        print()
        print("사용법:")
        print()

        print(
            'py tools/read_google_sheet.py '
            '"탭 이름" "범위"'
        )

        print()
        print("예:")
        print()

        print(
            'py tools/read_google_sheet.py '
            '"3. 물질" "A1:Q100"'
        )

        raise SystemExit(1)


    sheet_name = sys.argv[1]

    range_name = sys.argv[2]


    print()
    print(
        "================================"
    )

    print(
        " Google Sheets 읽기"
    )

    print(
        "================================"
    )

    print()
    print(
        "탭:",
        sheet_name
    )

    print(
        "범위:",
        range_name
    )


    # ----------------------------------------
    # Apps Script 호출
    # ----------------------------------------

    data = call_apps_script(
        sheet_name,
        range_name
    )


    # ----------------------------------------
    # Claude용 데이터 생성
    # ----------------------------------------

    result = convert_data(
        sheet_name,
        range_name,
        data
    )


    # ----------------------------------------
    # 저장
    # ----------------------------------------

    OUTPUT_FILE.parent.mkdir(
        parents=True,
        exist_ok=True
    )


    with open(
        OUTPUT_FILE,
        "w",
        encoding="utf-8"
    ) as f:

        json.dump(
            result,
            f,
            ensure_ascii=False,
            indent=2
        )


    # ----------------------------------------
    # 결과
    # ----------------------------------------

    print()
    print(
        "초록색 셀:",
        result["greenCellCount"],
        "개"
    )


    if result["greenCells"]:

        print()
        print(
            "----- 초록색 셀 -----"
        )

        for cell in result[
            "greenCells"
        ]:

            print(
                f"{cell['cell']} | "
                f"{cell['value']} | "
                f"{cell['background']}"
            )


    print()
    print(
        "저장:"
    )

    print(
        OUTPUT_FILE.relative_to(
            ROOT
        )
    )

    print()
    print(
        "✅ 읽기 완료"
    )


if __name__ == "__main__":
    main()