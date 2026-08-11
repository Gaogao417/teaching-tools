"""Apply generated solution_steps to a question-bank item file by surgical text
replacement, preserving every unrelated byte of the authoring source.

The solution_steps block is the region from the line `    solution_steps:` up to
(but not including) the next sibling block key at the same indentation, e.g.
`    teaching:` or `    diagram_col:`. We rewrite only that region.
"""

import re


def render_steps_block(new_steps, indent="    "):
    """Render a YAML solution_steps list at 4-space indentation."""
    lines = [f"{indent}solution_steps:"]
    for step in new_steps:
        title = step.get("title", "")
        content = step.get("content_latex", step.get("content", ""))
        lines.append(f"{indent}- title: {title}")
        if "content_latex" in step:
            lines.append(f"{indent}  content_latex: {content}")
        else:
            lines.append(f"{indent}  content: {content}")
    return "\n".join(lines) + "\n"


def apply_steps(path, new_steps, dry_run=False):
    with open(path, encoding="utf-8") as f:
        text = f.read()
    # Locate the solution_steps block: from its header line to the next sibling
    # key (4-space indented, non-list, non-indented continuation).
    pattern = re.compile(
        r"(?m)^    solution_steps:\n(?:(?!^    [A-Za-z_])[^\n]*\n)+",
        re.MULTILINE,
    )
    if not pattern.search(text):
        raise ValueError(f"solution_steps block not found in {path}")
    new_block = render_steps_block(new_steps)
    # Use a function replacement so backslashes in the LaTeX are not interpreted
    # as group/template escapes by re.sub.
    new_text = pattern.sub(lambda _m: new_block, text, count=1)
    if new_text == text:
        raise ValueError(f"no change produced for {path}")
    if not dry_run:
        with open(path, "w", encoding="utf-8") as f:
            f.write(new_text)
    return new_block
