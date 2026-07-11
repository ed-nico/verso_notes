/** Resolve a markdown image/file `src` to something the renderer can load. */
export function assetUrl(src: string): string {
  if (/^(https?:|data:|verso:)/i.test(src)) return src
  // Workspace-relative path -> custom protocol served by the main process.
  return 'verso://asset/' + src.split('/').map(encodeURIComponent).join('/')
}

/** Read a File as base64 (no data: prefix), for saving via the asset IPC. */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}
