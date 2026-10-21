import { describe, it, expect } from "vitest";
import {
  parseGeoJSON,
  parseGPX,
  toGeoJSON,
  toGPX,
  trackFilename,
  trackMime,
} from "@/utils/track/index.js";

const T1 = Date.parse("2024-01-01T00:00:00Z");
const T2 = Date.parse("2024-01-01T00:01:00Z");
const ISO1 = new Date(T1).toISOString();
const ISO2 = new Date(T2).toISOString();

const trackDoc = (overrides = {}) => ({
  v: 2,
  id: "r1",
  kind: "route",
  name: "My Route",
  gpxType: "trk",
  createdAt: null,
  source: { format: "gpx" },
  segments: [
    {
      points: [
        { lat: 51.5, lng: -0.1, ele: 10, t: T1 },
        { lat: 51.6, lng: -0.2, ele: 20, t: T2 },
      ],
    },
  ],
  waypoints: [],
  ...overrides,
});

describe("track export / GPX", () => {
  it("writes a GPX 1.1 document and escapes text", () => {
    const xml = toGPX(
      trackDoc({
        name: `A & B <C> "D" 'E'`,
        waypoints: [
          {
            lat: 1,
            lng: 2,
            ele: 3,
            t: T1,
            name: "W & <x>",
            desc: "d",
            cmt: "c",
            sym: "s",
            type: "t",
          },
        ],
      }),
    );

    expect(xml).toContain('version="1.1"');
    expect(xml).toContain('creator="ogis.app"');
    expect(xml).toContain('xmlns="http://www.topografix.com/GPX/1/1"');
    expect(xml).toContain("A &amp; B &lt;C&gt; &quot;D&quot; &apos;E&apos;");
    expect(xml).toContain("W &amp; &lt;x&gt;");
  });

  it("writes elevation and time in schema order", () => {
    const xml = toGPX(trackDoc());
    expect(xml).toMatch(
      /<trkpt lat="51.5" lon="-0.1">\s*<ele>10<\/ele>\s*<time>2024-01-01T00:00:00.000Z<\/time>\s*<\/trkpt>/,
    );
  });

  it("writes multiple segments as multiple trkseg elements", () => {
    const xml = toGPX(
      trackDoc({
        segments: [
          {
            points: [
              { lat: 1, lng: 2 },
              { lat: 3, lng: 4 },
            ],
          },
          {
            points: [
              { lat: 5, lng: 6 },
              { lat: 7, lng: 8 },
            ],
          },
        ],
      }),
    );

    expect(xml.match(/<trkseg>/g)).toHaveLength(2);
  });

  it("writes a single-segment route as rte/rtept", () => {
    const xml = toGPX(trackDoc({ gpxType: "rte" }));
    expect(xml).toContain("<rte>");
    expect(xml).toContain("<rtept ");
    expect(xml).not.toContain("<trk>");
  });

  it("writes a multi-segment route as a track", () => {
    const xml = toGPX(
      trackDoc({
        gpxType: "rte",
        segments: [
          {
            points: [
              { lat: 1, lng: 2 },
              { lat: 3, lng: 4 },
            ],
          },
          {
            points: [
              { lat: 5, lng: 6 },
              { lat: 7, lng: 8 },
            ],
          },
        ],
      }),
    );

    expect(xml).toContain("<trk>");
    expect(xml).not.toContain("<rte>");
  });

  it("writes waypoints before the line", () => {
    const xml = toGPX(
      trackDoc({
        waypoints: [
          {
            lat: 1,
            lng: 2,
            ele: 3,
            t: T1,
            name: "Camp",
            desc: "Night",
            cmt: "Note",
            sym: "Flag",
            type: "Stop",
          },
        ],
      }),
    );

    expect(xml).toMatch(
      /<wpt lat="1" lon="2">\s*<ele>3<\/ele>\s*<time>2024-01-01T00:00:00.000Z<\/time>\s*<name>Camp<\/name>\s*<cmt>Note<\/cmt>\s*<desc>Night<\/desc>\s*<sym>Flag<\/sym>\s*<type>Stop<\/type>\s*<\/wpt>/,
    );
    expect(xml.indexOf("<wpt ")).toBeLessThan(xml.indexOf("<trk>"));
  });

  it("writes track metadata in GPX 1.1 schema order", () => {
    const xml = toGPX(
      trackDoc({
        name: "Order",
        cmt: "Comment",
        desc: "Description",
        type: "Hiking",
      }),
    );

    expect(xml).toMatch(
      /<trk>\s*<name>Order<\/name>\s*<cmt>Comment<\/cmt>\s*<desc>Description<\/desc>\s*<type>Hiking<\/type>/,
    );
  });

  it("writes waypoint metadata in GPX 1.1 schema order", () => {
    const xml = toGPX(
      trackDoc({
        waypoints: [
          {
            lat: 1,
            lng: 2,
            name: "Camp",
            cmt: "Note",
            desc: "Night",
            sym: "Flag",
            type: "Stop",
          },
        ],
      }),
    );

    expect(xml).toMatch(
      /<wpt lat="1" lon="2">\s*<name>Camp<\/name>\s*<cmt>Note<\/cmt>\s*<desc>Night<\/desc>\s*<sym>Flag<\/sym>\s*<type>Stop<\/type>\s*<\/wpt>/,
    );
  });

  it("writes a waypoints-only document without a track", () => {
    const xml = toGPX({
      v: 2,
      id: "w1",
      kind: "waypoints",
      name: "Waypoints",
      gpxType: null,
      createdAt: null,
      source: { format: "gpx" },
      segments: [],
      waypoints: [{ lat: 1, lng: 2, name: "Camp" }],
    });

    expect(xml).toContain("<wpt ");
    expect(xml).not.toContain("<trk>");
    expect(xml).not.toContain("<rte>");
  });

  it("uses the name override", () => {
    const xml = toGPX(trackDoc(), { name: "Exported" });
    expect(xml).toContain("<name>Exported</name>");
    expect(xml).not.toContain("<name>My Route</name>");
  });
});

describe("track export / GeoJSON", () => {
  it("projects a line and waypoints without ogis properties", () => {
    const collection = toGeoJSON(
      trackDoc({
        segments: [
          {
            points: [
              { lat: 51.5, lng: -0.1, ele: 10, t: T1 },
              { lat: 51.6, lng: -0.2, ele: 20, t: T2 },
            ],
          },
        ],
        waypoints: [
          {
            lat: 51.55,
            lng: -0.15,
            ele: 30,
            t: T1,
            name: "POI",
            "ogis.color": "#fff",
          },
        ],
      }),
    );

    expect(collection.type).toBe("FeatureCollection");
    expect(collection.features).toHaveLength(2);

    const [line, point] = collection.features;
    expect(line.geometry).toEqual({
      type: "LineString",
      coordinates: [
        [-0.1, 51.5, 10],
        [-0.2, 51.6, 20],
      ],
    });
    expect(line.properties).toMatchObject({
      name: "My Route",
      _gpxType: "trk",
      coordinateProperties: { times: [ISO1, ISO2] },
    });
    expect(line.properties).not.toHaveProperty("ogis.color");

    expect(point.geometry).toEqual({
      type: "Point",
      coordinates: [-0.15, 51.55, 30],
    });
    expect(point.properties).toEqual({
      name: "POI",
      time: ISO1,
    });
  });

  it("uses nested coordinate times for multiple segments", () => {
    const collection = toGeoJSON(
      trackDoc({
        segments: [
          {
            points: [
              { lat: 1, lng: 2, t: T1 },
              { lat: 3, lng: 4, t: T2 },
            ],
          },
          {
            points: [
              { lat: 5, lng: 6, t: T2 },
              { lat: 7, lng: 8, t: T1 },
            ],
          },
        ],
      }),
    );

    expect(
      collection.features[0].properties.coordinateProperties.times,
    ).toEqual([
      [ISO1, ISO2],
      [ISO2, ISO1],
    ]);
  });

  it("omits coordinate times when any point lacks one", () => {
    const collection = toGeoJSON(
      trackDoc({
        segments: [
          {
            points: [
              { lat: 1, lng: 2, t: T1 },
              { lat: 3, lng: 4 },
            ],
          },
        ],
      }),
    );

    expect(collection.features[0].properties).not.toHaveProperty(
      "coordinateProperties",
    );
  });

  it("uses the name override", () => {
    const collection = toGeoJSON(trackDoc(), { name: "Exported" });
    expect(collection.features[0].properties.name).toBe("Exported");
  });
});

describe("track export / round trips", () => {
  it("round-trips GPX through the model", () => {
    const xml = `<?xml version="1.0"?>
      <gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
        <trk><name>Loop</name><trkseg>
          <trkpt lat="1" lon="2"><ele>3</ele><time>${ISO1}</time></trkpt>
          <trkpt lat="4" lon="5"><ele>6</ele><time>${ISO2}</time></trkpt>
        </trkseg></trk>
      </gpx>`;

    const [first] = parseGPX(xml);
    const [second] = parseGPX(toGPX(first));

    expect(second.name).toBe(first.name);
    expect(second.segments).toEqual(first.segments);
  });

  it("round-trips GeoJSON through the model", () => {
    const input = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {
            name: "Line",
            coordinateProperties: { times: [ISO1, ISO2] },
          },
          geometry: {
            type: "LineString",
            coordinates: [
              [2, 1, 3],
              [5, 4, 6],
            ],
          },
        },
        {
          type: "Feature",
          properties: { name: "POI", time: ISO1 },
          geometry: { type: "Point", coordinates: [8, 7, 9] },
        },
      ],
    };

    const [first] = parseGeoJSON(JSON.stringify(input));
    const [second] = parseGeoJSON(JSON.stringify(toGeoJSON(first)));

    expect(second.name).toBe("Line");
    expect(second.segments).toEqual(first.segments);
    expect(second.waypoints).toEqual(first.waypoints);
  });
});

describe("track export / filenames and MIME types", () => {
  it("sanitises the document name", () => {
    expect(trackFilename(trackDoc({ name: "My / Route: 1" }), "gpx")).toBe(
      "My Route 1.gpx",
    );
  });

  it("falls back to kind and id", () => {
    expect(
      trackFilename({ kind: "recording", id: "abc", name: null }, "geojson"),
    ).toBe("recording-abc.geojson");
    expect(
      trackFilename({ kind: "waypoints", id: "w1", name: null }, "gpx"),
    ).toBe("waypoints-w1.gpx");
  });

  it("uses the name override and strips an existing extension", () => {
    expect(trackFilename(trackDoc(), "geojson", { name: "copy.gpx" })).toBe(
      "copy.geojson",
    );
  });

  it("returns the download MIME types", () => {
    expect(trackMime("gpx")).toBe("application/gpx+xml");
    expect(trackMime("geojson")).toBe("application/geo+json");
  });
});
