import json
import sys
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
STATUS_FILE = ROOT / "AI" / "STATUS.json"


def load_status():
    if not STATUS_FILE.exists():
        return {
            "current": None,
            "lastCompleted": None,
            "updatedAt": None
        }

    with open(STATUS_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def save_status(status):
    STATUS_FILE.parent.mkdir(parents=True, exist_ok=True)

    with open(STATUS_FILE, "w", encoding="utf-8") as f:
        json.dump(
            status,
            f,
            ensure_ascii=False,
            indent=2
        )


def main():
    if len(sys.argv) < 3:
        print("사용법:")
        print("  py tools/update_status.py current 7-3_B")
        print("  py tools/update_status.py complete 7-3_B")
        sys.exit(1)

    command = sys.argv[1]
    article = sys.argv[2]

    status = load_status()

    if command == "current":
        status["current"] = article

    elif command == "complete":
        status["lastCompleted"] = article

        if status.get("current") == article:
            status["current"] = None

    else:
        print(f"알 수 없는 명령: {command}")
        sys.exit(1)

    status["updatedAt"] = datetime.now().isoformat(timespec="seconds")

    save_status(status)

    print(json.dumps(
        status,
        ensure_ascii=False,
        indent=2
    ))


if __name__ == "__main__":
    main()