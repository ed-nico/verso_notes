import { useEffect, useRef, useState } from 'react'
import { embedUrl, supportsTimestamps, videoKey, type VideoRef } from '../lib/video'
import { currentTime, installVideoListener, registerPlayer, startListening } from '../lib/videobus'

interface Geom {
  top: number
  left: number
  width: number
}

/** An in-app player for a YouTube/Vimeo/Loom video, with an "add timestamped note" action.
 *  As you scroll the video out of the top of the editor it pins in place (full size) so you
 *  can keep watching while taking notes. The iframe is never re-mounted (only re-positioned),
 *  so playback continues uninterrupted. */
export function VideoEmbed({
  video,
  onAddTimestamp
}: {
  video: VideoRef
  onAddTimestamp?: (key: string, seconds: number) => void
}): React.JSX.Element {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const key = videoKey(video)
  const [stuck, setStuck] = useState(false)
  const [geom, setGeom] = useState<Geom | null>(null)
  const reserveH = useRef(0)
  const wasStuck = useRef(false)

  useEffect(() => {
    installVideoListener()
    const el = iframeRef.current
    if (!el) return
    const unregister = registerPlayer(key, video.provider, el)
    const onLoad = (): void => {
      startListening(key)
      window.setTimeout(() => startListening(key), 700)
    }
    el.addEventListener('load', onLoad)
    return () => {
      el.removeEventListener('load', onLoad)
      unregister()
    }
  }, [key, video.provider])

  // Pin the player the instant its top reaches the top of the editor (so it never scrolls
  // partly off-screen), and keep it pinned while its in-flow slot is above the top.
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const scrollEl = root.closest('.scroll-area') as HTMLElement | null
    if (!scrollEl) return
    const measure = (): Geom => {
      const r = root.getBoundingClientRect() // left/width of the (reserved) slot — unaffected by scroll
      return { top: scrollEl.getBoundingClientRect().top, left: r.left, width: r.width }
    }
    // Detect stick/unstick transitions only (cheap; no per-scroll re-render).
    const evaluate = (): void => {
      const saTop = scrollEl.getBoundingClientRect().top
      // root is the in-flow slot (reserved height while stuck), so its top is the natural top.
      const naturalTop = root.getBoundingClientRect().top
      const shouldStick = naturalTop <= saTop
      if (shouldStick === wasStuck.current) return
      if (shouldStick) {
        reserveH.current = root.offsetHeight
        setGeom(measure())
      }
      wasStuck.current = shouldStick
      setStuck(shouldStick)
    }
    const onResize = (): void => {
      if (wasStuck.current) setGeom(measure())
      evaluate()
    }
    evaluate()
    scrollEl.addEventListener('scroll', evaluate, { passive: true })
    window.addEventListener('resize', onResize)
    return () => {
      scrollEl.removeEventListener('scroll', evaluate)
      window.removeEventListener('resize', onResize)
    }
  }, [key])

  const playerStyle: React.CSSProperties | undefined =
    stuck && geom ? { position: 'fixed', top: geom.top, left: geom.left, width: geom.width, zIndex: 40 } : undefined

  return (
    <div
      className={'video-embed' + (stuck ? ' video-stuck' : '')}
      ref={rootRef}
      contentEditable={false}
      style={stuck ? { height: reserveH.current } : undefined}
    >
      <div className="video-player" style={playerStyle}>
        <div className="video-frame">
          <iframe
            ref={iframeRef}
            src={embedUrl(video)}
            title={`${video.provider} video`}
            allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
            allowFullScreen
          />
        </div>
        {onAddTimestamp && supportsTimestamps(video.provider) && (
          <div className="video-toolbar">
            <button
              className="video-ts-btn"
              title="Insert a note at the current play time (⌘;)"
              onMouseDown={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onAddTimestamp(key, Math.floor(currentTime(key) ?? 0))
              }}
            >
              ⏱ Add note at current time
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
