import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("@/composables/useMap.js", () => ({
  fitCountryBounds: vi.fn(),
}));

import { actions } from "@/actions.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** A map exposing only the view surface the Improve action reads. */
const createMap = ({
  center = { lat: 48.953134, lng: -55.643057 },
  zoom = 17.4,
} = {}) => ({
  getCenter: vi.fn(() => ({ ...center })),
  getZoom: vi.fn(() => zoom),
});

let openSpy;

beforeEach(() => {
  vi.clearAllMocks();
  openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
});

afterEach(() => {
  openSpy.mockRestore();
});

// ─── Improve ─────────────────────────────────────────────────────────────────

describe("actions / improve", () => {
  it("requires a map without dismissing the pane", () => {
    expect(actions.improve.needsMap).toBe(true);
    expect(actions.improve.dismissPanel).toBeUndefined();
  });

  it("orients the view before opening the live OSM note URL", () => {
    const map = createMap();
    const orientView = vi.fn();

    actions.improve.run({ map, orientView });

    // The camera is reset before the note opens, so the note reflects the
    // view the user was looking at rather than a mid-rotation pose.
    expect(orientView).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(orientView.mock.invocationCallOrder[0]).toBeLessThan(
      openSpy.mock.invocationCallOrder[0],
    );

    expect(openSpy).toHaveBeenCalledWith(
      "https://www.openstreetmap.org/note/new#map=17/48.953134/-55.643057&layers=DN",
      "_blank",
      "noopener,noreferrer",
    );

    // The URL is built from the map's live view at run time.
    expect(map.getCenter).toHaveBeenCalledTimes(1);
    expect(map.getZoom).toHaveBeenCalledTimes(1);
  });

  it("formats a negative longitude to six decimals and rounds the zoom", () => {
    const map = createMap({
      center: { lat: 40.712776, lng: -74.005974 },
      zoom: 12.6,
    });

    actions.improve.run({ map, orientView: vi.fn() });

    expect(openSpy).toHaveBeenCalledWith(
      "https://www.openstreetmap.org/note/new#map=13/40.712776/-74.005974&layers=DN",
      "_blank",
      "noopener,noreferrer",
    );
  });
});
