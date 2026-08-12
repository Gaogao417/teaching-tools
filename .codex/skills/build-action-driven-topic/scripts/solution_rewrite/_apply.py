"""Apply generated solution_steps to a question-bank item file by surgical text
replacement, preserving every unrelated byte of the authoring source.

The solution_steps block is the region from the line `    solution_steps:` up to
(but not including) the next sibling block key at the same indentation, e.g.
`    teaching:` or `    diagram_col:`. We rewrite only that region.

`render_steps_block` renders steps with title + content (and content_latex when
present). Per-step auxiliary fields like diagram_col are NOT representable here;
use `apply_steps_titles_content` for items that must preserve per-step fields.
"""

import re


def render_steps_block(new_steps, indent="    "):
    """Render a YAML solution_steps list at 4-space indentation (title + content only)."""
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
        return None
    if not dry_run:
        with open(path, "w", encoding="utf-8") as f:
            f.write(new_text)
    return new_block


def apply_steps_titles_content(path, new_steps, dry_run=False):
    """Edit only each step's title and content in place, preserving every other
    per-step key (e.g. diagram_col). Used for items whose solution_steps carry
    stage diagrams the importer depends on.

    Each step in the file is a `- title: ...` list item; we replace its title
    line and the following `  content:` line, leaving the rest of the item
    (including any `  diagram_col:` block) untouched.
    """
    with open(path, encoding="utf-8") as f:
        text = f.read()
    # Locate the solution_steps region.
    start_m = re.search(r"(?m)^    solution_steps:\n", text)
    if not start_m:
        raise ValueError(f"solution_steps block not found in {path}")
    end_m = re.search(r"(?m)^    [A-Za-z_]", text[start_m.end():])
    region_end = start_m.end() + end_m.start() if end_m else len(text)
    region = text[start_m.end():region_end]
    new_region = region
    # For each new step, replace the n-th `- title: ...` and its `  content:`.
    step_starts = [m.start() for m in re.finditer(r"(?m)^    - title: ", region)]
    if len(step_starts) != len(new_steps):
        raise ValueError(
            f"step count mismatch in {path}: file has {len(step_starts)}, "
            f"new has {len(new_steps)}"
        )
    # Work backwards so indices stay valid.
    for idx in range(len(new_steps) - 1, -1, -1):
        s_start = step_starts[idx]
        # next step start or end of region
        s_end = step_starts[idx + 1] if idx + 1 < len(step_starts) else len(region)
        step_block = region[s_start:s_end]
        new = new_steps[idx]
        # replace title line
        replaced = re.sub(
            r"(?m)^(    - title: ).*$",
            lambda _m: _m.group(1) + new["title"],
            step_block,
            count=1,
        )
        # Replace the content line AND any continuation lines that belong to it.
        # Continuation lines are indented at 8+ spaces (deeper than the 6-space
        # `      content:` key) and are not a new `      key:` sibling. The
        # original content could be a multi-line folded scalar.
        content_key = "content_latex" if "content_latex" in new else "content"
        content_pat = re.compile(
            r"(?m)^(      " + ("content_latex" if "content_latex" in new else "content") + r"): .*$\n(?:        [^\n]*\n)*"
        )

        def _content_repl(_m):
            return f"      {content_key}: {new[content_key]}\n"

        replaced = content_pat.sub(_content_repl, replaced, count=1)
        new_region = new_region[:s_start] + replaced + new_region[s_end:]
    new_text = text[: start_m.end()] + new_region + text[region_end:]
    if new_text == text:
        return None
    if not dry_run:
        with open(path, "w", encoding="utf-8") as f:
            f.write(new_text)
    return new_text
