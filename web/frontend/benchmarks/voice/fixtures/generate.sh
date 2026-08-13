#!/usr/bin/env bash
# Reproducible voice-benchmark microphone fixtures.
#
# Generates fixed Chinese-speech WAVs (for ASR-success recorded-turn / live specs)
# plus a silence clip and a noise clip (for ASR-failure / arbitration specs). The
# ONLY allowed benchmark fixture is this fixed audio fed via Chromium
# --use-file-for-fake-audio-capture; nothing else is mocked.
#
# Requirements (macOS): `say`, `afconvert`, `python3`. No ffmpeg/sox needed.
# Output: 16 kHz mono 16-bit PCM WAV (RIFF), Chromium fake-capture compatible.
set -euo pipefail

cd "$(dirname "$0")"
mkdir -p generated
rm -f generated/*.wav generated/*.aiff

VOICE="${VOICE_BENCHMARK_FIXTURE_VOICE:-Tingting}"   # zh_CN female, standard on macOS
RATE="${VOICE_BENCHMARK_FIXTURE_RATE:-180}"          # words-per-minute knob for tuning length

speech () {  # name  text
  local name="$1" text="$2"
  say -v "$VOICE" -r "$RATE" -o "generated/${name}.aiff" "$text"
  afconvert "generated/${name}.aiff" "generated/${name}.wav" -d LEI16@16000 -f WAVE -c 1
  rm -f "generated/${name}.aiff"
}

# Fixed transcripts (documented in README.md).
speech short  "老师，这一步我没听懂。"
speech medium "老师，为什么这里要用交叉相乘？能不能换个方法再讲一遍？"
speech long   "老师，这道题的第二步我没看明白。您能把辅助线的画法再解释一下吗？另外，这种方法和昨天讲的例题有什么联系？我想先理解再自己动手做一遍。"

# Deterministic silence + noise via pure python (no third-party deps).
python3 - <<'PY'
import wave, struct, math, random, os
outdir = "generated"
rate = 16000

def write(name, frames):
    path = os.path.join(outdir, name)
    with wave.open(path, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate)
        w.writeframes(b"".join(struct.pack("<h", max(-32768, min(32767, int(s)))) for s in frames))

# 2 seconds of digital silence.
write("silence-2s.wav", [0] * (rate * 2))

# 2 seconds of reproducible white noise (seeded) — ASR should not transcribe it.
rnd = random.Random(20260813)
write("noise-unrecognizable-2s.wav", [rnd.uniform(-0.7, 0.7) * 32767 for _ in range(rate * 2)])
PY

# Report measured durations + sha256 for the README.
python3 - <<'PY'
import wave, hashlib, glob, os
for path in sorted(glob.glob("generated/*.wav")):
    with wave.open(path, "rb") as w:
        frames = w.getnframes(); rate = w.getframerate()
        dur = frames / rate
        sha = hashlib.sha256(open(path, "rb").read()).hexdigest()
    print(f"{os.path.basename(path)}\t{dur:.2f}s\t{rate}Hz\t{w.getnchannels()}ch\tsha256={sha}")
PY

echo "done"