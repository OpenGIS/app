// share.js — share or download a generated file

import { reportError } from "@/resilience/errors.js";

/** Share a file through the Web Share API, falling back to an anchor download. */
export async function shareFile(
  blob,
  filename,
  { title, report = reportError } = {},
) {
  const file = new File([blob], filename, { type: blob.type });

  if (navigator.share) {
    if (!navigator.canShare || navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title });
        return true;
      } catch (err) {
        if (err.name === "AbortError") return false;
        report(err, { source: "share", phase: "web-share" });
        // Share failed for another reason — fall through to the download.
      }
    }
  }

  let url;
  let anchor;
  try {
    url = URL.createObjectURL(blob);
    anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  } catch (error) {
    report(error, { source: "share", phase: "download" });
    return false;
  } finally {
    if (anchor?.parentNode) {
      try {
        anchor.parentNode.removeChild(anchor);
      } catch {
        // Ignore cleanup failure on an already-detached anchor.
      }
    }
    if (url) setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return true;
}
