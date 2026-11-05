// useInlineRename.js — shared state for renaming a list item in place.
//
// One item is edited at a time. `begin` opens the editor with the current
// name, `commit` hands the trimmed text to the caller and closes the editor,
// and `cancel` closes it without changing anything. Both `commit` and
// `cancel` are safe to call twice (an Enter key press followed by the blur
// it causes), so the second call does nothing.

import { ref } from "vue";

export function useInlineRename() {
  const editingId = ref(null);
  const draft = ref("");

  const begin = (id, current) => {
    editingId.value = id;
    draft.value = current ?? "";
  };

  const cancel = () => {
    editingId.value = null;
    draft.value = "";
  };

  const commit = (apply) => {
    if (editingId.value === null) return;
    const id = editingId.value;
    const name = draft.value.trim();
    cancel();
    apply(id, name);
  };

  return { editingId, draft, begin, cancel, commit };
}
