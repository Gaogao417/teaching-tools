/**
 * Calculate dimensions to fit a source rectangle inside a container
 * while preserving aspect ratio (contain mode).
 *
 * Pure function — no DOM access.
 */
export function fitContainedRect(
  containerWidth: number,
  containerHeight: number,
  sourceWidth: number,
  sourceHeight: number,
  maxWidth = 720,
): { width: number; height: number } {
  if (sourceWidth <= 0 || sourceHeight <= 0 || containerWidth <= 0 || containerHeight <= 0) {
    return { width: 0, height: 0 };
  }

  const scale = Math.min(
    containerWidth / sourceWidth,
    containerHeight / sourceHeight,
    maxWidth / sourceWidth,
  );

  return {
    width: Math.floor(sourceWidth * scale),
    height: Math.floor(sourceHeight * scale),
  };
}
