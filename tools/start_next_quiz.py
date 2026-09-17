import json
import re
import subprocess
import sys
from pathlib import Path
from datetime import datetime


# =========================
# 경로
# =========================

ROOT = Path(__file__).resolve().parent.parent

STATUS_FILE = ROOT / "AI" / "STATUS.json"
REQUEST_FILE = ROOT / "AI" / "CURRENT_TASK.json"

SOURCE_DIR = ROOT / "재료" / "최종 원고_텍스트변환"

BUILD_STATUS_SCRIPT = ROOT / "tools" / "build_status.py"


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
# STATUS 자동 갱신
# =========================

def rebuild_status():

    print("1. 진행 상황 계산 중...")

    result = subprocess.run(
        [
            sys.executable,
            str(BUILD_STATUS_SCRIPT)
        ],
        cwd=ROOT
    )

    if result.returncode != 0:
        print("STATUS 갱신에 실패했습니다.")
        raise SystemExit(1)


# =========================
# STATUS 읽기
# =========================

def load_status():

    if not STATUS_FILE.exists():
        print("STATUS.json을 찾을 수 없습니다.")
        raise SystemExit(1)

    try:
        with open(
            STATUS_FILE,
            "r",
            encoding="utf-8"
        ) as f:
            return json.load(f)

    except json.JSONDecodeError:
        print("STATUS.json 형식이 올바르지 않습니다.")
        raise SystemExit(1)


# =========================
# 원고 Markdown 찾기
# =========================

def find_source_file(article):

    if not SOURCE_DIR.exists():
        print("원고 폴더를 찾을 수 없습니다.")
        print(SOURCE_DIR)
        raise SystemExit(1)

    middle = article.get("middleUnit", "")
    article_name = article.get("article", "")

    middle_key = normalize(middle)
    article_key = normalize(article_name)

    md_files = list(
        SOURCE_DIR.rglob("*.md")
    )

    # -------------------------
    # 1차: 중단원 + 아티클
    # -------------------------

    candidates = []

    for path in md_files:

        filename_key = normalize(
            path.stem
        )

        if (
            middle_key
            and article_key
            and middle_key in filename_key
            and article_key in filename_key
        ):
            candidates.append(path)

    if len(candidates) == 1:
        return candidates[0]

    if len(candidates) > 1:

        print()
        print("원고 후보가 여러 개 발견되었습니다.")

        for path in candidates:
            print(
                "-",
                path.relative_to(ROOT)
            )

        print()
        print("임의 선택하지 않습니다.")
        raise SystemExit(1)

    # -------------------------
    # 2차: 아티클명
    # -------------------------

    candidates = []

    for path in md_files:

        filename_key = normalize(
            path.stem
        )

        if (
            article_key
            and article_key in filename_key
        ):
            candidates.append(path)

    if len(candidates) == 1:
        return candidates[0]

    if len(candidates) > 1:

        print()
        print("아티클명과 일치하는 원고가 여러 개 발견되었습니다.")

        for path in candidates:
            print(
                "-",
                path.relative_to(ROOT)
            )

        print()
        print("임의 선택하지 않습니다.")
        raise SystemExit(1)

    print()
    print("원고 Markdown 파일을 찾지 못했습니다.")
    print(f"중단원 : {middle}")
    print(f"아티클 : {article_name}")

    raise SystemExit(1)


# =========================
# CURRENT_TASK 생성
# =========================

def create_task(article, source_file):

    task = {
        "task": "create_quiz",

        "subject":
            article.get("subject"),

        "middleUnit":
            article.get("middleUnit"),

        "article":
            article.get("article"),

        "sourceFile":
            str(
                source_file.relative_to(ROOT)
            ),

        "createdAt":
            datetime.now().isoformat(
                timespec="seconds"
            )
    }

    REQUEST_FILE.parent.mkdir(
        parents=True,
        exist_ok=True
    )

    with open(
        REQUEST_FILE,
        "w",
        encoding="utf-8"
    ) as f:

        json.dump(
            task,
            f,
            ensure_ascii=False,
            indent=2
        )

    return task


# =========================
# current 상태 등록
# =========================

def set_current(status, article):

    current_id = (
        f"{article.get('middleUnit', '')}"
        f" / "
        f"{article.get('article', '')}"
    )

    status["current"] = current_id

    status["updatedAt"] = (
        datetime.now().isoformat(
            timespec="seconds"
        )
    )

    with open(
        STATUS_FILE,
        "w",
        encoding="utf-8"
    ) as f:

        json.dump(
            status,
            f,
            ensure_ascii=False,
            indent=2
        )


# =========================
# 실행
# =========================

def main():

    print()
    print("===== STORY 퀴즈 작업 시작 =====")
    print()

    # 1. 최신 진행상황 계산
    rebuild_status()

    # 2. STATUS 읽기
    status = load_status()

    article = status.get(
        "nextArticle"
    )

    if not article:
        print()
        print("모든 STORY 퀴즈가 완료되었습니다.")
        return

    print()
    print("2. 다음 미완료 아티클 확인")

    print(
        f"   중단원 : "
        f"{article.get('middleUnit')}"
    )

    print(
        f"   아티클 : "
        f"{article.get('article')}"
    )

    # 3. 실제 Markdown 원고 찾기
    print()
    print("3. 원고 Markdown 탐색 중...")

    source_file = find_source_file(
        article
    )

    print(
        "   원고 :",
        source_file.relative_to(ROOT)
    )

    # 4. CURRENT_TASK.json 생성
    print()
    print("4. 작업지시 파일 생성 중...")

    task = create_task(
        article,
        source_file
    )

    # 5. current 등록
    set_current(
        status,
        article
    )

    print()
    print("===== 준비 완료 =====")
    print()

    print(
        json.dumps(
            task,
            ensure_ascii=False,
            indent=2
        )
    )

    print()
    print(
        "작업지시 파일:",
        REQUEST_FILE.relative_to(ROOT)
    )


# =========================
# 시작
# =========================

if __name__ == "__main__":
    main()