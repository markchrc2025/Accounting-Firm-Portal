// download.ts — save a file the server offers as an attachment (W15 R2).
//
// The signed links carry Content-Disposition: attachment (Track A U14), so
// following one in the page itself downloads the file and leaves the page
// where it is: no new tab, so no popup blocker.

/** Download the file at `url`, named `filename` where the browser allows. */
export function downloadFromUrl(url: string, filename: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Download a file the page already holds (C3: a draft's preview PDF), through
 *  the same in-page link: no new tab. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  downloadFromUrl(url, filename);
  // Let the click start the download before the object URL goes.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
