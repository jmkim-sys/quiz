import json
import re
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent

# =========================
# 파일 / 폴더
# =========================

CURRENT_TASK = ROOT / "AI" / "CURRENT_TASK.json"
STATUS_FILE = ROOT / "AI" / "STATUS.json"

QUIZ_JSON_DIR = ROOT / "산출물" / "퀴즈데이터"
QUIZ_CSV_DIR = ROOT / "산출물" / "퀴즈CSV"

UPDATE_MASTER = ROOT / "tools" / "update_master_csv.py"
BUILD_UPDATE = ROOT / "tools" / "build_quiz_update.js"
UPDATE_SHEET = ROOT / "tools" / "update_google_sheet.py"
BUILD_STATUS = ROOT / "tools" / "build_status.py"

BUILD_DASHBOARD = (
    ROOT
    / "산출물"
    / "도구"
    / "build-dashboard.js"
)

QUIZ_UPDATE = ROOT / "quiz_update.json"


# =========================
# 공통 함수
# =========================

def normalize(text):
    text = str(text or "").lower().strip()

    return re.sub(
        r"[^0-9a-z가-힣]",
        "",
        text
    )


def die(message):
    print()
    print("❌", message)
    raise SystemExit(1)


def load_json(path):

    if not path.exists():
        die(
            f"파일을 찾을 수 없습니다: {path}"
        )

    try:
        with open(
            path,
            "r",
            encoding="utf-8-sig"
        ) as f:
            return json.load(f)

    except json.JSONDecodeError:
        die(
            f"JSON 형식 오류: {path}"
        )


def check_file(path, name):

    if not path.exists():
        die(
            f"{name}을 찾을 수 없습니다:\n{path}"
        )


def run(command, title):

    print()
    print(
        "================================"
    )
    print(title)
    print(
        "================================"
    )

    result = subprocess.run(
        command,
        cwd=ROOT
    )

    if result.returncode != 0:

        print()
        print(
            f"❌ 실패: {title}"
        )

        print(
            "후속 작업을 중단합니다."
        )

        raise SystemExit(
            result.returncode
        )

    print()
    print(
        f"✅ 완료: {title}"
    )


# =========================
# 현재 작업 JSON 찾기
# =========================

def find_quiz_json(task):

    if not QUIZ_JSON_DIR.exists():
        die(
            "퀴즈데이터 폴더가 없습니다."
        )

    wanted_middle = normalize(
        task.get("middleUnit")
    )

    wanted_article = normalize(
        task.get("article")
    )

    matches = []

    for path in QUIZ_JSON_DIR.glob(
        "*.json"
    ):

        try:

            with open(
                path,
                "r",
                encoding="utf-8-sig"
            ) as f:

                data = json.load(f)

        except Exception:
            continue

        meta = data.get(
            "meta",
            {}
        )

        middle = normalize(
            meta.get("중단원")
        )

        article = normalize(
            meta.get("아티클")
        )

        if article != wanted_article:
            continue

        # 중단원 표기가 약간 달라도
        # 서로 포함되면 허용
        middle_match = (
            not wanted_middle
            or wanted_middle == middle
            or wanted_middle in middle
            or middle in wanted_middle
        )

        if middle_match:
            matches.append(path)

    if len(matches) == 1:
        return matches[0]

    if not matches:

        die(
            "CURRENT_TASK에 해당하는 "
            "퀴즈 JSON을 찾지 못했습니다.\n"
            f"중단원: {task.get('middleUnit')}\n"
            f"아티클: {task.get('article')}"
        )

    print()
    print(
        "현재 작업과 일치하는 "
        "JSON이 여러 개입니다:"
    )

    for path in matches:
        print(
            "-",
            path.relative_to(ROOT)
        )

    die(
        "임의로 선택하지 않습니다."
    )


# =========================
# CURRENT_TASK 종료
# =========================

def finish_current_task():

    if not CURRENT_TASK.exists():
        return

    completed_file = (
        ROOT
        / "AI"
        / "LAST_TASK.json"
    )

    # 현재 작업을 마지막 완료 작업으로 보관
    task = load_json(
        CURRENT_TASK
    )

    with open(
        completed_file,
        "w",
        encoding="utf-8"
    ) as f:

        json.dump(
            task,
            f,
            ensure_ascii=False,
            indent=2
        )

    # CURRENT_TASK 삭제
    CURRENT_TASK.unlink()


# =========================
# 실행
# =========================

def main():

    print()
    print(
        "################################"
    )
    print(
        " STORY 퀴즈 최종 확정"
    )
    print(
        "################################"
    )

    # ---------------------------------
    # 1. 필수 도구 확인
    # ---------------------------------

    check_file(
        CURRENT_TASK,
        "CURRENT_TASK.json"
    )

    check_file(
        UPDATE_MASTER,
        "대단원 누적 CSV 업데이트 도구"
    )

    check_file(
        BUILD_UPDATE,
        "Google Sheets 데이터 생성기"
    )

    check_file(
        UPDATE_SHEET,
        "Google Sheets 업데이트 도구"
    )

    check_file(
        BUILD_DASHBOARD,
        "Dashboard 생성기"
    )

    check_file(
        BUILD_STATUS,
        "STATUS 생성기"
    )

    # ---------------------------------
    # 2. 현재 작업 읽기
    # ---------------------------------

    task = load_json(
        CURRENT_TASK
    )

    print()
    print("현재 확정 작업")
    print(
        "중단원:",
        task.get("middleUnit")
    )
    print(
        "아티클:",
        task.get("article")
    )

    # ---------------------------------
    # 3. 퀴즈 JSON 찾기
    # ---------------------------------

    quiz_json = find_quiz_json(
        task
    )

    article_id = (
        quiz_json.stem
    )

    print()
    print(
        "아티클 ID:",
        article_id
    )

    print(
        "퀴즈 JSON:",
        quiz_json.relative_to(ROOT)
    )

    # ---------------------------------
    # 4. 검수 CSV 확인
    # ---------------------------------

    quiz_csv = (
        QUIZ_CSV_DIR
        / f"{article_id}.csv"
    )

    check_file(
        quiz_csv,
        "검수 완료 CSV"
    )

    print(
        "검수 CSV:",
        quiz_csv.relative_to(ROOT)
    )

    # ---------------------------------
    # 5. 대단원 누적 CSV 반영
    # ---------------------------------

    run(
        [
            sys.executable,
            str(UPDATE_MASTER),
            article_id
        ],
        "1. 대단원 누적 CSV 반영"
    )

    # ---------------------------------
    # 6. Google Sheets용 JSON 생성
    # ---------------------------------

    run(
        [
            "node",
            str(BUILD_UPDATE),
            article_id
        ],
        "2. Google Sheets 전송 데이터 생성"
    )

    check_file(
        QUIZ_UPDATE,
        "quiz_update.json"
    )

    # ---------------------------------
    # 7. Google Sheets 반영
    # ---------------------------------

    run(
        [
            sys.executable,
            str(UPDATE_SHEET),
            str(QUIZ_UPDATE)
        ],
        "3. Google Sheets 반영"
    )

    # ---------------------------------
    # 8. Dashboard 재생성
    # ---------------------------------

    run(
        [
            "node",
            str(BUILD_DASHBOARD)
        ],
        "4. Dashboard 재생성"
    )

    # ---------------------------------
    # 9. STATUS 재계산
    # ---------------------------------

    run(
        [
            sys.executable,
            str(BUILD_STATUS)
        ],
        "5. 진행 현황 재계산"
    )

    # ---------------------------------
    # 10. 결과 확인
    # ---------------------------------

    status = load_json(
        STATUS_FILE
    )

    print()
    print(
        "================================"
    )
    print(
        " 최종 진행 현황"
    )
    print(
        "================================"
    )

    print(
        "전체:",
        status.get("totalCount")
    )

    print(
        "완료:",
        status.get("completedCount")
    )

    print(
        "남음:",
        status.get("remainingCount")
    )

    # ---------------------------------
    # 11. CURRENT_TASK 종료
    # ---------------------------------

    finish_current_task()

    print()
    print(
        "CURRENT_TASK → LAST_TASK 이동 완료"
    )

    # ---------------------------------
    # 완료
    # ---------------------------------

    print()
    print(
        "################################"
    )
    print(
        " 확정 처리 완료"
    )
    print(
        "################################"
    )

    print()
    print(
        f"완료 아티클: {article_id}"
    )

    print()
    print(
        "다음 작업을 시작할 수 있습니다."
    )


if __name__ == "__main__":
    main()