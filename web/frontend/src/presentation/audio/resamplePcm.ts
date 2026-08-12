/** Linear phase-accumulating resampler used to verify the AudioWorklet algorithm. */
export function resamplePcm(input: Float32Array, sourceRate: number, targetRate = 16_000): Float32Array {
  if (sourceRate <= 0 || targetRate <= 0) throw new Error("sample rates must be positive");
  if (!input.length || sourceRate === targetRate) return input.slice();
  const ratio = sourceRate / targetRate;
  const length = Math.max(0, Math.floor((input.length - 1) / ratio) + 1);
  const output = new Float32Array(length);
  let position = 0;
  for (let index = 0; index < length; index += 1) {
    const left = Math.floor(position);
    const right = Math.min(input.length - 1, left + 1);
    const fraction = position - left;
    output[index] = input[left] + (input[right] - input[left]) * fraction;
    position += ratio;
  }
  return output;
}
