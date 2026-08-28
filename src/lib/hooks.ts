import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    const onVis = () => document.visibilityState === 'visible' && setNow(Date.now())
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('focus', onVis)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('focus', onVis)
    }
  }, [intervalMs])
  return now
}

export function useMedia(query: string) {
  const [match, setMatch] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches,
  )
  useEffect(() => {
    const mq = window.matchMedia(query)
    const on = () => setMatch(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [query])
  return match
}

export const useIsMobile = () => useMedia('(max-width: 767px)')

export function useLatest<T>(v: T) {
  const ref = useRef(v)
  useLayoutEffect(() => {
    ref.current = v
  })
  return ref
}

export function useEvent<A extends unknown[], R>(fn: (...a: A) => R) {
  const ref = useLatest(fn)
  return useCallback((...a: A) => ref.current(...a), [ref])
}

export function useDismissable(open: boolean, onClose: () => void) {
  const close = useEvent(onClose)
  useEffect(() => {
    if (!open) return
    const prevFocus = document.activeElement as HTMLElement | null
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if ((e.target as HTMLElement | null)?.closest?.('[data-escape-guard]')) return
      e.stopPropagation()
      close()
    }
    document.addEventListener('keydown', onKey, true)
    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.body.style.overflow = overflow
      prevFocus?.focus?.()
    }
  }, [open, close])
}

export function useAutoFocus<T extends HTMLElement>(active = true) {
  const ref = useRef<T>(null)
  useEffect(() => {
    if (!active) return

    const id = setTimeout(() => {
      const el = ref.current
      if (!el) return
      const target =
        el.querySelector<HTMLElement>('[data-autofocus]') ??
        el.querySelector<HTMLElement>('input,textarea,select,button')
      target?.focus()
    }, 0)
    return () => clearTimeout(id)
  }, [active])
  return ref
}

export function useFocusTrap<T extends HTMLElement>(active: boolean) {
  const ref = useRef<T>(null)
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !ref.current) return
      const items = ref.current.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])',
      )
      if (!items.length) return
      const list = Array.from(items).filter((el) => el.offsetParent !== null)
      const first = list[0]
      const last = list[list.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [active])
  return ref
}

export function useHashRoute(fallback: string) {
  const read = useCallback(
    () => (typeof location === 'undefined' ? fallback : location.hash.replace(/^#\/?/, '') || fallback),
    [fallback],
  )
  const [route, setRoute] = useState(read)
  useEffect(() => {
    const on = () => setRoute(read())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [read])
  const go = useCallback((next: string) => {
    if (location.hash.replace(/^#\/?/, '') === next) return
    location.hash = `/${next}`
  }, [])
  return [route, go] as const
}
