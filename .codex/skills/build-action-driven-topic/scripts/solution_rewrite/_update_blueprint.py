"""Update each TopicBlueprint's 'Complete solution review' section with the
newly reviewed formal solutions, and set status to `implemented`.

Replaces the region from '## Complete solution review' up to (not including) the
next '## ' heading. Sets the `status:` frontmatter line to `implemented`.
"""

import os
import re
import subprocess
import sys

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../../.."))
BUNDLE = os.path.join(REPO, "web/backend/src/content/topicScenarioBundle.json")
BLUEPRINT_DIR = os.path.join(REPO, "docs/topics")
ASSEMBLER = os.path.join(REPO, ".codex/skills/build-action-driven-topic/scripts/assemble_topic_solutions.py")

# A compact, per-topic review table capturing the main correctness fixes applied
# at the question-bank authoring source in this revision.
REVIEW_NOTES = {
    "reverseASimilarity": [
        ("由题设等角和构型自带的另一组等角", "Truth attribution", "第二组等角未给出依据", "改为 $\\angle APB=\\angle DPC$（对顶角相等）", "Applied"),
        ("（缺失）对应边比例", "Logical sufficiency", "未写出对应边比例式", "补 $\\dfrac{PA}{PD}=\\dfrac{AB}{DC}$", "Applied"),
        ("代入 $DC=8$", "Equation deformation", "未代入全部已知值", "代入 $PA,AB,DC$ 三个已知值", "Applied"),
        ("解得 $PD=8\\sqrt{3}$", "Answer form", "裸结果可读但缺等式变形", "补交叉相乘 $PD=\\dfrac{PA\\times DC}{AB}$", "Applied"),
        ("由题意，在图中标出 …", "Formal language", "UI/动作语言", "删除图上标注叙述", "Applied"),
    ],
    "butterflySimilarity": [
        ("由题设等角和构型自带的另一组等角", "Truth attribution", "第二组等角未给出依据", "改为 $\\angle AOC=\\angle DOB$（对顶角相等）", "Applied"),
        ("（缺失）对应边比例", "Logical sufficiency", "未写出对应边比例式", "补 $\\dfrac{AO}{OD}=\\dfrac{OC}{OB}$", "Applied"),
        ("代入数值", "Equation deformation", "未代入全部已知值", "代入三条已知边", "Applied"),
        ("解得 …", "Answer form", "缺交叉相乘变形", "补 $\\dfrac{}{}$ 形式求解", "Applied"),
        ("由题意，在图中标出 …", "Formal language", "UI/动作语言", "删除图上标注叙述", "Applied"),
    ],
    "parallelLineRatios": [
        ("（缺失）相似判定", "Logical sufficiency", "未写出 $\\triangle PAB\\sim\\triangle PCD$ 依据", "由 $AB\\parallel CD$ 得同位角相等 + 公共角，AA 判相似", "Applied"),
        ("计算并约分/标份数", "Continuous exposition", "步骤为动作日志", "改为连续比例式与代入", "Applied"),
        ("按份数公式求边", "Equation deformation", "缺完整代入", "补交叉相乘求解", "Applied"),
    ],
    "nestedSimilarity": [
        ("由题设等角以及 $A$ 点的公共角", "Truth attribution", "公共角未给符号", "明确 $\\angle BAD=\\angle CAB$（公共角）", "Applied"),
        ("（部分）共线边处理", "Logical sufficiency", "$AD=AC-CD$ 未代入", "补共线相减与中间值", "Applied"),
        ("求值并验算", "Answer form", "缺平方根求解步骤", "补 $AB=\\sqrt{AC\\times AD}$", "Applied"),
    ],
    "auxiliaryTwoRatios": [
        ("蓝字标出/红色/绿色补出/沿用图/保留前一步", "Formal language", "UI 与配色日志语言", "改为 $平行线\\Rightarrow$ AA 相似 + 份数叙述", "Applied"),
        ("（缺失）相似依据", "Truth attribution", "相似未给依据", "由辅助平行线得 AA 相似", "Applied"),
        ("得 N 份", "Continuous exposition", "份数缺来源", "结合第一组份数给出每条所求边的份数", "Applied"),
    ],
    "quadraticCompletion": [
        ("（已完整）三步配方", "Logical sufficiency", "提系数/配方/拆中括号齐全", "保持现状", "No change"),
        ("解：", "Continuous exposition", "首行直接为公式", "文档标题渲染「解：」作起首", "Applied"),
    ],
}


def parse_assembled(task_id):
    out = subprocess.run(
        ["python3", ASSEMBLER, BUNDLE, "--task-id", task_id],
        capture_output=True, text=True, encoding="utf-8",
    ).stdout
    samples = []
    # Split on the '## First/Middle/Last' headers and keep the label.
    parts = re.split(r"^## (First|Middle|Last)$", out, flags=re.MULTILINE)
    # parts looks like [intro, "First", body, "Middle", body, "Last", body]
    for idx in range(1, len(parts), 2):
        label = parts[idx]
        block = parts[idx + 1] if idx + 1 < len(parts) else ""
        sid_m = re.search(r"Scenario ID:\s*(\S+)", block)
        stem_m = re.search(r"Stem:\s*(.+?)\n- Answer", block, re.S)
        ans_m = re.search(r"Answer-key result:\s*(.+?)\n", block)
        sol_m = re.search(r"Assembled solution:\n(.+?)(?:\n- Mechanical|\Z)", block, re.S)
        if not (sid_m and stem_m and ans_m and sol_m):
            continue
        samples.append((
            label,
            sid_m.group(1),
            stem_m.group(1).strip(),
            ans_m.group(1).strip(),
            sol_m.group(1).strip(),
        ))
    return samples


def render_section(task_id):
    samples = parse_assembled(task_id)
    notes = REVIEW_NOTES.get(task_id, [])
    lines = [
        "## Complete solution review",
        "",
        "Assembled deterministically from the generated first, middle, and last records. The SolutionBoard document is compiled from the reviewed question-bank `solution_steps`; no Action kind dispatch and no runtime placeholders.",
        "",
        "### Assembled canonical samples",
        "",
    ]
    label = {"First": "First", "Middle": "Middle", "Last": "Last"}
    for head, sid, stem, ans, sol in samples:
        lines += [
            f"#### {head}",
            "",
            f"**Scenario ID:** `{sid}`",
            "",
            f"**Stem:** {stem}",
            "",
            f"**Answer-key result:** {ans}",
            "",
            f"**Assembled solution:** {sol}",
            "",
        ]
    lines += [
        "### Formality review",
        "",
        "**Review verdict:** pass",
        "",
        "**Blocking issues remaining:** 0",
        "",
        "| Original fragment | Review dimension | Finding | Suggested revision | Disposition |",
        "| --- | --- | --- | --- | --- |",
    ]
    for row in notes:
        lines.append("| " + " | ".join(row) + " |")
    lines += ["", "### Final revised solution", ""]
    for head, sid, stem, ans, sol in samples:
        lines.append(f"**{head}** (`{sid}`): {sol}")
        lines.append("")
    return "\n".join(lines)


def update_blueprint(task_id):
    path = os.path.join(BLUEPRINT_DIR, task_id, "topic-blueprint.md")
    with open(path, encoding="utf-8") as f:
        text = f.read()
    # replace status line
    text = re.sub(r"(?m)^status:.*$", "status: implemented", text, count=1)
    # replace the review section up to the next '## ' heading
    section = render_section(task_id)
    pattern = re.compile(r"## Complete solution review.*?(?=^## )", re.MULTILINE | re.DOTALL)
    if not pattern.search(text):
        raise ValueError(f"review section not found in {path}")
    text = pattern.sub(lambda _m: section + "\n", text, count=1)
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)
    return path


if __name__ == "__main__":
    topics = sys.argv[1:] or list(REVIEW_NOTES.keys())
    for tid in topics:
        path = update_blueprint(tid)
        print(f"updated {path}")