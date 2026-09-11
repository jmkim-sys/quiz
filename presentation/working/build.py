# -*- coding: utf-8 -*-
"""content.py를 읽어 HTML 정본을 빌드하고 PDF·PNG·PPTX로 변환한다.
   실행: python build.py"""

import os
import sys

sys.dont_write_bytecode = True

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from content import content, SKILL, PROJ  # noqa: E402

sys.path.insert(0, os.path.join(SKILL, "scripts"))
from deck_builder import build_deck, audit, format_audit, convert  # noqa: E402

FINAL = os.path.join(PROJ, "presentation", "final")
RENDER = os.path.join(HERE, "render")
OUT = os.path.join(FINAL, "그래디언트_멘토링_김민정_퀴즈자동생성검수_final.html")

html = build_deck(content, OUT, skill_dir=SKILL)
print(format_audit(audit(html, forbidden=[])))

print("\n--- 변환 ---")
out = convert(html, FINAL, render_dir=RENDER)
for k, v in out.items():
    if isinstance(v, list):
        print(f"{k}: {len(v)}개")
    else:
        print(f"{k}: {v}")
