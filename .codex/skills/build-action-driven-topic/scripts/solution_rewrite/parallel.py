"""Rewrite parallelLineRatios solution_steps into a complete formal write-up.

Approved mathematical basis (from
artifacts/专题/2026-07-12-平行线对应边比例-待审核/02-student-explanation.resolved.tex):
- by AB // CD, corresponding angles are equal, and P is the common vertex, so
  triangle PAB ~ triangle PCD (AA via the parallel);
- correspondence P<->P, A<->C, B<->D, so PA<->PC, PB<->PD, AB<->CD.

Stems use both AP/PA and BP/PB; values are matched in either orientation.
"""

import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
from _apply import apply_steps  # noqa: E402
from _common import load_yaml  # noqa: E402

BANK = "artifacts/题库/2026-07-17-三边求第四边-A字型8字型"
PARALLEL = r"AB\parallel CD"
SIMILARITY = r"\triangle PAB\sim\triangle PCD"
PAIRS = [("PA", "PC"), ("PB", "PD"), ("AB", "CD")]
TITLES = [
    "由平行得相似",
    "写出对应边与比例式",
    "代入全部已知数值",
    "变形求值并写出结论",
]


def seg_value(stem, seg):
    """Match $seg=value$ allowing either segment orientation (PA or AP)."""
    for s in (seg, seg[::-1]):
        m = re.search(r"\$" + s + r"\s*=\s*([^$]+)\$", stem)
        if m:
            return m.group(1).strip()
    return None


def canon(seg):
    return {"AP": "PA", "BP": "PB"}.get(seg, seg)


def clean_value(raw):
    v = raw.strip()
    v = re.split(r"[。.；;，,]", v)[0]
    v = v.strip("$")
    return v.strip()


def frac(num, den):
    return r"\dfrac{%s}{%s}" % (num, den)


def build_block_steps(stem, answer):
    mu = re.search(r"(PA|PB|PC|PD|AB|CD|AP|BP)\s*=", answer)
    unknown = canon(mu.group(1))
    upair = next(p for p in PAIRS if unknown in p)
    mate = upair[1] if upair[0] == unknown else upair[0]
    mate_val = seg_value(stem, mate)
    known_pair = next(
        p for p in PAIRS if p != upair and seg_value(stem, p[0]) and seg_value(stem, p[1])
    )
    k1, k2 = known_pair
    k1_val, k2_val = seg_value(stem, k1), seg_value(stem, k2)
    final_val = clean_value(re.search(r"=\s*(.+)", answer).group(1))

    unknown_small = upair.index(unknown) == 0
    left_top = unknown if unknown_small else mate
    left_bot = mate if unknown_small else unknown
    proportion = f"{frac(left_top, left_bot)}={frac(k1, k2)}"

    val_of = {mate: mate_val, k1: k1_val, k2: k2_val, unknown: unknown}
    substituted = f"{frac(val_of[left_top], val_of[left_bot])}={frac(k1_val, k2_val)}"

    if left_bot == unknown:
        deform_sub = f"{unknown}={frac(mate_val + r'\times' + k2_val, k1_val)}"
    else:
        deform_sub = f"{unknown}={frac(mate_val + r'\times' + k1_val, k2_val)}"

    steps = [
        f"由 ${PARALLEL}$，得同位角相等且 ${'\\angle APB=\\angle CPD'}$（公共角），"
        f"∴ ${SIMILARITY}$（AA）。",
        f"对应边为 $PA\\leftrightarrow PC$，$PB\\leftrightarrow PD$，$AB\\leftrightarrow CD$，"
        f"故 ${proportion}$。",
        f"代入 ${mate}={mate_val}$、${k1}={k1_val}$、${k2}={k2_val}$，"
        f"得 ${substituted}$。",
        f"因此 ${deform_sub}$，所以 ${unknown}={final_val}$。",
    ]
    return [{"title": TITLES[i], "content": steps[i]} for i in range(4)]


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
