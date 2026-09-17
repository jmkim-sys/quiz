import csv
import re
import shutil
import sys
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent

MASTER_DIR = ROOT / "산출물" / "대단원별"
QUIZ_DIR = ROOT / "산출물" / "퀴즈CSV"
BACKUP_DIR = ROOT / "산출물" / "_백업_대단원별"

EXCLUDED_FILES = {
    "퀴즈샘플_260831.csv"
}


# =========================
# 문자열 비교용 정리
# =========================

def normalize(text):
    text = str(text or "").strip().lower()

    return re.sub(
        r"[^0-9a-z가-힣]",
        "",
        text
    )


# =========================
# CSV 읽기
# =========================

def read_csv(path):

    with open(
        path,
        "r",
        encoding="utf-8-sig",
        newline=""
    ) as f:

        return list(
            csv.reader(f)
        )


# =========================
# CSV 저장
# =========================

def write_csv(path, rows):

    with open(
        path,
        "w",
        encoding="utf-8-sig",
        newline=""
    ) as f:

        writer = csv.writer(f)

        writer.writerows(rows)


# =========================
# 중단
# =========================

def die(message):

    print()
    print("❌", message)

    raise SystemExit(1)


# =========================
# 검수 CSV 정보 읽기
# =========================

def load_quiz_csv(article_id):

    path = (
        QUIZ_DIR
        / f"{article_id}.csv"
    )

    if not path.exists():
        die(
            "검수 CSV를 찾을 수 없습니다: "
            + str(path)
        )

    rows = read_csv(path)

    if len(rows) != 8:
        die(
            f"{article_id}: "
            f"헤더 포함 8행이어야 하는데 "
            f"{len(rows)}행입니다."
        )

    header = rows[0]
    data = rows[1:]

    if len(header) != 17:
        die(
            f"{article_id}: "
            "CSV가 17열이 아닙니다."
        )

    for i, row in enumerate(
        data,
        start=1
    ):

        if len(row) != 17:

            die(
                f"{article_id}: "
                f"{i}번 문항이 "
                f"17열이 아닙니다."
            )

    # 첫 행의 메타 정보
    subject = data[0][0].strip()
    middle = data[0][1].strip()
    article = data[0][2].strip()

    if not middle:
        die(
            f"{article_id}: "
            "중단원 정보가 없습니다."
        )

    if not article:
        die(
            f"{article_id}: "
            "아티클 정보가 없습니다."
        )

    return {
        "path": path,
        "rows": data,
        "subject": subject,
        "middle": middle,
        "article": article
    }


# =========================
# 누적 CSV에서 대상 7행 찾기
# =========================

def find_target(article_info):

    wanted_middle = normalize(
        article_info["middle"]
    )

    wanted_article = normalize(
        article_info["article"]
    )

    matches = []

    for path in sorted(
        MASTER_DIR.glob("*.csv")
    ):

        if path.name in EXCLUDED_FILES:
            continue

        rows = read_csv(path)

        if len(rows) < 2:
            continue

        current_middle = ""
        current_article = ""

        # 0행은 헤더
        for index in range(
            1,
            len(rows)
        ):

            row = rows[index]

            if len(row) < 17:
                continue

            # 누적 CSV는 첫 행에만
            # B/C가 있고 아래 행은 빈칸일 수 있음
            if row[1].strip():
                current_middle = (
                    row[1].strip()
                )

            if row[2].strip():
                current_article = (
                    row[2].strip()
                )

            if (
                normalize(current_middle)
                == wanted_middle
                and
                normalize(current_article)
                == wanted_article
            ):

                matches.append(
                    {
                        "path": path,
                        "rowIndex": index,
                        "questionNo":
                            row[3].strip()
                    }
                )

    if not matches:

        die(
            "대단원 누적 CSV에서 "
            "대상 아티클을 찾지 못했습니다.\n"
            f"중단원: {article_info['middle']}\n"
            f"아티클: {article_info['article']}"
        )

    # 한 파일에 있어야 함
    files = {
        item["path"]
        for item in matches
    }

    if len(files) != 1:

        print()
        print(
            "대상 아티클이 여러 "
            "대단원 CSV에서 발견되었습니다."
        )

        for path in files:
            print(
                "-",
                path.relative_to(ROOT)
            )

        die(
            "임의로 선택하지 않습니다."
        )

    target_file = next(
        iter(files)
    )

    target_rows = [
        item
        for item in matches
        if item["path"] == target_file
    ]

    # 정확히 7문항이어야 함
    if len(target_rows) != 7:

        die(
            f"대상 아티클의 행이 "
            f"7개가 아닙니다: "
            f"{len(target_rows)}개"
        )

    # 문항 번호 검증
    question_numbers = [
        item["questionNo"]
        for item in target_rows
    ]

    expected = [
        "1", "2", "3", "4",
        "5", "6", "7"
    ]

    if question_numbers != expected:

        die(
            "누적 CSV의 문항 번호가 "
            "1~7 순서가 아닙니다.\n"
            f"실제: {question_numbers}"
        )

    return (
        target_file,
        target_rows
    )


# =========================
# 백업
# =========================

def backup_file(path):

    BACKUP_DIR.mkdir(
        parents=True,
        exist_ok=True
    )

    timestamp = datetime.now().strftime(
        "%Y%m%d_%H%M%S"
    )

    backup_path = (
        BACKUP_DIR
        / (
            f"{path.stem}_"
            f"{timestamp}"
            f"{path.suffix}"
        )
    )

    shutil.copy2(
        path,
        backup_path
    )

    return backup_path


# =========================
# 실제 G~Q 업데이트
# =========================

def update_master(article_id):

    print()
    print(
        "================================"
    )
    print(
        " 대단원 누적 CSV 업데이트"
    )
    print(
        "================================"
    )

    # 검수 CSV
    quiz = load_quiz_csv(
        article_id
    )

    print()
    print(
        "중단원:",
        quiz["middle"]
    )

    print(
        "아티클:",
        quiz["article"]
    )

    # 대상 누적 CSV 탐색
    target_file, targets = (
        find_target(quiz)
    )

    print()
    print(
        "대상 파일:",
        target_file.relative_to(ROOT)
    )

    # 원본 읽기
    master_rows = read_csv(
        target_file
    )

    # 백업
    backup = backup_file(
        target_file
    )

    print(
        "백업:",
        backup.relative_to(ROOT)
    )

    # -------------------------
    # G~Q만 업데이트
    # -------------------------

    for i in range(7):

        source_row = (
            quiz["rows"][i]
        )

        target_index = (
            targets[i]["rowIndex"]
        )

        target_row = (
            master_rows[target_index]
        )

        # G~Q = index 6~16
        target_row[6:17] = (
            source_row[6:17]
        )

    # 저장
    write_csv(
        target_file,
        master_rows
    )

    print()
    print(
        "✅ G~Q 11개 열 × 7문항 반영 완료"
    )

    print(
        "✅ A~F 기존 값 유지"
    )

    print(
        "✅ 행 추가 없음"
    )

    print()

    return target_file


# =========================
# 실행
# =========================

def main():

    if len(sys.argv) < 2:

        print()
        print("사용법:")
        print(
            "py tools/update_master_csv.py "
            "<아티클ID>"
        )

        print()
        print("예:")
        print(
            "py tools/update_master_csv.py "
            "03_물질_C_전이금속"
        )

        raise SystemExit(1)

    article_id = sys.argv[1]

    update_master(
        article_id
    )


if __name__ == "__main__":
    main()