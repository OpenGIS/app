// utils/geo.js — shared geo helpers for ogis.app

/** Haversine distance between two { lat, lng } points, in metres. */
export function haversine(a, b) {
  const R = 6_371_000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Total distance of an array of { lat, lng } points, in metres. */
export function totalDistance(points) {
  let d = 0;
  for (let i = 1; i < points.length; i++) {
    d += haversine(points[i - 1], points[i]);
  }
  return d;
}

/** Format milliseconds as H:MM:SS or M:SS. */
export function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** Format a value with a localised unit using Intl (no digit grouping). */
const formatUnit = (value, unit, locale, fractionDigits) =>
  new Intl.NumberFormat(locale, {
    style: "unit",
    unit,
    unitDisplay: "short",
    useGrouping: false,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);

/**
 * Format metres as a human-readable distance string, respecting unit preference.
 * `locale` drives the number and unit formatting. Values are pre-rounded with
 * `toFixed`/`Math.round` before localisation, so the English output is
 * byte-identical to the previous fixed-point formatter.
 */
export function formatDistance(metres, isMetric = true, locale = "en") {
  if (isMetric) {
    return metres >= 1000
      ? formatUnit(Number((metres / 1000).toFixed(2)), "kilometer", locale, 2)
      : formatUnit(Math.round(metres), "meter", locale, 0);
  }
  const feet = metres * 3.28084;
  const miles = metres / 1609.344;
  return miles >= 0.1
    ? formatUnit(Number(miles.toFixed(2)), "mile", locale, 2)
    : formatUnit(Math.round(feet), "foot", locale, 0);
}
