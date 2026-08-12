"""Small exact-form LaTeX formatter for the radical values that appear in the
similarity banks: integers, rationals a/b, and n*sqrt(m) or (a/b)*sqrt(m).

It works by recovering the exact value from a float using a limited search
(suitable for the small prime factors allowed by the number database). This
avoids a sympy dependency while keeping the generated write-up exact.
"""

import math
from fractions import Fraction


def _to_fraction(x, max_den=1000):
    f = Fraction(x).limit_denominator(max_den)
    return f


def to_latex(x):
    """Format a positive float as an exact LaTeX radical/integer/fraction."""
    if x == 0:
        return "0"
    sign = "-" if x < 0 else ""
    x = abs(x)
    f = _to_fraction(x)
    # Try integer.
    if f.denominator == 1:
        return sign + str(f.numerator)
    # Try rational first: if x is very close to a fraction, return a/b form.
    if f.denominator <= 1000 and math.isclose(float(f), x, rel_tol=1e-9):
        return f"{sign}\\frac{{{f.numerator}}}{{{f.denominator}}}"
    # Try (p/q)*sqrt(m): value^2 = (p/q)^2 * m.  Search small m.
    # value = sqrt(num/den); factor out square part.
    sq = f  # value = sqrt(f) when the original is a square root form
    # General: x = a/b * sqrt(m). Then x^2 = a^2/b^2 * m.
    num = f.numerator
    den = f.denominator
    # x^2 = num^2/den^2
    sqnum = num * num
    sqden = den * den
    # find m so that sqnum/sqden * m is... we want x = (a/b)*sqrt(m),
    # x^2 = a^2/b^2 * m. We already have x^2 = num^2/den^2 with x=num/den? No.
    # Re-derive: x is given. Want a,b,m with x = (a/b)*sqrt(m), gcd, m squarefree.
    # Then x^2 = (a^2 m)/b^2. So x^2 = num^2/den^2 => a^2 m / b^2 = num^2/den^2.
    # Set b=den (after reducing). Then a^2 m = num^2 => m = (num/a)^2 must be int.
    # Find largest a with a|num and num/a integer and m=(num/a)^2 ... actually
    # a^2*m=num^2 with m squarefree => a = num/sqrt(m), need sqrt(m)|num.
    # Search squarefree m in a small range; m = num^2/a^2.
    best = None
    for a in range(num, 0, -1):
        if num % a:
            continue
        m_num = (num // a) ** 2
        # check a is as large as possible means m as small as possible
        # require m_num to be integer squarefree? m_num = (num/a)^2 is a perfect square
        # so m = (num/a)^2 ; but we want sqrt(m) integer => m perfect square =>
        # then x = (a/den)*(num/a) = num/den which is rational, handled above.
        # So for irrational form x=(a/b)*sqrt(m), m must be squarefree and the
        # num/den representation came from limit_denominator approximation.
        pass
    # The fraction approach fails for irrationals. Use a numeric square test.
    for m in range(2, 200):
        ms = m
        y = x / math.sqrt(ms)
        fr = _to_fraction(y)
        if fr.denominator <= 1000 and math.isclose(fr.numerator / fr.denominator, y, rel_tol=1e-9):
            if math.isclose(fr * math.sqrt(ms), x, rel_tol=1e-9):
                if fr.denominator == 1:
                    return f"{sign}{fr.numerator}\\sqrt{{{ms}}}"
                return f"{sign}\\frac{{{fr.numerator}}}{{{fr.denominator}}}\\sqrt{{{ms}}}"
    # fall back to fraction form
    return f"{sign}\\frac{{{f.numerator}}}{{{f.denominator}}}"
