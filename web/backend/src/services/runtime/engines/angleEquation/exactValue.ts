// Exact value parsing and comparison for angle-equation engine.
// Supports: integers, fractions, pi-multiples (a*pi/b).
// All comparisons are order-independent and format-normalized.

export interface ParsedExactValue {
  num: number; // numerator (signed)
  den: number; // denominator (positive)
  hasPi: boolean;
}

// ─── GCD ─────────────────────────────────────────────────────────────

function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) {
    [a, b] = [b, a % b];
  }
  return a;
}

// ─── Normalize ───────────────────────────────────────────────────────

export function normalizeExactValue(v: ParsedExactValue): ParsedExactValue {
  let { num, den, hasPi } = v;
  if (den < 0) {
    num = -num;
    den = -den;
  }
  const g = gcd(Math.abs(num), den);
  return { num: num / g, den: den / g, hasPi };
}

// ─── Canonical key ───────────────────────────────────────────────────

function canonicalKey(v: ParsedExactValue): string {
  const n = normalizeExactValue(v);
  return `${n.num}/${n.den}/${n.hasPi ? "pi" : "n"}`;
}

// ─── Parse ───────────────────────────────────────────────────────────

export function parseExactValue(input: string): ParsedExactValue | null {
  const s = input.trim().replace(/\s+/g, "").replace(/π/g, "pi");
  if (s === "") return null;

  // Pure integer: "0", "-3", "5"
  if (/^-?\d+$/.test(s)) {
    return normalizeExactValue({ num: Number(s), den: 1, hasPi: false });
  }

  // Pure fraction: "1/2", "-3/4"
  {
    const m = s.match(/^(-?\d+)\/(\d+)$/);
    if (m) {
      return normalizeExactValue({
        num: Number(m[1]),
        den: Number(m[2]),
        hasPi: false,
      });
    }
  }

  // "pi" alone
  if (s === "pi") {
    return normalizeExactValue({ num: 1, den: 1, hasPi: true });
  }
  if (s === "-pi") {
    return normalizeExactValue({ num: -1, den: 1, hasPi: true });
  }

  // Integer * pi: "2*pi", "-3*pi", "pi" (already handled)
  {
    const m = s.match(/^(-?\d+)\*?pi$/);
    if (m) {
      return normalizeExactValue({
        num: Number(m[1]),
        den: 1,
        hasPi: true,
      });
    }
  }

  // Fraction * pi: "pi/6", "-pi/4", "5*pi/6", "-5*pi/6"
  {
    const m = s.match(/^(?:(-?\d+)\*)?pi\/(\d+)$/);
    if (m) {
      return normalizeExactValue({
        num: m[1] ? Number(m[1]) : 1,
        den: Number(m[2]),
        hasPi: true,
      });
    }
  }

  // Negative fraction of pi: already handled by the sign in num
  // Alternative form: "a*pi/b"
  {
    const m = s.match(/^(-?\d+)\*pi\/(\d+)$/);
    if (m) {
      return normalizeExactValue({
        num: Number(m[1]),
        den: Number(m[2]),
        hasPi: true,
      });
    }
  }

  return null;
}

// ─── Render ──────────────────────────────────────────────────────────

export function renderExactValue(v: ParsedExactValue): string {
  const n = normalizeExactValue(v);

  if (!n.hasPi) {
    if (n.den === 1) return `${n.num}`;
    return `${n.num}/${n.den}`;
  }

  // hasPi cases
  if (n.num === 0) return "0";

  if (n.den === 1) {
    if (n.num === 1) return "pi";
    if (n.num === -1) return "-pi";
    return `${n.num}*pi`;
  }

  const absNum = Math.abs(n.num);
  const sign = n.num < 0 ? "-" : "";
  const coeff = absNum === 1 ? "" : `${absNum}*`;

  return `${sign}${coeff}pi/${n.den}`;
}

// ─── Comparison ──────────────────────────────────────────────────────

export function exactValuesEqual(a: string, b: string): boolean {
  const pa = parseExactValue(a);
  const pb = parseExactValue(b);
  if (!pa || !pb) return false;
  return canonicalKey(pa) === canonicalKey(pb);
}

export function exactValueSetsEqual(setA: string[], setB: string[]): boolean {
  if (setA.length !== setB.length) return false;
  const keysA = setA
    .map((s) => parseExactValue(s))
    .filter((v): v is ParsedExactValue => v !== null)
    .map(canonicalKey)
    .sort();
  const keysB = setB
    .map((s) => parseExactValue(s))
    .filter((v): v is ParsedExactValue => v !== null)
    .map(canonicalKey)
    .sort();
  if (keysA.length !== keysB.length) return false;
  return keysA.every((k, i) => k === keysB[i]);
}

export function rangesEqual(
  a: [string, string],
  b: [string, string],
): boolean {
  return exactValuesEqual(a[0], b[0]) && exactValuesEqual(a[1], b[1]);
}

// ─── Numeric evaluation (for range comparison) ───────────────────────

export function evalExactNumeric(v: ParsedExactValue): number {
  const n = normalizeExactValue(v);
  const base = n.hasPi ? Math.PI : 1;
  return (n.num / n.den) * base;
}

export function parseAndEval(input: string): number | null {
  const v = parseExactValue(input);
  if (!v) return null;
  return evalExactNumeric(v);
}
