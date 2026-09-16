import os
import json
import sys
import requests
from pathlib import Path
from dotenv import load_dotenv


# STORY퀴즈_이관패키지 루트 찾기
ROOT_DIR = Path(__file__).resolve().parent.parent

# 루트의 .env 불러오기
load_dotenv(ROOT_DIR / ".env")

URL = os.getenv("GOOGLE_SHEET_WEBAPP_URL")
SECRET = os.getenv("GOOGLE_SHEET_SECRET")


if not URL:
    raise RuntimeError(
        "GOOGLE_SHEET_WEBAPP_URL이 .env에 없습니다."
    )

if not SECRET:
    raise RuntimeError(
        "GOOGLE_SHEET_SECRET이 .env에 없습니다."
    )


def load_quizzes(json_path):
    """JSON 파일에서 퀴즈 배열을 읽는다."""

    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    # [{...}, {...}] 형식도 허용
    if isinstance(data, list):
        return data

    # {"quizzes": [...]} 형식
    if isinstance(data, dict) and isinstance(data.get("quizzes"), list):
        return data["quizzes"]

    raise ValueError(
        'JSON은 {"quizzes": [...]} 또는 [...] 형식이어야 합니다.'
    )


def update_google_sheet(quizzes):
    """Apps Script 웹 앱으로 퀴즈들을 전송한다."""

    payload = {
        "secret": SECRET,
        "quizzes": quizzes
    }

    print(f"{len(quizzes)}개 퀴즈를 Google Sheets에 전송합니다...")

    response = requests.post(
        URL,
        json=payload,
        timeout=120
    )

    response.raise_for_status()

    try:
        result = response.json()
    except ValueError:
        print("서버가 JSON이 아닌 응답을 반환했습니다.")
        print(response.text)
        raise

    print(
        json.dumps(
            result,
            ensure_ascii=False,
            indent=2
        )
    )

    return result


def main():
    if len(sys.argv) != 2:
        print()
        print("사용법:")
        print(
            "python tools/update_google_sheet.py "
            "quiz_update.json"
        )
        sys.exit(1)

    json_path = Path(sys.argv[1])

    if not json_path.is_absolute():
        json_path = Path.cwd() / json_path

    if not json_path.exists():
        print(f"파일을 찾을 수 없습니다: {json_path}")
        sys.exit(1)

    quizzes = load_quizzes(json_path)

    if len(quizzes) == 0:
        print("전송할 퀴즈가 없습니다.")
        sys.exit(1)

    result = update_google_sheet(quizzes)

    if not result.get("success"):
        print()
        print("일부 또는 전체 퀴즈 반영에 실패했습니다.")

        # 개별 실패 내용 표시
        for item in result.get("results", []):
            if not item.get("success"):
                print(
                    f"- {item.get('unit')}단원 / "
                    f"{item.get('middleUnit')} / "
                    f"{item.get('item')} / "
                    f"{item.get('questionNo')}번: "
                    f"{item.get('message')}"
                )

        sys.exit(1)

    print()
    print("모든 퀴즈가 Google Sheets에 정상 반영되었습니다.")


if __name__ == "__main__":
    main()