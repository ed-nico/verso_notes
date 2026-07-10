/** Platform-specific UI wording. The platform comes over the preload bridge. */

const platform = window.inkwell?.platform ?? 'darwin'

export const isMac = platform === 'darwin'

/** Label for shell.showItemInFolder — each OS names its file manager differently. */
export const REVEAL_LABEL = isMac
  ? 'Reveal in Finder'
  : platform === 'win32'
    ? 'Show in Explorer'
    : 'Show in file manager'
