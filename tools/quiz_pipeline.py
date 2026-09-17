# -*- coding: utf-8 -*-
"""퀴즈 1건을 JSON에서 Google 시트까지 한 번에 처리한다.

    py tools/quiz_pipeline.py <아티클ID> --note "<기록에 남길 서술>"  ← 검증 → CSV → 대단원 반영 → 대조 → 대시보드 → 시트
    py tools/quiz_pipeline.py <아티클ID> --no-send    ← 시트 전송만 빼고 전부
    py tools/quiz_pipeline.py <아티클ID> --only-send  ← 시트 전송만

왜 필요한가 (2026-09-17 · 사용자 지시 "python에게 너가 하던 작업을 최대한 넘기면"):
  Claude가 툴을 한 번 호출할 때마다 **대화 전체가 다시 실려 나간다.** 이 세션 실측으로
  호출 1회 ≈ 374,000토큰이었다. 종전에는 아티클 1건을 마치는 데 Claude가 Bash를 7~9번 불렀고
  (검증 · CSV 생성 · 기준 md5 · 대단원 반영 · 전 칸 대조 · 대시보드 · 페이로드 · 전송),
  그 대부분이 "스크립트를 순서대로 돌린다"는 기계적인 일이었다.
  이 파일은 그 전부를 **한 번의 호출**로 묶는다 → 호출 6~8회가 1회가 되어 건당 약 2M토큰이 빠진다.

같이 옮겨 온 것 — Claude가 매번 손으로 짜던 **검증 코드**:
  · 반영 전 '바뀌면 안 되는 행'의 md5를 찍어 두고 반영 후 대조 (지금까지 인라인 python이었다)
  · 검수용 CSV ↔ 대단원 CSV **전 칸 비교** (17열 × 7행)
  · BOM · 단독 LF 0 · 총 행 수 유지
  ⚠️ 이 대조는 `update_master_csv.py`의 자기 보고와 **별개로** 돌려야 한다 —
     2026-09-17에 `대단원누적자`가 "불일치 0건"이라 보고한 자리에서 실제로 1칸이 달랐다
     (`강해진 자기장이` → `강한 자기장이`). 자기 검증은 자기 오류를 못 잡는다.

시트 전송 규칙:
  · **한 번만 실행하고 결과를 파싱해 성공 건수를 센다** (파이프를 나눠 두 번 보내지 않는다).
  · `대상 행을 찾을 수 없습니다`가 나오면 **시트 표기를 추측해 고치지 말고** 사용자에게 물어
    `tools/build_quiz_update.js`의 `SHEET_KEY`에 적는다 (CLAUDE.md 규칙 3번).
"""
import csv
import hashlib
import io
import json
import re
import subprocess
import sys
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

ROOT = Path(__file__).resolve().parent.parent
TOOL = ROOT / "산출물" / "도구"
QZ_JSON = ROOT / "산출물" / "퀴즈데이터"
QZ_CSV = ROOT / "산출물" / "퀴즈CSV"

OK = "  OK  "
NG = " 실패 "


def run(cmd, title):
    r = subprocess.run(cmd, cwd=str(ROOT), capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    out = (r.stdout or "") + (r.stderr or "")
    if r.returncode != 0:
        print("[%s] %s" % (NG, title))
        print(out.strip()[-1500:])
        sys.exit(1)
    return out


def read_bytes(p):
    return p.read_bytes()


def rows_of(p):
    with io.open(p, encoding="utf-8-sig", newline="") as f:
        return list(csv.reader(f))


def find_block(master_rows, sub, mid, art):
    """검수용 CSV 첫 행의 메타 3열로 대단원 CSV에서 7행 블록의 시작 인덱스를 찾는다."""
    for i, r in enumerate(master_rows):
        if len(r) >= 3 and r[0] == sub and r[1] == mid and r[2] == art:
            return i
    return None


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    flags = set(a for a in sys.argv[1:] if a.startswith("--"))
    if not args:
        print(__doc__)
        sys.exit(1)
    aid = args[0]
    only_send = "--only-send" in flags
    no_send = "--no-send" in flags

    jpath = QZ_JSON / (aid + ".json")
    if not jpath.exists():
        print("[%s] 퀴즈데이터 JSON이 없다: %s" % (NG, jpath))
        sys.exit(1)
    meta = json.loads(jpath.read_text(encoding="utf-8-sig")).get("meta", {})
    master = ROOT / meta["csv"]

    print("=" * 62)
    print(" 퀴즈 파이프라인 — %s" % aid)
    print(" %s · %s · %s · %s" % (meta.get("분과"), meta.get("중단원"),
                                  meta.get("아티클"), meta.get("행")))
    print("=" * 62)

    if not only_send:
        # 1. JSON 구조 검증
        out = run(["node", str(TOOL / "퀴즈JSON검증.js"), str(jpath)], "JSON 검증")
        warn = re.search(r"\[경고 (\d+)건", out)
        print("[%s] 1. JSON 검증 — 전항목 통과%s" % (
            OK, ("  (경고 %s건)" % warn.group(1)) if warn else ""))
        if warn:
            for line in out.splitlines():
                if "규칙" in line and line.startswith("  "):
                    print("        " + line.strip())

        # 2. 검수용 CSV 생성
        run(["node", str(TOOL / "퀴즈CSV생성.js"), str(jpath)], "검수용 CSV 생성")
        print("[%s] 2. 검수용 CSV 생성 — 7행 · 17열 · UTF-8 BOM · CRLF" % OK)

        # 3. 반영 전 스냅샷 (바뀌면 안 되는 행의 md5)
        sub_rows = rows_of(QZ_CSV / (aid + ".csv"))[1:]
        before = read_bytes(master)
        m_rows_before = rows_of(master)
        start = find_block(m_rows_before, sub_rows[0][0], sub_rows[0][1], sub_rows[0][2])
        if start is None:
            print("[%s] 대단원 CSV에서 블록을 찾지 못했다 — 메타 3열 불일치" % NG)
            sys.exit(1)
        chunks = before.split(b"\r\n")
        keep_head = hashlib.md5(b"\r\n".join(chunks[:start])).hexdigest()
        keep_tail = hashlib.md5(b"\r\n".join(chunks[start + 7:])).hexdigest()
        n_before = len(chunks)

        # 4. 대단원 CSV 반영
        run([sys.executable, str(ROOT / "tools" / "update_master_csv.py"), aid], "대단원 반영")
        print("[%s] 3. 대단원 CSV 반영 — %s %d~%d행" % (
            OK, master.name, start + 1, start + 7))

        # 5. 전 칸 대조 (update_master_csv 의 자기 보고와 별개로 돌린다)
        after = read_bytes(master)
        chunks2 = after.split(b"\r\n")
        m_rows = rows_of(master)
        bad = []
        for i, row in enumerate(sub_rows):
            t = m_rows[start + i]
            for c in range(17):
                if c < 3 and i > 0:
                    continue
                a = row[c] if c < len(row) else ""
                b = t[c] if c < len(t) else ""
                if a != b:
                    bad.append("행%d 열%d: %r → %r" % (start + 1 + i, c + 1, a[:34], b[:34]))
        checks = [
            ("UTF-8 BOM 유지", after[:3] == b"\xef\xbb\xbf"),
            ("단독 LF 0개", after.replace(b"\r\n", b"").count(b"\n") == 0),
            ("총 행 수 유지 (%d)" % n_before, len(chunks2) == n_before),
            ("블록 앞 행 변경 없음", hashlib.md5(b"\r\n".join(chunks2[:start])).hexdigest() == keep_head),
            ("블록 뒤 행 변경 없음", hashlib.md5(b"\r\n".join(chunks2[start + 7:])).hexdigest() == keep_tail),
            ("전 칸 일치 (7행 × 17열)", not bad),
        ]
        print("[%s] 4. 반영 검증" % (OK if all(v for _, v in checks) else NG))
        for name, v in checks:
            print("        %s %s" % ("✓" if v else "✗", name))
        for x in bad[:8]:
            print("        ! " + x)
        if bad or not all(v for _, v in checks):
            print("\n  → 반영이 어긋났다. 백업은 산출물/_백업_대단원별/ 에 있다.")
            sys.exit(1)

        # 6. 대시보드
        out = run(["node", str(TOOL / "build-dashboard.js")], "대시보드")
        for line in out.splitlines():
            if "만든 문항" in line:
                print("[%s] 5. 대시보드 —%s" % (OK, line.split("·", 1)[0].split("896")[-1] or line))
                print("        " + line.strip())
                break

    if no_send:
        print("\n  시트 전송은 건너뛰었다 (--no-send).")
        return

    # 7. 시트 전송 — 한 번만 실행하고 결과를 파싱한다
    run(["node", str(ROOT / "tools" / "build_quiz_update.js"), aid], "시트 페이로드 생성")
    out = run([sys.executable, str(ROOT / "tools" / "update_google_sheet.py"),
               str(ROOT / "quiz_update.json")], "시트 전송")
    m = re.search(r"\{.*\}", out, re.S)
    if not m:
        print("[%s] 6. 시트 전송 — 응답을 파싱하지 못했다" % NG)
        print(out.strip()[-800:])
        sys.exit(1)
    res = json.loads(m.group(0))
    ok = res.get("successCount", 0)
    fail = res.get("failureCount", 0)
    print("[%s] 6. 시트 전송 — %d/%d 성공" % (OK if fail == 0 else NG, ok, ok + fail))
    if fail:
        for r in res.get("results", []):
            if not r.get("success"):
                print("        ! " + str(r.get("message", ""))[:130])
                break
        print("        → `대상 행을 찾을 수 없습니다`면 시트 표기를 추측하지 말고 사용자에게 물어")
        print("          tools/build_quiz_update.js 의 SHEET_KEY 에 적는다 (CLAUDE.md 규칙 3번).")
        sys.exit(1)

    # 8. 기록 3종 갱신 (HISTORY · 진행상황 · STATUS)
    note = None
    argv = sys.argv[1:]
    for i, a in enumerate(argv):
        if a == "--note" and i + 1 < len(argv):
            note = argv[i + 1]
    if note is not None:
        print()
        print(run([sys.executable, str(ROOT / "tools" / "record_progress.py"), aid,
                   "--note", note, "--sheet", "%d/%d" % (ok, ok + fail)],
                  "기록 갱신").rstrip())
    else:
        print()
        print("  기록은 갱신하지 않았다 — --note 를 주면 HISTORY·진행상황·STATUS 를 함께 갱신한다.")

    print("\n  완료 — %s" % aid)


if __name__ == "__main__":
    main()
