// share.js — share or download a generated file

/** Share a file through the Web Share API, falling back to an anchor download. */
export async function shareFile(blob, filename, { title } = {}) {
  const file = new File([blob], filename, { type: blob.type });

  if (navigator.share) {
    if (!navigator.canShare || navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title });
        return;
      } catch (err) {
        if (err.name === "AbortError") return;
        // Share failed for another reason — fall through to the download.
      }
    }
  }

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
