import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { shareFile } from "@/utils/share.js";

const blob = () => new Blob(["data"], { type: "application/gpx+xml" });

const stubShare = (share, canShare) => {
  Object.defineProperty(navigator, "share", {
    value: share,
    configurable: true,
  });
  Object.defineProperty(navigator, "canShare", {
    value: canShare,
    configurable: true,
  });
};

describe("shareFile", () => {
  let createObjectURL;
  let revokeObjectURL;
  let createSpy;
  let revokeSpy;
  let click;

  beforeEach(() => {
    createObjectURL = URL.createObjectURL;
    revokeObjectURL = URL.revokeObjectURL;
    createSpy = vi.fn(() => "blob:test");
    revokeSpy = vi.fn();
    URL.createObjectURL = createSpy;
    URL.revokeObjectURL = revokeSpy;
    click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    delete navigator.share;
    delete navigator.canShare;
  });

  afterEach(() => {
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    click.mockRestore();
    delete navigator.share;
    delete navigator.canShare;
    vi.useRealTimers();
  });

  it("shares a File when the Web Share API supports it", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    stubShare(share, () => true);

    await shareFile(blob(), "route.gpx", { title: "Route" });

    expect(share).toHaveBeenCalledTimes(1);
    const payload = share.mock.calls[0][0];
    expect(payload.title).toBe("Route");
    expect(payload.files[0].name).toBe("route.gpx");
    expect(createSpy).not.toHaveBeenCalled();
  });

  it("returns silently when the share sheet is aborted", async () => {
    const abort = new Error("cancelled");
    abort.name = "AbortError";
    stubShare(vi.fn().mockRejectedValue(abort), () => true);

    await shareFile(blob(), "route.gpx");

    expect(createSpy).not.toHaveBeenCalled();
  });

  it("falls back to a download when sharing fails", async () => {
    stubShare(vi.fn().mockRejectedValue(new Error("failed")), () => true);

    await shareFile(blob(), "route.gpx");

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
  });

  it("downloads through an anchor when the Web Share API is absent", async () => {
    vi.useFakeTimers();

    await shareFile(blob(), "route.geojson");

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);

    expect(revokeSpy).toHaveBeenCalledWith("blob:test");
  });
});
