import json
import re
from pathlib import Path


# =========================
# 경로
# =========================

ROOT = Path(__file__).resolve().parent.parent

STATUS_FILE = ROOT / "AI" / "STATUS.json"

# 실제 원고 Markdown 파일이 있는 폴더
SOURCE_DIR = ROOT / "재료" / "최종 원고_텍스트변환"


# =========================
# 비교용 문자열 정리
# =========================

def normalize(text):
    """
    파일명 비교를 위해 문자열을 단순화한다.

    예:
    "3-1) 원자의 내부" -> "31원자의내부"
    "A. 원자" -> "a원자"

    공백, 점, 괄호, 하이픈, 언더바 등은 무시한다.
    """

    text = str(text or "").lower().strip()

    return re.sub(
        r"[^0-9a-z가-힣]",
        "",
        text
    )


# =========================
# STATUS 읽기
# =========================

def load_status():

    if not STATUS_FILE.exists():
        print("STATUS.json이 없습니다.")
        print()
        print("먼저 다음 명령을 실행하세요:")
        print("py tools/build_status.py")
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
# Markdown 원고 찾기
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

    # 모든 Markdown 원고 파일
    md_files = list(
        SOURCE_DIR.rglob("*.md")
    )

    # ---------------------------------
    # 1차 검색
    # 중단원 + 아티클 모두 일치
    # ---------------------------------

    candidates = []

    for path in md_files:

        filename_key = normalize(path.stem)

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
        print("Claude가 임의로 선택하지 않습니다.")
        print()

        for path in candidates:
            print(
                "-",
                path.relative_to(ROOT)
            )

        raise SystemExit(1)

    # ---------------------------------
    # 2차 검색
    # 아티클명만 일치
    # ---------------------------------

    candidates = []

    for path in md_files:

        filename_key = normalize(path.stem)

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
        print("Claude가 임의로 선택하지 않습니다.")
        print()

        for path in candidates:
            print(
                "-",
                path.relative_to(ROOT)
            )

        raise SystemExit(1)

    # ---------------------------------
    # 실패
    # ---------------------------------

    print()
    print("원고 Markdown 파일을 찾지 못했습니다.")
    print()
    print(f"중단원 : {middle}")
    print(f"아티클 : {article_name}")
    print()
    print(f"검색 폴더 : {SOURCE_DIR}")

    raise SystemExit(1)


# =========================
# 실행
# =========================

def main():

    status = load_status()

    article = status.get(
        "nextArticle"
    )

    # 남은 작업 없음
    if not article:

        print()
        print("남은 아티클이 없습니다.")
        return

    # 실제 Markdown 원고 탐색
    source_file = find_source_file(
        article
    )

    # Claude에게 넘길 최소 정보
    result = {

        "subject":
            article.get("subject"),

        "middleUnit":
            article.get("middleUnit"),

        "article":
            article.get("article"),

        "sourceFile":
            str(
                source_file.relative_to(ROOT)
            )
    }

    print()
    print("===== 다음 STORY 퀴즈 작업 =====")
    print()

    print(
        json.dumps(
            result,
            ensure_ascii=False,
            indent=2
        )
    )


# =========================
# 시작
# =========================

if __name__ == "__main__":
    main()