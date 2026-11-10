import { describe, expect, it } from "vitest";
import { locateErrorCause } from "@/utils/locateError";

describe("locateErrorCause", () => {
  it("maps a permission denial", () => {
    expect(locateErrorCause({ code: 1 })).toBe("denied");
  });

  it("maps an unavailable position", () => {
    expect(locateErrorCause({ code: 2 })).toBe("unavailable");
  });

  it("maps a timeout", () => {
    expect(locateErrorCause({ code: 3 })).toBe("timeout");
  });

  it("treats a missing code as unknown", () => {
    expect(locateErrorCause({})).toBe("unknown");
  });

  it("treats a plain Error as unknown", () => {
    expect(locateErrorCause(new Error("watchPosition failed"))).toBe("unknown");
  });

  it("handles null and undefined", () => {
    expect(locateErrorCause(null)).toBe("unknown");
    expect(locateErrorCause(undefined)).toBe("unknown");
  });

  it("treats a non-numeric code as unknown", () => {
    expect(locateErrorCause({ code: "1" })).toBe("unknown");
    expect(locateErrorCause({ code: NaN })).toBe("unknown");
  });
});
