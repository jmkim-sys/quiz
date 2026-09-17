# -*- coding: utf-8 -*-
"""아티클 1건을 마친 뒤 기록 3종을 한 번에 갱신한다.

    py tools/record_progress.py <아티클ID> --note "<사람이 쓴 서술>" [--sheet 7/7]

갱신 대상
  · 기록/HISTORY.md      — 항목 한 개를 덧붙인다. **수치는 전부 자동으로 채운다**
                            (정답 요약 · 반영 행 · 대시보드 KPI · 시트 결과).
                            `--note` 로 준 서술만 사람이 쓴 부분이다.
  · 기록/진행상황.md      — 큐 표에서 그 아티클 행을 찾아 `⬜ 대기` → `✅ 완료` 로 바꾼다.
  · AI/STATUS.json        — update_status.py complete <코드> 뒤 build_status.py 로 재집계.

왜 필요한가 (2026-09-17 · 사용자 지시 "python에게 너가 하던 작업을 최대한 넘기면"):
  Claude가 툴을 한 번 부를 때마다 대화 전체가 다시 실린다(이 세션 실측 ≈ 374,000토큰/회).
  기록 갱신은 그 자체로 호출 한 번이었고, 그중 정답 요약·행 번호·KPI 같은 수치는 전부
  파일에서 읽어 채울 수 있는 것이었다. **판단이 들어가는 서술만 `--note` 로 받는다.**

⚠️ 사람이 써야 하는 것 — 무엇을 왜 고쳤는지, 어떤 함정을 피했는지, 사람이 확인할 지점.
   그건 파일에서 읽어낼 수 없다. `--note` 를 비우면 그 자리에 `[확인 필요]` 가 들어간다.
"""
import io
import json
import re
import subprocess
import sys
from pathlib import Path
from datetime import datetime

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

ROOT = Path(__file__).resolve().parent.parent
QZ_JSON = ROOT / "산출물" / "퀴즈데이터"
HISTORY = ROOT / "기록" / "HISTORY.md"
PROGRESS = ROOT / "기록" / "진행상황.md"
DASH = ROOT / "산출물" / "퀴즈제작현황_대시보드_v2.html"

LABEL = ["가", "나", "다", "라"]


def answer_summary(slots):
    """CSV 생성기가 찍는 것과 같은 형식의 정답 한 줄."""
    out = []
    for s in slots:
        n = s["no"]
        if "blanks" in s:
            out.append("%d=%s" % (n, "/".join(str(b["ans"]) for b in s["blanks"])))
        elif "ox" in s:
            out.append("%d=%s" % (n, s["ox"]["opts"][s["ox"]["ans"] - 1]))
        elif "single" in s:
            out.append("%d=%d" % (n, s["single"]["ans"]))
        elif "multi" in s:
            out.append("%d=%s" % (n, "/".join(str(x) for x in s["multi"]["ans"])))
        elif "order" in s:
            out.append("%d=%s" % (n, "-".join(LABEL[i - 1] for i in s["order"]["ans"])))
        elif "text" in s:
            out.append("%d=%s" % (n, s["text"]["ans"]))
    return " · ".join(out)


def status_code(meta):
    """update_status.py 가 쓰는 `3-1_A` 꼴 코드. 문자 접두가 없으면 중단원 코드만."""
    m = re.match(r"^([^)]+)\)", str(meta.get("중단원", "")))
    code = m.group(1).strip() if m else "?"
    a = re.match(r"^([A-Z])\.\s", str(meta.get("아티클", "")))
    return code + ("_" + a.group(1) if a else "")


def dashboard_kpi():
    """대시보드 HTML에서 집계 줄을 읽지 않고, build-dashboard 를 다시 돌려 콘솔에서 받는다."""
    r = subprocess.run(["node", str(ROOT / "산출물" / "도구" / "build-dashboard.js")],
                       cwd=str(ROOT), capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    for line in (r.stdout or "").splitlines():
        if "만든 문항" in line:
            return line.strip()
    return "[확인 필요] 대시보드 집계를 읽지 못했다"


def mark_progress(article_name, row_note):
    """진행상황.md 큐 표에서 그 아티클 행을 완료로 바꾼다."""
    if not PROGRESS.exists():
        return "진행상황.md 없음"
    s = PROGRESS.read_text(encoding="utf-8")
    hits = [ln for ln in s.splitlines()
            if ln.startswith("|") and ("| " + article_name + " |") in ln and "⬜ 대기" in ln]
    if not hits:
        return "큐에서 `%s` 행을 못 찾았다 — 손으로 확인" % article_name
    old = hits[0]
    new = old.replace("⬜ 대기", "✅ 완료", 1).rstrip()
    if not new.endswith("|"):
        new += " |"
    new = new[:-1].rstrip() + " — " + row_note + " |"
    PROGRESS.write_text(s.replace(old, new, 1), encoding="utf-8", newline="")
    return "완료로 표시"


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        print(__doc__)
        sys.exit(1)
    aid = args[0]
    note = "[확인 필요] 서술 없음"
    sheet = None
    argv = sys.argv[1:]
    for i, a in enumerate(argv):
        if a == "--note" and i + 1 < len(argv):
            note = argv[i + 1]
        if a == "--sheet" and i + 1 < len(argv):
            sheet = argv[i + 1]

    d = json.loads((QZ_JSON / (aid + ".json")).read_text(encoding="utf-8-sig"))
    meta, slots = d["meta"], d["slots"]
    today = datetime.now().strftime("%Y-%m-%d")

    kpi = dashboard_kpi()
    entry = [
        "",
        "- **%s · `%s / %s` 완료.**" % (today, meta.get("중단원"), meta.get("아티클")),
        "  %s" % note,
        "  - 반영: `%s` **%s** · 분과 %s" % (Path(meta["csv"]).name, meta.get("행"), meta.get("분과")),
        "  - 정답: `%s`." % answer_summary(slots),
    ]
    if sheet:
        entry.append("  - Google 시트 전송 **%s**." % sheet)
    if meta.get("기획자확인"):
        entry.append("  - ⚠️ 사람이 볼 것: %s" % meta["기획자확인"])
    entry.append("  - 대시보드: %s" % kpi)
    with io.open(HISTORY, "a", encoding="utf-8", newline="") as f:
        f.write("\n".join(entry) + "\n")

    pr = mark_progress(str(meta.get("아티클")),
                       "%s 생성·검토·반영%s 완료" % (today, ("·시트 " + sheet) if sheet else ""))

    code = status_code(meta)
    subprocess.run([sys.executable, str(ROOT / "tools" / "update_status.py"), "complete", code],
                   cwd=str(ROOT), capture_output=True, text=True, encoding="utf-8", errors="replace")
    subprocess.run([sys.executable, str(ROOT / "tools" / "build_status.py")],
                   cwd=str(ROOT), capture_output=True, text=True, encoding="utf-8", errors="replace")

    print("[  OK  ] 기록 갱신")
    print("        ✓ HISTORY.md — 항목 추가 (정답 요약·행·KPI 자동)")
    print("        · 진행상황.md — %s" % pr)
    print("        ✓ STATUS.json — lastCompleted = %s · 재집계 완료" % code)
    print("        %s" % kpi)


if __name__ == "__main__":
    main()
