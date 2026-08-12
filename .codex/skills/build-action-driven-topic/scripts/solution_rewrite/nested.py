"""Rewrite nestedSimilarity solution_steps into a complete formal write-up.

Approved mathematical basis (from
artifacts/专题/2026-07-14-子母型相似比与对应边/02-student-explanation.resolved.tex):
- D lies on AC, so the common angle at A: angle BAD = angle CAB;
- together with the given angle ABD = angle ACB, triangle ABD ~ triangle ACB (AA);
- correspondence A<->A, B<->C, D<->B, so AB<->AC, AD<->AB, BD<->BC;
- the repeated side is AB: AC/AB = AB/AD, hence AB^2 = AC * AD;
- because D in AC: AD = AC - CD.
"""

import math
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
from _apply import apply_steps  # noqa: E402
from _check import _eval_node  # noqa: E402
from _common import load_yaml  # noqa: E402
from _radical import to_latex  # noqa: E402

BANK = "artifacts/题库/2026-07-16-子母型相似"
SIMILARITY = r"\triangle ABD\sim\triangle ACB"
GIVEN_ANGLE = r"\angle ABD=\angle ACB"
COMMON_ANGLE = (r"\angle BAD=\angle CAB", "公共角")


def clean_value(raw):
    v = raw.strip()
    v = re.split(r"[。.；;，,]", v)[0]
    v = v.strip("$")
    return v.strip()


def sv(stem, s):
    m = re.search(r"\$" + s + r"\s*=\s*([^$]+)\$", stem)
    return m.group(1).strip() if m else None


def frac(n, d):
    return r"\dfrac{%s}{%s}" % (n, d)


def _final(answer):
    m = re.search(r"=\s*(.+)", answer)
    return clean_value(m.group(1))


def build_block_steps(stem, answer):
    mu = re.search(r"(AC|AB|BD|BC|CD|AD)\s*=", answer)
    unk = mu.group(1)
    final = _final(answer)
    final_num = _eval_node(final)
    K = {s: sv(stem, s) for s in ["AC", "AB", "BD", "BC", "CD", "AD"]}
    KN = {s: (_eval_node(K[s]) if K[s] else None) for s in K}

    steps = []
    ang, reason = COMMON_ANGLE
    sim = (
        f"∵ ${ang}$（{reason}），且 ${GIVEN_ANGLE}$（已知），"
        f"∴ ${SIMILARITY}$（AA）。"
    )

    if unk == "AB" and K["AC"] and (K["AD"] or K["CD"]):
        ac, acn = K["AC"], KN["AC"]
        corr = (
            f"对应边为 $AB\\leftrightarrow AC$，$AD\\leftrightarrow AB$，$BD\\leftrightarrow BC$，"
            f"故 ${frac('AC', 'AB')}={frac('AB', 'AD')}$，即 $AB^2=AC\\cdot AD$。"
        )
        if K["AD"]:
            ad, adn = K["AD"], KN["AD"]
            sub = f"代入 ${ac}$、${ad}$，得 $AB^2={ac}\\times{ad}$。"
            deform = f"$AB=\\sqrt{{{ac}\\times{ad}}}$"
            steps = [sim, corr, sub, f"边长取正，{deform}，所以 $AB={final}$。"]
            titles = ["由公共角与等角判相似", "写出对应边与比例式", "代入数值", "取正根并写出结论"]
        else:
            cd, cdn = K["CD"], KN["CD"]
            ad_latex = to_latex(acn - cdn)
            sub = (
                f"点 $D$ 在 $AC$ 上，所以 $AD=AC-CD={ac}-{cd}={ad_latex}$；"
                f"代入得 $AB^2={ac}\\times{ad_latex}$。"
            )
            deform = f"$AB=\\sqrt{{{ac}\\times{ad_latex}}}$"
            steps = [sim, corr, sub, f"边长取正，{deform}，所以 $AB={final}$。"]
            titles = ["由公共角与等角判相似", "写出对应边与比例式", "求共线边并代入", "取正根并写出结论"]
    elif unk == "CD" and K["AC"] and K["AB"]:
        ac, acn, ab, abn = K["AC"], KN["AC"], K["AB"], KN["AB"]
        ad_num = abn * abn / acn
        ad_latex = to_latex(ad_num)
        corr = (
            f"对应边为 $AB\\leftrightarrow AC$，$AD\\leftrightarrow AB$，$BD\\leftrightarrow BC$，"
            f"故 ${frac('AC', 'AB')}={frac('AB', 'AD')}$，即 $AB^2=AC\\cdot AD$。"
        )
        sub = (
            f"代入 ${ac}$、${ab}$，得 $AD={frac(ab + '\\times' + ab, ac)}={ad_latex}$。"
        )
        steps = [
            sim,
            corr,
            sub,
            f"点 $D$ 在 $AC$ 上，所以 $CD=AC-AD={ac}-{ad_latex}$，"
            f"化简得 $CD={final}$；且 $AD+CD=AC$。",
        ]
        titles = ["由公共角与等角判相似", "写出对应边与比例式", "由比例反求 AD", "由共线关系求 CD"]
    elif unk == "AD" and K["AC"] and K["AB"]:
        ac, acn, ab, abn = K["AC"], KN["AC"], K["AB"], KN["AB"]
        ad_latex = to_latex(abn * abn / acn)
        corr = (
            f"对应边为 $AB\\leftrightarrow AC$，$AD\\leftrightarrow AB$，$BD\\leftrightarrow BC$，"
            f"故 ${frac('AC', 'AB')}={frac('AB', 'AD')}$，即 $AB^2=AC\\cdot AD$。"
        )
        sub = (
            f"代入 ${ac}$、${ab}$，得 $AD={frac(ab + '\\times' + ab, ac)}={ad_latex}$，"
            f"所以 $AD={final}$。"
        )
        steps = [sim, corr, sub]
        titles = ["由公共角与等角判相似", "写出对应边与比例式", "代入数值反求 AD"]
    elif unk == "AC" and K["AB"] and K["AD"]:
        ab, abn, ad, adn = K["AB"], KN["AB"], K["AD"], KN["AD"]
        ac_latex = to_latex(abn * abn / adn)
        corr = (
            f"对应边为 $AB\\leftrightarrow AC$，$AD\\leftrightarrow AB$，$BD\\leftrightarrow BC$，"
            f"故 ${frac('AC', 'AB')}={frac('AB', 'AD')}$，即 $AC\\cdot AD=AB^2$。"
        )
        sub = (
            f"代入 ${ab}$、${ad}$，得 $AC={frac(ab + '\\times' + ab, ad)}={ac_latex}$，"
            f"所以 $AC={final}$。"
        )
        steps = [sim, corr, sub]
        titles = ["由公共角与等角判相似", "写出对应边与比例式", "代入数值反求 AC"]
    else:
        raise ValueError(f"unsupported nested pattern: unk={unk} knowns={K}")

    return [{"title": titles[i], "content": steps[i]} for i in range(len(steps))]


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
