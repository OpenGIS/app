/**
 * Classify a geolocation failure into a UI-facing error cause.
 *
 * Only the standard numeric PositionError codes map to a specific cause.
 * Synchronous `watchPosition` throws and errors with a missing or non-numeric
 * code are treated as unknown, so the UI can still report them honestly.
 *
 * @param {{ code?: unknown } | null | undefined} error
 * @returns {'denied'|'unavailable'|'timeout'|'unknown'}
 */
export const locateErrorCause = (error) => {
  const code = error?.code;
  if (code === 1) return "denied";
  if (code === 2) return "unavailable";
  if (code === 3) return "timeout";
  return "unknown";
};
