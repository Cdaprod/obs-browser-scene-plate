/**
 * Media duration helpers for Program Monitor preview clock binding.
 */

export function resolveMediaDurationSeconds(videoEl) {
  const seconds = Number(videoEl?.duration);
  if (Number.isFinite(seconds) && seconds > 0) {
    return { state: "ready", seconds };
  }
  if (seconds === Number.POSITIVE_INFINITY) {
    return { state: "unbounded", seconds: Number.POSITIVE_INFINITY };
  }
  return { state: "loading", seconds: 0 };
}

