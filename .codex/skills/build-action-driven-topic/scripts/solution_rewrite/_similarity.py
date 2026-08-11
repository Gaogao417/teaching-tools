"""Shared AA-similarity solution builder for reverse-A and butterfly topics.

Both share the same mathematical structure:
- two equal angles (one given, one a vertical/common angle) => AA similarity;
- a fixed vertex correspondence giving three correspondence pairs;
- three knowns: one mate of the unknown's pair + both sides of another pair.

The builder produces a continuous formal write-up:
1. assert both angles with their basis, conclude similarity by AA;
2. state the correspondence and the proportion;
3. substitute all known values (keep the unknown symbolic);
4. cross-multiply, substitute numbers, state the final answer naming the object.
"""

import re

from _common import seg_value, unknown_from_answer


def clean_value(raw):
    v = raw.strip()
    v = re.split(r"[。.；;，,]", v)[0]
    v = v.strip("$")
    return v.strip()


def _final_val(answer):
    m = re.search(r"=\s*(.+)", answer)
    return clean_value(m.group(1))


def _frac(num, den):
    return r"\dfrac{%s}{%s}" % (num, den)


def build_aa_solution(stem, answer, angle_given, angle_basis, similarity_stmt, pairs, titles):
    """Build a 4-step formal solution for an AA-similarity fourth-side problem.

    angle_given: latex of the given equal angle statement, e.g. r"\\angle PAB=\\angle PDC".
    angle_basis: text basis for the SECOND equal angle, e.g.
                 (latex, reason). latex e.g. r"\\angle APB=\\angle DPC", reason e.g. "对顶角相等".
    similarity_stmt: latex, e.g. r"\\triangle PAB\\sim\\triangle PDC".
    pairs: three correspondence pairs ordered (small-tri side, large-tri side).
    titles: list of 4 step titles.
    """
    unknown = unknown_from_answer(answer)
    if unknown is None:
        raise ValueError(f"cannot find unknown in answer: {answer}")
    upair = next((p for p in pairs if unknown in p), None)
    if upair is None:
        raise ValueError(f"unknown {unknown} not in any pair")
    mate = upair[1] if upair[0] == unknown else upair[0]
    mate_val = seg_value(stem, mate)
    known_pair = next(
        (p for p in pairs if p != upair and seg_value(stem, p[0]) and seg_value(stem, p[1])),
        None,
    )
    if known_pair is None:
        raise ValueError("no fully-known correspondence pair")
    k1, k2 = known_pair
    k1_val, k2_val = seg_value(stem, k1), seg_value(stem, k2)
    final_val = _final_val(answer)

    # Orient: small/large = k1/k2, with unknown placed on the left ratio.
    unknown_small = upair.index(unknown) == 0
    left_top = unknown if unknown_small else mate
    left_bot = mate if unknown_small else unknown
    proportion = f"{_frac(left_top, left_bot)}={_frac(k1, k2)}"

    # Substitute knowns, keep the unknown symbolic.
    val_of = {mate: mate_val, k1: k1_val, k2: k2_val, unknown: unknown}
    substituted = f"{_frac(val_of[left_top], val_of[left_bot])}={_frac(k1_val, k2_val)}"

    # Cross-multiplication deformation with numbers.
    if left_bot == unknown:
        deform_sub = f"{unknown}={_frac(mate_val + r'\times' + k1_val, k2_val)}"
    else:
        deform_sub = f"{unknown}={_frac(mate_val + r'\times' + k2_val, k1_val)}"

    ang_latex, ang_reason = angle_basis
    steps = [
        f"∵ ${angle_given}$（已知），且 ${ang_latex}$（{ang_reason}），"
        f"∴ ${similarity_stmt}$（AA）。",
        f"对应边为 ${pairs[0][0]}\\leftrightarrow {pairs[0][1]}$，"
        f"${pairs[1][0]}\\leftrightarrow {pairs[1][1]}$，"
        f"${pairs[2][0]}\\leftrightarrow {pairs[2][1]}$，故 ${proportion}$。",
        f"代入 ${mate}={mate_val}$、${k1}={k1_val}$、${k2}={k2_val}$，"
        f"得 ${substituted}$。",
        f"因此 ${deform_sub}$，所以 ${unknown}={final_val}$。",
    ]
    return [{"title": titles[i], "content": steps[i]} for i in range(4)]
