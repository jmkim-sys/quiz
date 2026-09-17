import csv
import json
import re
from pathlib import Path
from datetime import datetime


ROOT = Path(__file__).resolve().parent.parent

UNIT_DIR = ROOT / "산출물" / "대단원별"
QUIZ_DIR = ROOT / "산출물" / "퀴즈CSV"
STATUS_FILE = ROOT / "AI" / "STATUS.json"

EXCLUDED_FILES = {
    "퀴즈샘플_260831.csv"
}


def read_csv(path):
    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def normalize(text):
    """
    비교용 문자열.
    공백/특수문자 차이 때문에 매칭이 실패하는 것을 줄인다.
    """
    text = str(text or "").strip().lower()
    return re.sub(r"[^0-9a-z가-힣]", "", text)


def get_all_articles():
    articles = []

    for path in sorted(UNIT_DIR.glob("*.csv")):

        if path.name in EXCLUDED_FILES:
            continue

        rows = read_csv(path)

        for row in rows:
            article = (row.get("아티클") or "").strip()

            if not article:
                continue

            middle = (row.get("중단원") or "").strip()
            subject = (row.get("분과") or "").strip()

            articles.append({
                "sourceFile": path.name,
                "subject": subject,
                "middleUnit": middle,
                "article": article,
                "matchKey": normalize(middle + article)
            })

    return articles


def get_created_quizzes():
    created = []

    if not QUIZ_DIR.exists():
        return created

    for path in sorted(QUIZ_DIR.glob("*.csv")):

        rows = read_csv(path)

        if not rows:
            continue

        # CSV 첫 행에 중단원/아티클 정보가 있음
        first = rows[0]

        middle = (first.get("중단원") or "").strip()
        article = (first.get("아티클") or "").strip()

        created.append({
            "file": path.name,
            "middleUnit": middle,
            "article": article,
            "matchKey": normalize(middle + article)
        })

    return created


def load_old_status():
    if not STATUS_FILE.exists():
        return {}

    try:
        with open(STATUS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return {}


def main():
    all_articles = get_all_articles()
    created_quizzes = get_created_quizzes()
    old_status = load_old_status()

    created_keys = {
        quiz["matchKey"]
        for quiz in created_quizzes
        if quiz["matchKey"]
    }

    completed = []
    pending = []

    for article in all_articles:

        if article["matchKey"] in created_keys:
            completed.append(article)
        else:
            pending.append(article)

    # 혹시 퀴즈CSV에는 있는데
    # 128개 스켈레톤과 매칭되지 않는 파일 확인
    all_keys = {
        article["matchKey"]
        for article in all_articles
    }

    unmatched_created = [
        quiz
        for quiz in created_quizzes
        if quiz["matchKey"] not in all_keys
    ]

    next_article = pending[0] if pending else None

    status = {
        "current": old_status.get("current"),
        "lastCompleted": old_status.get("lastCompleted"),

        "totalCount": len(all_articles),
        "completedCount": len(completed),
        "remainingCount": len(pending),

        "nextArticle": next_article,

        "completedArticles": completed,
        "pendingArticles": pending,

        "unmatchedQuizFiles": unmatched_created,

        "updatedAt": datetime.now().isoformat(
            timespec="seconds"
        )
    }

    STATUS_FILE.parent.mkdir(
        parents=True,
        exist_ok=True
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

    print()
    print("===== STORY 퀴즈 진행 현황 =====")
    print(f"전체       : {len(all_articles)}")
    print(f"완료       : {len(completed)}")
    print(f"미완료     : {len(pending)}")
    print(f"매칭 실패  : {len(unmatched_created)}")

    print()

    if next_article:
        print("===== 다음 작업 =====")
        print(f"분과   : {next_article['subject']}")
        print(f"중단원 : {next_article['middleUnit']}")
        print(f"아티클 : {next_article['article']}")
    else:
        print("모든 아티클이 완료되었습니다.")

    if unmatched_created:
        print()
        print("===== 매칭 실패 퀴즈CSV =====")

        for quiz in unmatched_created:
            print(f"- {quiz['file']}")

    print()
    print(f"STATUS 저장: {STATUS_FILE}")


if __name__ == "__main__":
    main()