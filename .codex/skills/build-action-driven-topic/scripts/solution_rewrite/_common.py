"""Shared helpers for SolutionBoard content rewrite of question-bank solution_steps.

These tools rewrite the bank-owned authoring source
(`teacher.resolved.assignment.yaml` `solution_steps`) so the assembled
SolutionBoard is a complete, formal mathematical write-up. The generator never
inspects Action kind; it derives prose only from stem values and the answer key.

Design rules enforced for every topic:
- begin continuous exposition with the similarity/equation relation and its basis;
- name the exact correspondence before listing the proportion;
- substitute ALL known values, show equation deformation, then the final value;
- the final statement names the requested object (matches the answer key);
- no UI/Action language (click, input, system, blue/red, current action).
"""

import os
import re

# Reverse-A correspondence (validated against the approved explanation):
#   vertex correspondence A<->D, P<->P, B<->C
REVERSE_A_PAIRS = [("PA", "PD"), ("PB", "PC"), ("AB", "DC")]
# Butterfly correspondence: A<->D, O<->O, C<->B; stems use OD (not DO)
BUTTERFLY_PAIRS = [("AO", "OD"), ("OC", "OB"), ("AC", "DB")]
# Nested correspondence: A<->A, B<->C, D<->B
NESTED_PAIRS = [("AB", "AC"), ("AD", "AB"), ("BD", "BC")]


def load_yaml(path):
    import yaml

    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f)


def seg_value(stem, seg):
    """Extract the raw LaTeX value of $seg=value$ from a stem, or None."""
    m = re.search(r"\$" + re.escape(seg) + r"\s*=\s*([^$]+)\$", stem)
    return m.group(1).strip() if m else None


def unknown_from_answer(answer):
    """Extract the requested object name from an answer like '$PD=8\\sqrt{3}$。'"""
    m = re.search(
        r"(PA|PB|PC|PD|AB|AC|AD|BD|BC|CD|DC|AO|DO|OD|OA|OC|OB|BO|CO|DB|EF|CF|AP|PE|BP|PD)\s*=",
        answer,
    )
    return m.group(1) if m else None


def pair_for_unknown(pairs, unknown):
    """Return the correspondence pair that contains the unknown segment."""
    for p in pairs:
        if unknown in p:
            return p
    return None


def strip_trailing_period(s):
    return s.rstrip("。.；;")
