"""Rewrite reverseASimilarity solution_steps into a complete formal write-up.

Approved mathematical basis (from
artifacts/专题/2026-07-14-反A形相似求第四边/02-student-explanation.resolved.tex):
- second equal angle is the vertical angle at P: angle APB = angle DPC;
- triangle PAB ~ triangle PDC by AA;
- correspondence A<->D, P<->P, B<->C, so PA<->PD, PB<->PC, AB<->DC.
"""

import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
from _apply import apply_steps  # noqa: E402
from _common import REVERSE_A_PAIRS, load_yaml  # noqa: E402
from _similarity import build_aa_solution  # noqa: E402

BANK = "artifacts/题库/2026-07-16-反A形相似"
ANGLE_GIVEN = r"\angle PAB=\angle PDC"
ANGLE_BASIS = (r"\angle APB=\angle DPC", "对顶角相等")
SIMILARITY = r"\triangle PAB\sim\triangle PDC"
TITLES = [
    "由两组等角判相似",
    "写出对应边与比例式",
    "代入全部已知数值",
    "变形求值并写出结论",
]


def build_block_steps(stem, answer):
    return build_aa_solution(
        stem, answer, ANGLE_GIVEN, ANGLE_BASIS, SIMILARITY, REVERSE_A_PAIRS, TITLES
    )


if __name__ == "__main__":
    dry = "--dry" in sys.argv
    apply = "--apply" in sys.argv
    root = os.environ.get("TEACHING_SKILLS_ROOT", "/Users/gaochong/develop/teaching_skills")
    bank = os.path.join(root, BANK)
    items_dir = os.path.join(bank, "items")
    qs = sorted(q for q in os.listdir(items_dir) if q.startswith("Q"))
    for q in qs:
        path = os.path.join(items_dir, q, "teacher.resolved.assignment.yaml")
        data = load_yaml(path)
        block = data["sections"][0]["blocks"][0]
        block_steps = build_block_steps(block["stem_latex"], block["answer"])
        show = dry or q in ("Q001", "Q026", "Q050")
        if show:
            print(f"=== {q} ===")
            print("STEM:", re.sub(r"\s+", " ", block["stem_latex"]).strip())
            print("ANSWER:", block["answer"])
            for s in block_steps:
                print("  -", s["content"])
            print()
        if apply:
            apply_steps(path, block_steps)
