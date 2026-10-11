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
