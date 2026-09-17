import json
import re
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent

TOOL_DIR = ROOT / "산출물" / "도구"
QUIZ_DIR = ROOT / "산출물" / "퀴즈데이터"

CURRENT_TASK_FILE = ROOT / "AI" / "CURRENT_TASK.json"

VALIDATOR = TOOL_DIR / "퀴즈JSON검증.js"
CSV_GENERATOR = TOOL_DIR / "퀴즈CSV생성.js"


# =========================
# 문자열 정리
# =========================

def normalize(text):
    text = str(text or "").lower().strip()

    return re.sub(
        r"[^0-9a-z가-힣]",
        "",
        text
    )


# =========================
# 파일 확인
# =========================

def check_file(path, name):

    if not path.exists():
        print()
        print(f"{name}을 찾을 수 없습니다.")
        print(path)
        raise SystemExit(1)


# =========================
# CURRENT_TASK 읽기
# =========================

def load_current_task():

    check_file(
        CURRENT_TASK_FILE,
        "CURRENT_TASK.json"
    )

    try:
        with open(
            CURRENT_TASK_FILE,
            "r",
            encoding="utf-8"
        ) as f:
            return json.load(f)

    except json.JSONDecodeError:
        print("CURRENT_TASK.json 형식이 올바르지 않습니다.")
        raise SystemExit(1)


# =========================
# 현재 작업의 JSON 찾기
# =========================

def find_quiz_json(task):

    if not QUIZ_DIR.exists():
        print("퀴즈데이터 폴더가 없습니다.")
        print(QUIZ_DIR)
        raise SystemExit(1)

    middle = normalize(
        task.get("middleUnit")
    )

    article = normalize(
        task.get("article")
    )

    json_files = list(
        QUIZ_DIR.glob("*.json")
    )

    # -------------------------
    # 1차
    # 파일명에 중단원 + 아티클
    # -------------------------

    candidates = []

    for path in json_files:

        key = normalize(path.stem)

        if (
            middle
            and article
            and middle in key
            and article in key
        ):
            candidates.append(path)

    if len(candidates) == 1:
        return candidates[0]

    if len(candidates) > 1:
        print()
        print("현재 작업과 일치하는 JSON이 여러 개입니다.")

        for path in candidates:
            print("-", path.relative_to(ROOT))

        print()
        print("임의 선택하지 않습니다.")
        raise SystemExit(1)

    # -------------------------
    # 2차
    # 파일명에 아티클
    # -------------------------

    candidates = []

    for path in json_files:

        key = normalize(path.stem)

        if article and article in key:
            candidates.append(path)

    if len(candidates) == 1:
        return candidates[0]

    if len(candidates) > 1:
        print()
        print("아티클명과 일치하는 JSON이 여러 개입니다.")

        for path in candidates:
            print("-", path.relative_to(ROOT))

        print()
        print("임의 선택하지 않습니다.")
        raise SystemExit(1)

    # -------------------------
    # 3차
    # JSON 내부 내용으로 찾기
    # -------------------------

    candidates = []

    for path in json_files:

        try:
            with open(
                path,
                "r",
                encoding="utf-8-sig"
            ) as f:
                data = json.load(f)

        except Exception:
            continue

        text = normalize(
            json.dumps(
                data,
                ensure_ascii=False
            )
        )

        if (
            middle
            and article
            and middle in text
            and article in text
        ):
            candidates.append(path)

    if len(candidates) == 1:
        return candidates[0]

    if len(candidates) > 1:
        print()
        print("JSON 내부 기준으로 후보가 여러 개입니다.")

        for path in candidates:
            print("-", path.relative_to(ROOT))

        print()
        print("임의 선택하지 않습니다.")
        raise SystemExit(1)

    print()
    print("현재 작업에 해당하는 JSON을 찾지 못했습니다.")
    print()
    print("중단원 :", task.get("middleUnit"))
    print("아티클 :", task.get("article"))

    raise SystemExit(1)


# =========================
# 명령 실행
# =========================

def run(command, title):

    print()
    print(f"===== {title} =====")

    result = subprocess.run(
        command,
        cwd=ROOT
    )

    if result.returncode != 0:
        print()
        print(f"❌ {title} 실패")
        print("후속 작업을 중단합니다.")
        raise SystemExit(
            result.returncode
        )

    print()
    print(f"✅ {title} 완료")


# =========================
# 실행
# =========================

def main():

    check_file(
        VALIDATOR,
        "퀴즈 JSON 검증기"
    )

    check_file(
        CSV_GENERATOR,
        "퀴즈 CSV 생성기"
    )

    print()
    print("================================")
    print(" STORY 퀴즈 자동 처리")
    print("================================")

    # 1. 현재 작업 확인

    task = load_current_task()

    print()
    print("현재 작업")
    print("중단원 :", task.get("middleUnit"))
    print("아티클 :", task.get("article"))

    # 2. JSON 자동 탐색

    print()
    print("1. 생성된 JSON 탐색 중...")

    quiz_json = find_quiz_json(
        task
    )

    print(
        "   발견:",
        quiz_json.relative_to(ROOT)
    )

    # 3. JSON 검증

    run(
        [
            "node",
            str(VALIDATOR),
            str(quiz_json)
        ],
        "2. JSON 검증"
    )

    # 4. CSV 생성

    run(
        [
            "node",
            str(CSV_GENERATOR),
            str(quiz_json)
        ],
        "3. 검토용 CSV 생성"
    )

    print()
    print("================================")
    print(" 기계 처리 완료")
    print("================================")
    print()
    print("다음 단계: Claude 검토자")


if __name__ == "__main__":
    main()