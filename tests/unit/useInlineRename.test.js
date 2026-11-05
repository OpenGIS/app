import { describe, it, expect, vi } from "vitest";
import { useInlineRename } from "../../src/composables/useInlineRename.js";

describe("useInlineRename", () => {
  it("opens with the current name and commits the trimmed draft", () => {
    const rename = useInlineRename();
    const apply = vi.fn();

    rename.begin("a", "Old name");
    expect(rename.editingId.value).toBe("a");
    expect(rename.draft.value).toBe("Old name");

    rename.draft.value = "  New name  ";
    rename.commit(apply);

    expect(apply).toHaveBeenCalledWith("a", "New name");
    expect(rename.editingId.value).toBeNull();
  });

  it("does nothing on a second commit (Enter then blur)", () => {
    const rename = useInlineRename();
    const apply = vi.fn();

    rename.begin("a", "x");
    rename.commit(apply);
    rename.commit(apply);

    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("cancel closes the editor without applying anything", () => {
    const rename = useInlineRename();
    const apply = vi.fn();

    rename.begin("a", "x");
    rename.cancel();
    rename.commit(apply);

    expect(apply).not.toHaveBeenCalled();
    expect(rename.editingId.value).toBeNull();
  });

  it("passes an empty name through so callers can reset to the default", () => {
    const rename = useInlineRename();
    const apply = vi.fn();

    rename.begin("a", "x");
    rename.draft.value = "   ";
    rename.commit(apply);

    expect(apply).toHaveBeenCalledWith("a", "");
  });
});
