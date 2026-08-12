"""Numerical consistency check for generated similarity solutions.

Uses a small recursive-descent parser to evaluate the LaTeX value expressions
produced by the solution rewriters, so nested \\dfrac{A\\times B}{C} and
\\frac{a}{b}\\sqrt{m} forms all evaluate correctly. Float tolerance is used;
this is a mechanical guard, not a proof checker.
"""

import math


class _P:
    def __init__(self, s):
        self.s = s
        self.i = 0

    def peek(self):
        return self.s[self.i] if self.i < len(self.s) else ""

    def eof(self):
        return self.i >= len(self.s)

    def take(self, n=1):
        out = self.s[self.i : self.i + n]
        self.i += n
        return out

    def skip_ws(self):
        while self.i < len(self.s) and self.s[self.i] in " \t":
            self.i += 1


def _parse_expr(p):
    """Parse a \\times-separated product of factors."""
    val = _parse_factor(p)
    while True:
        p.skip_ws()
        if p.s.startswith(r"\times", p.i):
            p.i += len(r"\times")
            val *= _parse_factor(p)
        else:
            break
    return val


def _parse_factor(p):
    """Parse a single numeric factor: frac, sqrt, number, or parenthesized group."""
    p.skip_ws()
    if p.s.startswith(r"\dfrac", p.i) or p.s.startswith(r"\frac", p.i):
        p.i += len(r"\dfrac") if p.s.startswith(r"\dfrac", p.i) else len(r"\frac")
        num = _parse_brace(p)
        den = _parse_brace(p)
        val = _eval_node(num) / _eval_node(den)
        # optional trailing \sqrt{m}
        p.skip_ws()
        if p.s.startswith(r"\sqrt", p.i):
            val *= math.sqrt(_eval_node(_parse_sqrt(p)))
        return val
    if p.s.startswith(r"\sqrt", p.i):
        return math.sqrt(_eval_node(_parse_sqrt(p)))
    # number, optional \sqrt{m}
    start = p.i
    while p.i < len(p.s) and (p.s[p.i].isdigit() or p.s[p.i] == "."):
        p.i += 1
    coef = float(p.s[start:p.i]) if p.i > start else 1.0
    p.skip_ws()
    if p.s.startswith(r"\sqrt", p.i):
        coef *= math.sqrt(_eval_node(_parse_sqrt(p)))
    return coef


def _parse_brace(p):
    p.skip_ws()
    assert p.peek() == "{", f"expected brace at {p.i}: {p.s[p.i:]!r}"
    p.i += 1
    depth = 1
    start = p.i
    while p.i < len(p.s) and depth > 0:
        if p.s[p.i] == "{":
            depth += 1
        elif p.s[p.i] == "}":
            depth -= 1
            if depth == 0:
                break
        p.i += 1
    content = p.s[start:p.i]
    p.i += 1  # consume }
    return content


def _parse_sqrt(p):
    assert p.s.startswith(r"\sqrt", p.i)
    p.i += len(r"\sqrt")
    return _parse_brace(p)


def _eval_node(s):
    return _parse_expr(_P(s))


def check_pair(deform_expr, final_expr):
    """Return (ok, detail). Both are latex value expressions (after '=')."""
    try:
        d = _eval_node(deform_expr)
        f = _eval_node(final_expr)
    except Exception as e:  # noqa: BLE001
        return None, f"eval-error: {e}"
    ok = math.isclose(d, f, rel_tol=1e-6, abs_tol=1e-6)
    return ok, f"{deform_expr}={d} vs final {final_expr}={f}"
