"""Regenerate auxiliaryTwoRatios solution_steps as formal mathematics.

The bank already embeds correct, per-item reasoning (auxiliary parallel line;
two AA-similarity pairs from the parallel; per-segment shares that combine into
the answer). This generator extracts those authoritative facts and re-renders
them as continuous formal Chinese, dropping UI/diagram-color wording
(蓝字/红色/绿色/沿用图/保留前一步/本步补出) and stating the parallel => AA basis
explicitly. It never inspects Action kind and invents no new reasoning.
"""

import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
from _apply import apply_steps_titles_content  # noqa: E402
from _common import load_yaml  # noqa: E402

BANK = "artifacts/题库/2026-07-17-比例辅助线两组比例-50题"


def _helper_info(content):
    m = re.search(
        r"过\s*([A-Z])\s*作\s*([A-Z]{2})\s*平行\s*([A-Z]{2})，交直线\s*([A-Z]{2})\s*于\s*([A-Z])",
        content,
    )
    if not m:
        return None
    through, aux_seg, ref_seg, line, end = m.groups()
    return {
        "through": through,
        "aux_seg": aux_seg,
        "ref_seg": ref_seg,
        "line": line,
        "end": end,
        "stmt": f"过 ${through}$ 作 ${aux_seg}\\parallel {ref_seg}$，交直线 ${line}$ 于 ${end}$。",
        "parallel": f"{aux_seg}\\parallel {ref_seg}",
    }


def _helper(content):
    info = _helper_info(content)
    return info["stmt"] if info else content


def _tris(content):
    m = re.search(r"\\triangle\s*([A-Z]+)\\sim\\triangle\s*([A-Z]+)", content)
    return (m.group(1), m.group(2)) if m else (None, None)


def _ratio(content):
    """Extract a 'X:Y=a:b' ratio conclusion if present."""
    m = re.search(
        r"\$([A-Z]{1,2}):([A-Z]{1,2})=(\\?frac\{[^}]+\}\{[^}]+\}|\\?\d+):(\\?frac\{[^}]+\}\{[^}]+\}|\\?\d+)\$",
        content,
    )
    if not m:
        return None
    return (m.group(1), m.group(2), m.group(3).replace("\\", ""), m.group(4).replace("\\", ""))


def _shares(content):
    """Extract all '$seg=val$ 份' share conclusions (returns list of (seg, latex_val))."""
    return re.findall(r"\$([A-Z]{1,2})=([^$]+?)\$\s*份", content)


def _norm_frac(latex):
    """'frac{a}{b}' -> 'a/b' plain; bare number stays."""
    m = re.fullmatch(r"frac\{(-?\d+)\}\{(-?\d+)\}", latex)
    if m:
        return f"{m.group(1)}/{m.group(2)}"
    return latex


def _shares_summary(shares):
    parts = []
    for seg, val in shares:
        v = _norm_frac(val)
        parts.append(f"${seg}$ 占 ${v}$ 份")
    return "、".join(parts)


def build_block_steps(stem, answer, existing):
    steps = existing
    hinfo = _helper_info(steps[0]["content"]) or {}
    parallel = hinfo.get("parallel", "")
    helper = hinfo.get("stmt", steps[0]["content"])
    (a1, b1) = _tris(steps[1]["content"])
    (a2, b2) = _tris(steps[2]["content"])
    r1 = _ratio(steps[1]["content"])
    shares2 = _shares(steps[2]["content"])
    # Some items put the first pair's result as shares instead of a ratio.
    shares1 = _shares(steps[1]["content"])

    asked = answer.split("=")[0].replace("$", "").strip()
    asked_pair = re.findall(r"(\d+):(\d+)", answer)[-1]

    # Preserve per-step diagram_col from the existing steps (auxiliary items
    # carry stage diagrams that the importer reads for annotation geometry).
    def _carry(index, new_title, new_content):
        item = {"title": new_title, "content": new_content}
        if index < len(steps) and steps[index].get("diagram_col"):
            item["diagram_col"] = steps[index]["diagram_col"]
        return item

    out = []
    out.append(_carry(0, "作平行辅助线", helper))

    # Step 1: first similarity + its conclusion. The parallel is the auxiliary line.
    basis1 = (
        f"由 ${parallel}$，得 $\\triangle {a1}\\sim\\triangle {b1}$（AA）"
        if parallel
        else f"得 $\\triangle {a1}\\sim\\triangle {b1}$（AA）"
    )
    if r1:
        seg_a, seg_k, a, b = r1
        basis1 += f"，故 ${seg_a}:{seg_k}={a}:{b}$。"
    elif shares1:
        basis1 += f"，得 {_shares_summary(shares1)}。"
    else:
        basis1 += "。"
    out.append(_carry(1, "解第一组相似", basis1))

    # Step 2: second similarity (same parallel) + shares of the requested segments.
    basis2 = (
        f"由 ${parallel}$，得 $\\triangle {a2}\\sim\\triangle {b2}$（AA）"
        if parallel
        else f"得 $\\triangle {a2}\\sim\\triangle {b2}$（AA）"
    )
    if shares2:
        basis2 += f"，结合第一组的份数得 {_shares_summary(shares2)}。"
    basis2 += "。"
    basis2 = basis2.replace("。。", "。")
    out.append(_carry(2, "解第二组相似", basis2))

    # Step 3: combine shares into the requested ratio.
    content3 = f"比较所求两条边的份数并化简，得 ${asked}={asked_pair[0]}:{asked_pair[1]}$。"
    out.append(_carry(3, "比较份数写出结论", content3))
    return out


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
        block_steps = build_block_steps(block["stem_latex"], block["answer"], block["solution_steps"])
        show = dry or q in ("Q001", "Q002", "Q026", "Q036", "Q040", "Q050")
        if show:
            print(f"=== {q} ===  ANS {block['answer']}")
            for s in block_steps:
                print(f"  [{s['title']}] {s['content']}")
            print()
        if apply:
            apply_steps_titles_content(path, block_steps)
