import { describe, it, expect } from "vitest";
import { parseGPX } from "@/features/routes/gpx.js";

const trkGPX = (inner) => `<gpx version="1.1">${inner}</gpx>`;

describe("parseGPX / tracks", () => {
  it("parses a single trk with one trkseg and a name", () => {
    const routes = parseGPX(
      trkGPX(
        `<trk><name>Morning Loop</name><trkseg>
					<trkpt lat="12.34" lon="56.78"/>
					<trkpt lat="12.35" lon="56.79"/>
				</trkseg></trk>`,
      ),
    );

    expect(routes).toHaveLength(1);
    expect(routes[0].name).toBe("Morning Loop");
    expect(routes[0].type).toBe("trk");
    expect(routes[0].points).toEqual([
      { lat: 12.34, lng: 56.78 },
      { lat: 12.35, lng: 56.79 },
    ]);
  });

  it("parses multiple trk elements in document order", () => {
    const routes = parseGPX(
      trkGPX(
        `<trk><name>First</name><trkseg><trkpt lat="1" lon="2"/><trkpt lat="3" lon="4"/></trkseg></trk>
				<trk><name>Second</name><trkseg><trkpt lat="5" lon="6"/><trkpt lat="7" lon="8"/></trkseg></trk>`,
      ),
    );

    expect(routes.map((r) => r.name)).toEqual(["First", "Second"]);
    expect(routes[1].type).toBe("trk");
  });

  it("concatenates multiple trkseg point lists in order", () => {
    const routes = parseGPX(
      trkGPX(
        `<trk><name>Split</name>
					<trkseg><trkpt lat="1" lon="2"/><trkpt lat="3" lon="4"/></trkseg>
					<trkseg><trkpt lat="5" lon="6"/><trkpt lat="7" lon="8"/></trkseg>
				</trk>`,
      ),
    );

    expect(routes).toHaveLength(1);
    expect(routes[0].points).toEqual([
      { lat: 1, lng: 2 },
      { lat: 3, lng: 4 },
      { lat: 5, lng: 6 },
      { lat: 7, lng: 8 },
    ]);
  });
});

describe("parseGPX / routes", () => {
  it("parses rte/rtept as a route", () => {
    const routes = parseGPX(
      trkGPX(
        `<rte><name>Trail</name><rtept lat="10" lon="20"/><rtept lat="11" lon="21"/></rte>`,
      ),
    );

    expect(routes).toHaveLength(1);
    expect(routes[0].name).toBe("Trail");
    expect(routes[0].type).toBe("rte");
    expect(routes[0].points).toEqual([
      { lat: 10, lng: 20 },
      { lat: 11, lng: 21 },
    ]);
  });
});

describe("parseGPX / mixed trk and rte", () => {
  it("returns all routes in document order", () => {
    const routes = parseGPX(
      trkGPX(
        `<rte><name>R</name><rtept lat="1" lon="1"/><rtept lat="2" lon="2"/></rte>
				<trk><name>T</name><trkseg><trkpt lat="3" lon="3"/><trkpt lat="4" lon="4"/></trkseg></trk>`,
      ),
    );

    expect(routes.map((r) => [r.name, r.type])).toEqual([
      ["R", "rte"],
      ["T", "trk"],
    ]);
  });
});

describe("parseGPX / names", () => {
  it("uses fallbackName when <name> is absent", () => {
    const routes = parseGPX(
      trkGPX(
        `<trk><trkseg><trkpt lat="1" lon="2"/><trkpt lat="3" lon="4"/></trkseg></trk>`,
      ),
      "Imported route",
    );

    expect(routes[0].name).toBe("Imported route");
  });

  it("uses the default fallback 'Route' when not provided", () => {
    const routes = parseGPX(
      trkGPX(
        `<trk><trkseg><trkpt lat="1" lon="2"/><trkpt lat="3" lon="4"/></trkseg></trk>`,
      ),
    );

    expect(routes[0].name).toBe("Route");
  });

  it("uses fallbackName when <name> is empty", () => {
    const routes = parseGPX(
      trkGPX(
        `<trk><name>   </name><trkseg><trkpt lat="1" lon="2"/><trkpt lat="3" lon="4"/></trkseg></trk>`,
      ),
      "Fallback",
    );

    expect(routes[0].name).toBe("Fallback");
  });
});

describe("parseGPX / namespaced documents", () => {
  it("parses default-namespaced GPX correctly", () => {
    const xml = `<?xml version="1.0"?>
			<gpx xmlns="http://www.topografix.com/GPX/1/1">
				<trk><name>NS</name>
					<trkseg><trkpt lat="1" lon="2"/><trkpt lat="3" lon="4"/></trkseg>
				</trk>
			</gpx>`;

    const routes = parseGPX(xml);

    expect(routes).toHaveLength(1);
    expect(routes[0].name).toBe("NS");
    expect(routes[0].points).toEqual([
      { lat: 1, lng: 2 },
      { lat: 3, lng: 4 },
    ]);
  });
});

describe("parseGPX / robustness", () => {
  it("skips points with missing lat or lon", () => {
    const routes = parseGPX(
      trkGPX(
        `<trk><trkseg>
					<trkpt lat="1" lon="2"/>
					<trkpt lon="4"/>
					<trkpt lat="5"/>
					<trkpt lat="6" lon="7"/>
				</trkseg></trk>`,
      ),
    );

    expect(routes[0].points).toEqual([
      { lat: 1, lng: 2 },
      { lat: 6, lng: 7 },
    ]);
  });

  it("skips points with non-numeric lat or lon", () => {
    const routes = parseGPX(
      trkGPX(
        `<trk><trkseg>
					<trkpt lat="abc" lon="2"/>
					<trkpt lat="1" lon="xyz"/>
					<trkpt lat="Infinity" lon="3"/>
					<trkpt lat="4" lon="5"/>
					<trkpt lat="6" lon="7"/>
				</trkseg></trk>`,
      ),
    );

    expect(routes[0].points).toEqual([
      { lat: 4, lng: 5 },
      { lat: 6, lng: 7 },
    ]);
  });

  it("filters out routes with fewer than 2 points", () => {
    const routes = parseGPX(
      trkGPX(
        `<trk><name>One point</name><trkseg><trkpt lat="1" lon="2"/></trkseg></trk>
				<trk><name>Two points</name><trkseg><trkpt lat="3" lon="4"/><trkpt lat="5" lon="6"/></trkseg></trk>`,
      ),
    );

    expect(routes).toHaveLength(1);
    expect(routes[0].name).toBe("Two points");
  });

  it("throws when every track ends up with fewer than 2 points", () => {
    expect(() =>
      parseGPX(
        trkGPX(
          `<trk><name>Broken</name><trkseg><trkpt lat="x" lon="y"/><trkpt lat="z" lon="w"/></trkseg></trk>`,
        ),
      ),
    ).toThrow("No routes found in GPX file");
  });

  it("throws for invalid XML", () => {
    expect(() => parseGPX("<gpx><trk></gpx>")).toThrow("Invalid GPX file");
  });

  it("throws for valid XML with no trk or rte", () => {
    expect(() =>
      parseGPX(`<gpx><wpt lat="1" lon="2"><name>Waypoint</name></wpt></gpx>`),
    ).toThrow("No routes found in GPX file");
  });

  it("throws for valid XML whose routes all have < 2 points", () => {
    expect(() =>
      parseGPX(trkGPX(`<trk><trkseg><trkpt lat="1" lon="2"/></trkseg></trk>`)),
    ).toThrow("No routes found in GPX file");
  });

  it("throws for empty string input", () => {
    expect(() => parseGPX("")).toThrow();
  });
});
