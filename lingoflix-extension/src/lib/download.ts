/**
 * Saves `text` as a file with the browser's own download: a Blob URL and a temporary link, so no
 * `downloads` permission is needed (v2 spec §7).
 */
export function downloadText(fileName: string, text: string, mimeType: string, doc: Document = document): void {
  const url = URL.createObjectURL(new Blob([text], { type: mimeType }));
  const link = doc.createElement('a');
  link.href = url;
  link.download = fileName;
  link.hidden = true;
  doc.body.append(link);
  link.click();
  link.remove();
  // The download has started by now; free the Blob a moment later.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
