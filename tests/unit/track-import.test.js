import { describe, it, expect } from "vitest";
import {
  MAX_TRACK_FILE_BYTES,
  TrackImportError,
  detectTrackFormat,
  parseGeoJSON,
  parseGPX,
  parseTrackFile,
} from "@/utils/track/index.js";

const gpx = (inner) =>
  `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">${inner}</gpx>`;

const T1 = "2024-01-01T00:00:00Z";
const T2 = "2024-01-01T00:01:00Z";
const MS1 = Date.parse(T1);
const MS2 = Date.parse(T2);

const featureCollection = (features) => ({
  type: "FeatureCollection",
  features,
});

describe("track import / format detection", () => {
  it("detects GPX and GeoJSON from content", () => {
    expect(detectTrackFormat(`\uFEFF  ${gpx("")}`)).toBe("gpx");
    expect(detectTrackFormat('  {"type":"FeatureCollection"}')).toBe("geojson");
  });

  it("returns null for unsupported content", () => {
    expect(detectTrackFormat("hello")).toBeNull();
    expect(detectTrackFormat("[]")).toBeNull();
    expect(detectTrackFormat("")).toBeNull();
    expect(detectTrackFormat(null)).toBeNull();
  });
});

describe("track import / GPX", () => {
  it("parses a track with elevation, times and a name", () => {
    const [doc] = parseGPX(
      gpx(`<trk><name>Morning</name><trkseg>
        <trkpt lat="51.5" lon="-0.1"><ele>10</ele><time>${T1}</time></trkpt>
        <trkpt lat="51.6" lon="-0.2"><ele>20</ele><time>${T2}</time></trkpt>
      </trkseg></trk>`),
    );

    expect(doc.kind).toBe("route");
    expect(doc.gpxType).toBe("trk");
    expect(doc.name).toBe("Morning");
    expect(doc.segments).toHaveLength(1);
    expect(doc.segments[0].points).toEqual([
      { lat: 51.5, lng: -0.1, ele: 10, t: MS1 },
      { lat: 51.6, lng: -0.2, ele: 20, t: MS2 },
    ]);
  });

  it("parses a GPX route", () => {
    const [doc] = parseGPX(
      gpx(`<rte><name>Trail</name>
        <rtept lat="10" lon="20"/>
        <rtept lat="11" lon="21"/>
      </rte>`),
    );

    expect(doc.gpxType).toBe("rte");
    expect(doc.name).toBe("Trail");
    expect(doc.segments[0].points).toEqual([
      { lat: 10, lng: 20 },
      { lat: 11, lng: 21 },
    ]);
  });

  it("preserves multiple trkseg segments and nested times", () => {
    const [doc] = parseGPX(
      gpx(`<trk><name>Split</name>
        <trkseg>
          <trkpt lat="1" lon="2"><time>${T1}</time></trkpt>
          <trkpt lat="3" lon="4"><time>${T2}</time></trkpt>
        </trkseg>
        <trkseg>
          <trkpt lat="5" lon="6"><time>${T1}</time></trkpt>
          <trkpt lat="7" lon="8"><time>${T2}</time></trkpt>
        </trkseg>
      </trk>`),
    );

    expect(doc.segments).toHaveLength(2);
    expect(doc.segments[0].points.map((point) => point.lat)).toEqual([1, 3]);
    expect(doc.segments[1].points.map((point) => point.lat)).toEqual([5, 7]);
    expect(doc.segments[0].points[0].t).toBe(MS1);
    expect(doc.segments[1].points[1].t).toBe(MS2);
  });

  it("attaches waypoints to a single line document", () => {
    const [doc] = parseGPX(
      gpx(`<wpt lat="9" lon="8"><ele>7</ele><time>${T1}</time><name>Camp</name><sym>Flag</sym></wpt>
        <trk><trkseg>
          <trkpt lat="1" lon="2"/>
          <trkpt lat="3" lon="4"/>
        </trkseg></trk>`),
    );

    expect(doc.waypoints).toEqual([
      { lat: 9, lng: 8, ele: 7, t: MS1, name: "Camp", sym: "Flag" },
    ]);
  });

  it("emits a sibling waypoints document for multiple lines", () => {
    const docs = parseGPX(
      gpx(`<wpt lat="9" lon="8"><name>Camp</name></wpt>
        <trk><name>One</name><trkseg>
          <trkpt lat="1" lon="2"/><trkpt lat="3" lon="4"/>
        </trkseg></trk>
        <trk><name>Two</name><trkseg>
          <trkpt lat="5" lon="6"/><trkpt lat="7" lon="8"/>
        </trkseg></trk>`),
    );

    expect(docs.map((doc) => doc.kind)).toEqual([
      "route",
      "route",
      "waypoints",
    ]);
    expect(docs[2].segments).toEqual([]);
    expect(docs[2].waypoints).toHaveLength(1);
  });

  it("emits a waypoints-only document", () => {
    const [doc] = parseGPX(
      gpx(`<wpt lat="9" lon="8"><name>Camp</name></wpt>`),
      { filename: "camp.gpx" },
    );

    expect(doc.kind).toBe("waypoints");
    expect(doc.name).toBe("camp");
    expect(doc.segments).toEqual([]);
    expect(doc.waypoints[0].name).toBe("Camp");
  });

  it("parses default-namespaced GPX", () => {
    const [doc] = parseGPX(
      gpx(`<trk><name>NS</name><trkseg>
        <trkpt lat="1" lon="2"/><trkpt lat="3" lon="4"/>
      </trkseg></trk>`),
    );
    expect(doc.name).toBe("NS");
  });

  it("parses prefixed GPX with the localName fallback", () => {
    const xml = `<?xml version="1.0"?>
      <gpx:gpx xmlns:gpx="http://www.topografix.com/GPX/1/1" version="1.1">
        <gpx:trk><gpx:name>Prefixed</gpx:name><gpx:trkseg>
          <gpx:trkpt lat="1" lon="2"><gpx:ele>5</gpx:ele><gpx:time>${T1}</gpx:time></gpx:trkpt>
          <gpx:trkpt lat="3" lon="4"><gpx:ele>6</gpx:ele><gpx:time>${T2}</gpx:time></gpx:trkpt>
        </gpx:trkseg></gpx:trk>
      </gpx:gpx>`;

    const [doc] = parseGPX(xml);
    expect(doc.name).toBe("Prefixed");
    expect(doc.segments[0].points).toEqual([
      { lat: 1, lng: 2, ele: 5, t: MS1 },
      { lat: 3, lng: 4, ele: 6, t: MS2 },
    ]);
  });

  it("falls back to <time> nodes when the library time list is short", () => {
    const [doc] = parseGPX(
      gpx(`<trk><trkseg>
        <trkpt lat="1" lon="2"><time>${T1}</time></trkpt>
        <trkpt lat="3" lon="4"/>
      </trkseg></trk>`),
    );

    expect(doc.segments[0].points[0].t).toBe(MS1);
    expect(doc.segments[0].points[1]).not.toHaveProperty("t");
  });

  it("discards sentinel elevations", () => {
    const [doc] = parseGPX(
      gpx(`<trk><trkseg>
        <trkpt lat="1" lon="2"><ele>-9999</ele></trkpt>
        <trkpt lat="3" lon="4"><ele>0</ele></trkpt>
      </trkseg></trk>`),
    );

    expect(doc.segments[0].points[0]).not.toHaveProperty("ele");
    expect(doc.segments[0].points[1].ele).toBe(0);
  });

  it("throws invalid-gpx for malformed XML", () => {
    expect(() => parseGPX("<gpx><trk></gpx>")).toThrow(TrackImportError);
    try {
      parseGPX("<gpx><trk></gpx>");
    } catch (error) {
      expect(error.code).toBe("invalid-gpx");
    }
  });

  it("throws invalid-gpx for a non-GPX root", () => {
    try {
      parseGPX("<kml><Placemark/></kml>");
    } catch (error) {
      expect(error.code).toBe("invalid-gpx");
    }
  });

  it("throws no-importable-features when nothing usable remains", () => {
    try {
      parseGPX(gpx(`<trk><trkseg><trkpt lat="1" lon="2"/></trkseg></trk>`));
    } catch (error) {
      expect(error.code).toBe("no-importable-features");
    }
  });
});

describe("track import / GeoJSON", () => {
  it("imports a FeatureCollection with a line and a waypoint", () => {
    const [doc] = parseGeoJSON(
      JSON.stringify(
        featureCollection([
          {
            type: "Feature",
            id: "line-1",
            properties: {
              name: "Line",
              _gpxType: "rte",
              coordinateProperties: { times: [T1, T2] },
            },
            geometry: {
              type: "LineString",
              coordinates: [
                [-0.1, 51.5, 10],
                [-0.2, 51.6, 20],
              ],
            },
          },
          {
            type: "Feature",
            properties: { name: "POI", desc: "A place" },
            geometry: { type: "Point", coordinates: [-0.15, 51.55, 30] },
          },
        ]),
      ),
    );

    expect(doc.id).toBe("line-1");
    expect(doc.name).toBe("Line");
    expect(doc.gpxType).toBe("rte");
    expect(doc.segments[0].points).toEqual([
      { lat: 51.5, lng: -0.1, ele: 10, t: MS1 },
      { lat: 51.6, lng: -0.2, ele: 20, t: MS2 },
    ]);
    expect(doc.waypoints[0]).toMatchObject({
      lat: 51.55,
      lng: -0.15,
      ele: 30,
      name: "POI",
      desc: "A place",
    });
  });

  it("imports a MultiLineString with nested times", () => {
    const [doc] = parseGeoJSON(
      JSON.stringify({
        type: "Feature",
        properties: {
          name: "Multi",
          coordinateProperties: {
            times: [
              [T1, T2],
              [T2, T1],
            ],
          },
        },
        geometry: {
          type: "MultiLineString",
          coordinates: [
            [
              [1, 2],
              [3, 4],
            ],
            [
              [5, 6],
              [7, 8],
            ],
          ],
        },
      }),
    );

    expect(doc.gpxType).toBe("trk");
    expect(doc.segments).toHaveLength(2);
    expect(doc.segments[0].points[0].t).toBe(MS1);
    expect(doc.segments[1].points[0].t).toBe(MS2);
  });

  it("accepts a bare LineString geometry", () => {
    const [doc] = parseGeoJSON(
      JSON.stringify({
        type: "LineString",
        coordinates: [
          [1, 2],
          [3, 4],
        ],
      }),
      { filename: "bare.geojson" },
    );

    expect(doc.name).toBe("bare");
    expect(doc.gpxType).toBe("trk");
    expect(doc.segments[0].points).toHaveLength(2);
  });

  it("imports MultiPoint as waypoints", () => {
    const [doc] = parseGeoJSON(
      JSON.stringify({
        type: "Feature",
        properties: {
          name: "Stops",
          coordinateProperties: { times: [T1, T2] },
        },
        geometry: {
          type: "MultiPoint",
          coordinates: [
            [1, 2],
            [3, 4],
          ],
        },
      }),
    );

    expect(doc.kind).toBe("waypoints");
    expect(doc.waypoints).toEqual([
      { lat: 2, lng: 1, t: MS1, name: "Stops" },
      { lat: 4, lng: 3, t: MS2, name: "Stops" },
    ]);
  });

  it("rejects unsupported geometry inside a FeatureCollection", () => {
    try {
      parseGeoJSON(
        JSON.stringify(
          featureCollection([
            {
              type: "Feature",
              properties: { name: "Area" },
              geometry: { type: "Polygon", coordinates: [] },
            },
            {
              type: "Feature",
              properties: { name: "Line" },
              geometry: {
                type: "LineString",
                coordinates: [
                  [0, 0],
                  [1, 1],
                ],
              },
            },
          ]),
        ),
      );
      throw new Error("expected failure");
    } catch (error) {
      expect(error.code).toBe("invalid-geojson");
    }
  });

  it("rejects arrays and unsupported geometry", () => {
    for (const input of [
      "[]",
      JSON.stringify({ type: "Polygon", coordinates: [] }),
      JSON.stringify({
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [] },
      }),
      JSON.stringify(
        featureCollection([
          {
            type: "Feature",
            geometry: { type: "Polygon", coordinates: [] },
          },
        ]),
      ),
    ]) {
      try {
        parseGeoJSON(input);
        throw new Error("expected failure");
      } catch (error) {
        expect(error.code).toBe("invalid-geojson");
      }
    }
  });

  it("throws no-importable-features when nothing valid remains", () => {
    try {
      parseGeoJSON(
        JSON.stringify(
          featureCollection([
            { type: "Feature", properties: {}, geometry: null },
          ]),
        ),
      );
    } catch (error) {
      expect(error.code).toBe("no-importable-features");
    }
  });

  it("does not misalign a short times array", () => {
    const [doc] = parseGeoJSON(
      JSON.stringify({
        type: "Feature",
        properties: { coordinateProperties: { times: [T1] } },
        geometry: {
          type: "LineString",
          coordinates: [
            [1, 2],
            [3, 4],
          ],
        },
      }),
    );

    expect(doc.segments[0].points[0]).not.toHaveProperty("t");
    expect(doc.segments[0].points[1]).not.toHaveProperty("t");
  });

  it("drops invalid coordinates and empty features", () => {
    const [doc] = parseGeoJSON(
      JSON.stringify(
        featureCollection([
          {
            type: "Feature",
            properties: { name: "Bad" },
            geometry: {
              type: "LineString",
              coordinates: [
                [999, 0],
                [0, 0],
              ],
            },
          },
          {
            type: "Feature",
            properties: { name: "Good" },
            geometry: {
              type: "LineString",
              coordinates: [
                [999, 0],
                [0, 0],
                [0.001, 0],
              ],
            },
          },
        ]),
      ),
    );

    expect(doc.name).toBe("Good");
    expect(doc.segments[0].points).toEqual([
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0.001 },
    ]);
  });

  it("numbers unnamed lines and preserves unique feature ids", () => {
    const docs = parseGeoJSON(
      JSON.stringify(
        featureCollection([
          {
            type: "Feature",
            id: 7,
            properties: {},
            geometry: {
              type: "LineString",
              coordinates: [
                [0, 0],
                [1, 1],
              ],
            },
          },
          {
            type: "Feature",
            id: 7,
            properties: {},
            geometry: {
              type: "LineString",
              coordinates: [
                [2, 2],
                [3, 3],
              ],
            },
          },
        ]),
      ),
      { filename: "multi-day.geojson" },
    );

    expect(docs.map((doc) => doc.name)).toEqual(["multi-day 1", "multi-day 2"]);
    expect(docs[0].id).toBe("7");
    expect(docs[1].id).not.toBe("7");
    expect(docs[0].source.groupId).toBe(docs[1].source.groupId);
    expect(docs.map((doc) => doc.source.index)).toEqual([0, 1]);
  });
});

describe("track import / files", () => {
  const file = (text, { name = "track.gpx", size = text.length } = {}) => ({
    name,
    size,
    text: async () => text,
  });

  it("parses a file and derives the fallback name from its filename", async () => {
    const [doc] = await parseTrackFile(
      file(
        gpx(`<trk><trkseg>
          <trkpt lat="1" lon="2"/><trkpt lat="3" lon="4"/>
        </trkseg></trk>`),
        { name: "my-route.gpx" },
      ),
    );

    expect(doc.name).toBe("my-route");
  });

  it("throws file-too-large before reading", async () => {
    try {
      await parseTrackFile(file("", { size: MAX_TRACK_FILE_BYTES + 1 }));
    } catch (error) {
      expect(error.code).toBe("file-too-large");
    }
  });

  it("throws unsupported-format for unknown content", async () => {
    try {
      await parseTrackFile(file("hello", { name: "track.txt" }));
    } catch (error) {
      expect(error.code).toBe("unsupported-format");
    }
  });
});
