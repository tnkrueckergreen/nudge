import { Footprints, MapPin, TriangleAlert, Wifi } from 'lucide-react'
import type { MeetingKind } from '../../lib/types'
import { kindOf, type Hop, type Place } from '../../lib/meetings'
import { cx } from '../ui'

export function KindBadge({
  kind,
  size = 'sm',
  tone = 'plain',
  className,
}: {
  kind: MeetingKind
  size?: 'xs' | 'sm' | 'md'

  tone?: 'plain' | 'solid'
  className?: string
}) {
  const spec = kindOf(kind)
  const Icon = spec.icon
  const dims = {
    xs: { box: 'h-[15px] gap-[3px] px-[4px] rounded-[5px]', text: 'text-[8.5px]', icon: 9 },
    sm: { box: 'h-[18px] gap-[4px] px-[5px] rounded-[6px]', text: 'text-[9.5px]', icon: 11 },
    md: { box: 'h-[22px] gap-[5px] px-2 rounded-md', text: 'text-[11px]', icon: 13 },
  }[size]

  return (
    <span
      title={spec.label}
      className={cx(
        'inline-flex items-center font-semibold uppercase tracking-[0.06em] whitespace-nowrap shrink-0',
        dims.box,
        tone === 'solid' ? 'bg-surface/85 text-ink-2' : 'bg-tint-2 text-ink-2',
        className,
      )}
    >
      <Icon size={dims.icon} strokeWidth={2.1} className="shrink-0 opacity-90" aria-hidden />
      <span className={dims.text} aria-hidden>
        {spec.short}
      </span>
      <span className="sr-only">{spec.label}</span>
    </span>
  )
}

export function KindGlyph({ kind, size = 11, className }: { kind: MeetingKind; size?: number; className?: string }) {
  const spec = kindOf(kind)
  const Icon = spec.icon
  return (
    <>
      <Icon size={size} strokeWidth={2.1} className={cx('shrink-0', className)} aria-hidden />
      <span className="sr-only">{spec.label}</span>
    </>
  )
}

export function PlaceLine({
  place,
  size = 'sm',
  className,
  showRoom = true,
}: {
  place: Place | null
  size?: 'xs' | 'sm'
  className?: string
  showRoom?: boolean
}) {
  if (!place) return null
  const text = size === 'xs' ? 'text-[10px]' : 'text-[11.5px]'
  return (
    <span className={cx('inline-flex items-center gap-1 min-w-0', text, className)}>
      {place.remote ? (
        <Wifi size={size === 'xs' ? 9 : 11} className="shrink-0 text-ink-3" aria-hidden />
      ) : (
        <MapPin size={size === 'xs' ? 9 : 11} className="shrink-0 text-ink-3" aria-hidden />
      )}
      <span className="truncate">
        <span className="font-medium text-ink-2">{place.building || place.room}</span>
        {showRoom && place.building && place.room && <span className="text-ink-3"> {place.room}</span>}
      </span>
    </span>
  )
}

const hopWords = (hop: Hop) => {
  if (hop.clash) return `Overlaps: ${hop.from.building} and ${hop.to.building} at once`
  if (hop.to.remote) return `${hop.gapMin} min to get online after ${hop.from.building}`
  return `${hop.gapMin} min to get from ${hop.from.building} to ${hop.to.building}`
}

export function HopRow({ hop, className }: { hop: Hop; className?: string }) {
  const tone = hop.clash || hop.tight ? 'text-[var(--c-critical-ink)]' : 'text-ink-3'
  return (
    <li
      className={cx('flex items-center gap-2.5 px-1.5 py-[3px] select-none', className)}
      aria-label={hopWords(hop)}
    >
      <span className="w-[42px] shrink-0" aria-hidden />
      <span className="w-[18px] shrink-0" aria-hidden />
      <span className={cx('inline-flex items-center gap-1.5 text-[11.5px] leading-none min-w-0', tone)} aria-hidden>
        {hop.clash ? <TriangleAlert size={11} className="shrink-0" /> : <Footprints size={11} className="shrink-0" />}
        <span className="tnum font-medium">
          {hop.clash ? 'Clashes' : `${Math.max(0, hop.gapMin)} min`}
        </span>
        <span className="truncate opacity-90">
          {hop.clash ? `${hop.from.building} / ${hop.to.building}` : `→ ${hop.to.building}`}
        </span>
      </span>
    </li>
  )
}

export function HopTag({
  hop,
  minutes = true,
  className,
}: {
  hop: Hop

  minutes?: boolean
  className?: string
}) {
  return (
    <span
      title={hopWords(hop)}
      className={cx(
        'inline-flex items-center gap-[3px] h-[15px] px-[4px] rounded-[5px] text-[9px] font-semibold tnum whitespace-nowrap',
        hop.clash || hop.tight
          ? 'bg-[color-mix(in_srgb,var(--c-critical)_16%,transparent)] text-[var(--c-critical-ink)]'
          : 'bg-surface/80 text-ink-3',
        className,
      )}
    >
      {hop.clash ? <TriangleAlert size={9} aria-hidden /> : <Footprints size={9} aria-hidden />}
      {minutes && (hop.clash ? '!' : `${Math.max(0, hop.gapMin)}m`)}
      <span className="sr-only">{hopWords(hop)}</span>
    </span>
  )
}
