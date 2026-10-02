// routes/gpx.js — pure GPX parser for ogis.app
// Dependency-free: uses the browser's native DOMParser. No Vue, no storage.

const parser = new DOMParser();

/**
 * Parse a GPX XML string into route objects.
 * Handles <trk><trkseg><trkpt> and <rte><rtept>.
 * @param {string} xml - GPX document text
 * @param {string} [fallbackName='Route'] - name used when GPX provides no <name>
 * @returns {Array<{ name: string, points: Array<{lat: number, lng: number}>, type: 'trk'|'rte' }>}
 * @throws {Error} if xml is not valid XML, or parses to zero usable routes
 */
export function parseGPX(xml, fallbackName = "Route") {
  const doc = parser.parseFromString(xml, "text/xml");

  if (doc.getElementsByTagName("parsererror").length > 0) {
    throw new Error("Invalid GPX file");
  }

  const routes = [];
  const elements = doc.getElementsByTagName("*");

  for (const el of elements) {
    let type = null;
    let pointEls = null;

    if (el.localName === "trk") {
      type = "trk";
      pointEls = el.getElementsByTagName("trkpt");
    } else if (el.localName === "rte") {
      type = "rte";
      pointEls = el.getElementsByTagName("rtept");
    } else {
      continue;
    }

    const points = [];
    for (const pt of pointEls) {
      const latAttr = pt.getAttribute("lat");
      const lngAttr = pt.getAttribute("lon");
      if (latAttr === null || lngAttr === null) continue;
      const lat = Number(latAttr);
      const lng = Number(lngAttr);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        points.push({ lat, lng });
      }
    }

    if (points.length >= 2) {
      const nameEl = el.getElementsByTagName("name")[0];
      const name = nameEl?.textContent?.trim() || fallbackName;
      routes.push({ name, points, type });
    }
  }

  if (routes.length === 0) {
    throw new Error("No routes found in GPX file");
  }

  return routes;
}
