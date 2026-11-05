import { ref } from "vue";

// One in-app confirmation at a time, shared across the app. Replaces the
// browser's window.confirm() so the question matches the app's look.
const request = ref(null); // { message, confirmLabel, resolve } | null

/**
 * Ask the user to confirm an action in the app's own dialog.
 *
 * @param {string} message      the question, e.g. 'Delete "Loop"?'
 * @param {{ confirmLabel?: string }} [options]  label for the confirm button
 *   (defaults to the localised "Delete")
 * @returns {Promise<boolean>}  true if confirmed, false if cancelled
 */
export const askConfirm = (message, { confirmLabel } = {}) =>
  new Promise((resolve) => {
    // A newer question replaces an unanswered one, which counts as cancelled.
    request.value?.resolve(false);
    request.value = { message, confirmLabel, resolve };
  });

/** State and answer handler for the dialog component. */
export const useConfirm = () => {
  const answer = (ok) => {
    const current = request.value;
    request.value = null;
    current?.resolve(ok);
  };
  return { request, answer };
};
