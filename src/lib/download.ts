/** Save a blob to the user's downloads folder. */
export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Strip a trailing extension so we can build names like `report (pages 1-5).pdf`. */
export function stripExtension(filename: string): string {
  return filename.replace(/\.[^./\\]+$/, '');
}

/** Remove characters that browsers or filesystems dislike in a download name. */
export function safeFilename(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, '-').trim() || 'document';
}
