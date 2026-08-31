import { useId, useMemo, useState } from 'react'
import { CalendarPlus, Copy, MapPin, X } from 'lucide-react'
import type { Meeting, MeetingKind } from '../../lib/types'
import { uid } from '../../lib/id'
import {
  KIND,
  MEETING_KINDS,
  dayLetter,
  dayShort,
  groupMeetings,
  hopBetween,
  parsePlace,
} from '../../lib/meetings'
import { fmtDuration } from '../../lib/date'
import { Button, Input, cx } from '../ui'

interface Row {
  key: string
  days: number[]
  start: number
  end: number
  kind: MeetingKind
  room: string
  startsOn: string
  endsOn: string

  ids: Record<number, string>
}

const toTimeInput = (min: number) =>
  `${`${Math.floor(min / 60)}`.padStart(2, '0')}:${`${min % 60}`.padStart(2, '0')}`
const fromTimeInput = (v: string) => {
  const [h, m] = v.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

const rangesOverlap = (a: Pick<Row, 'startsOn' | 'endsOn'>, b: Pick<Row, 'startsOn' | 'endsOn'>) =>
  (!a.endsOn || !b.startsOn || a.endsOn >= b.startsOn) && (!b.endsOn || !a.startsOn || b.endsOn >= a.startsOn)

const rowsFrom = (meetings: Meeting[]): Row[] =>
  groupMeetings(meetings).map((g) => ({
    key: g.members[0]?.id ?? uid(),
    days: g.days,
    start: g.start,
    end: g.end,
    kind: g.kind,
    room: g.room ?? '',
    startsOn: g.startsOn ?? '',
    endsOn: g.endsOn ?? '',
    ids: Object.fromEntries(g.members.map((m) => [m.day, m.id])),
  }))

const toMeetings = (rows: Row[]): Meeting[] =>
  rows.flatMap((r) =>
    r.days.map((d) => ({
      id: r.ids[d] ?? uid(),
      day: d,
      start: r.start,
      end: Math.max(r.end, r.start + 15),
      kind: r.kind,
      room: r.room.trim() || undefined,
      startsOn: r.startsOn || undefined,
      endsOn: r.endsOn || undefined,
    })),
  )

export function ClassTimesEditor({
  meetings,
  onChange,
  buildings,
  defaultRoom,
}: {
  meetings: Meeting[]
  onChange: (next: Meeting[]) => void

  buildings: string[]

  defaultRoom?: string
}) {

  const [rows, setRows] = useState<Row[]>(() => rowsFrom(meetings))
  const listId = `buildings-${useId()}`

  const commit = (next: Row[]) => {
    setRows(next)
    onChange(toMeetings(next))
  }

  const patch = (key: string, p: Partial<Row>) =>
    commit(rows.map((r) => (r.key === key ? { ...r, ...p } : r)))

  const toggleDay = (row: Row, day: number) => {
    const days = row.days.includes(day) ? row.days.filter((d) => d !== day) : [...row.days, day]
    patch(row.key, { days: days.sort((a, b) => a - b), ids: { ...row.ids, [day]: row.ids[day] ?? uid() } })
  }

  const add = () => {
    const last = rows[rows.length - 1]

    const nextWeekday = (d: number) => (d >= 5 || d === 0 ? 1 : d + 1)
    commit([
      ...rows,
      {
        key: uid(),

        days: [last ? nextWeekday(last.days[last.days.length - 1] ?? 1) : 1],
        start: last?.start ?? 10 * 60 + 5,
        end: last?.end ?? 11 * 60 + 25,
        kind: last ? (last.kind === 'lecture' ? 'tutorial' : 'lecture') : 'lecture',
        room: last?.room ?? '',
        startsOn: '',
        endsOn: '',
        ids: {},
      },
    ])
  }

  const duplicate = (row: Row) =>
    commit([...rows, { ...row, key: uid(), ids: {}, days: [...row.days] }])

  const crossings = useMemo(() => {
    const out: { day: number; text: string; tight: boolean }[] = []
    for (let day = 0; day < 7; day++) {
      const onDay = rows
        .filter((r) => r.days.includes(day))
        .map((r) => ({
          start: r.start * 60_000,
          end: r.end * 60_000,
          place: parsePlace(r.room || defaultRoom),
          row: r,
        }))
        .sort((a, b) => a.start - b.start)
      for (let i = 1; i < onDay.length; i++) {
        if (!rangesOverlap(onDay[i - 1].row, onDay[i].row)) continue
        const hop = hopBetween(onDay[i - 1], onDay[i])
        if (!hop || (!hop.tight && !hop.clash)) continue
        out.push({
          day,
          tight: true,
          text: hop.clash
            ? `${dayShort(day)}: ${hop.from.building} and ${hop.to.building} overlap`
            : `${dayShort(day)}: ${hop.gapMin} min from ${hop.from.building} to ${hop.to.building}`,
        })
      }
    }
    return out
  }, [rows, defaultRoom])

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="text-[13px] font-semibold text-ink">Class times</h3>
        <span className="text-[11.5px] text-ink-3">Weekly by default</span>
      </div>
      <p className="mb-2.5 rounded-xl border border-line bg-surface-2 px-3 py-2 text-[12px] leading-relaxed text-ink-2">
        Need a change later? Duplicate a row, choose its new class type or room, and set the dates it applies.
        Leave both dates blank for the regular semester schedule.
      </p>

      {rows.length === 0 ? (
        <button
          type="button"
          onClick={add}
          className="w-full rounded-card border border-dashed border-line-2 bg-surface-2 px-4 py-5 text-center hover:border-ink/30 hover:bg-tint transition-colors group"
        >
          <CalendarPlus size={18} className="mx-auto text-ink-3 group-hover:text-ink-2 transition-colors" />
          <p className="mt-1.5 text-[13px] font-medium text-ink">Add when this course meets</p>
          <p className="mt-0.5 text-[12px] text-ink-3 leading-snug">
            Add lectures, tutorials, conferences, and labs. Each can have its own room.
          </p>
        </button>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((row) => (
            <RowCard
              key={row.key}
              row={row}
              listId={listId}
              defaultRoom={defaultRoom}
              onToggleDay={(d) => toggleDay(row, d)}
              onPatch={(p) => patch(row.key, p)}
              onDuplicate={() => duplicate(row)}
              onRemove={() => commit(rows.filter((r) => r.key !== row.key))}
            />
          ))}
        </div>
      )}

      <datalist id={listId}>
        {buildings.map((b) => (
          <option key={b} value={b} />
        ))}
      </datalist>

      {crossings.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1">
          {crossings.map((c, i) => (
            <li key={i} className="flex items-start gap-1.5 text-[11.5px] leading-snug text-[var(--c-warn)]">
              <MapPin size={12} className="shrink-0 mt-[1px]" aria-hidden />
              <span>{c.text}. Nudge will keep that clear.</span>
            </li>
          ))}
        </ul>
      )}

      {rows.length > 0 && (
        <Button size="sm" variant="quiet" className="mt-2" onClick={add}>
          <CalendarPlus size={14} />
          Add another
        </Button>
      )}
    </div>
  )
}

function RowCard({
  row,
  listId,
  defaultRoom,
  onToggleDay,
  onPatch,
  onDuplicate,
  onRemove,
}: {
  row: Row
  listId: string
  defaultRoom?: string
  onToggleDay: (day: number) => void
  onPatch: (p: Partial<Row>) => void
  onDuplicate: () => void
  onRemove: () => void
}) {
  const mins = Math.max(15, row.end - row.start)

  return (
    <div className="rounded-card border border-line bg-surface-2 p-2.5">

      <div className="flex items-center gap-2">
        <div role="group" aria-label="Days this class meets" className="flex items-center gap-[3px]">
          {[1, 2, 3, 4, 5, 6, 0].map((d) => {
            const on = row.days.includes(d)
            return (
              <button
                key={d}
                type="button"
                onClick={() => onToggleDay(d)}
                aria-pressed={on}
                aria-label={dayShort(d)}
                title={dayShort(d)}
                className={cx(
                  'h-7 w-7 rounded-[9px] text-[11.5px] font-semibold transition-all duration-150 active:scale-90',
                  on
                    ? 'bg-invert-bg text-invert-ink'
                    : 'bg-surface border border-line text-ink-3 hover:border-line-2 hover:text-ink-2',
                )}
              >
                {dayLetter(d)}
              </button>
            )
          })}
        </div>
        <div className="ml-auto flex items-center gap-0.5">
          <button
            type="button"
            aria-label="Duplicate this class time as a date variant"
            title="Duplicate as date variant"
            onClick={onDuplicate}
            className="h-7 w-7 grid place-items-center rounded-lg text-ink-3 hover:text-ink hover:bg-tint transition-colors"
          >
            <Copy size={13} />
          </button>
          <button
            type="button"
            aria-label="Remove this class time"
            onClick={onRemove}
            className="h-7 w-7 grid place-items-center rounded-lg text-ink-3 hover:text-ink hover:bg-tint transition-colors"
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {row.days.length === 0 && (
        <p className="mt-1.5 text-[11.5px] text-[var(--c-warn)]">Pick at least one day, or this one is dropped.</p>
      )}

      <div className="mt-2 flex items-center gap-1.5">
        <Input
          type="time"
          aria-label="Start time"
          value={toTimeInput(row.start)}
          onChange={(e) => {
            const start = fromTimeInput(e.target.value)
            onPatch({ start, end: Math.max(row.end, start + 15) })
          }}

          className="h-9 flex-1 min-w-0 px-2 text-[13px]"
        />
        <span className="text-ink-3 text-[13px] shrink-0">–</span>
        <Input
          type="time"
          aria-label="End time"
          value={toTimeInput(row.end)}
          onChange={(e) => onPatch({ end: Math.max(fromTimeInput(e.target.value), row.start + 15) })}
          className="h-9 flex-1 min-w-0 px-2 text-[13px]"
        />
        <span className="shrink-0 w-[50px] text-right text-[11.5px] tnum text-ink-3">{fmtDuration(mins)}</span>
      </div>

      <div className="mt-2">
        <p className="mb-1 text-[11.5px] font-medium text-ink-2">Applies during <span className="font-normal text-ink-3">(optional)</span></p>
        <div className="grid grid-cols-2 gap-1.5">
          <label className="min-w-0">
            <span className="mb-1 block text-[10.5px] text-ink-3">Starts on</span>
            <Input
              type="date"
              aria-label="Date this class variant starts"
              value={row.startsOn}
              onChange={(e) => {
                const startsOn = e.target.value
                onPatch({ startsOn, ...(row.endsOn && startsOn > row.endsOn ? { endsOn: startsOn } : {}) })
              }}
              className="h-9 min-w-0 px-2 text-[12px]"
            />
          </label>
          <label className="min-w-0">
            <span className="mb-1 block text-[10.5px] text-ink-3">Ends on</span>
            <Input
              type="date"
              aria-label="Date this class variant ends"
              value={row.endsOn}
              min={row.startsOn || undefined}
              onChange={(e) => {
                const endsOn = e.target.value
                onPatch({ endsOn, ...(row.startsOn && endsOn < row.startsOn ? { startsOn: endsOn } : {}) })
              }}
              className="h-9 min-w-0 px-2 text-[12px]"
            />
          </label>
        </div>
        {(row.startsOn || row.endsOn) && (
          <p className="mt-1 text-[10.5px] leading-snug text-ink-3">
            {row.startsOn && row.endsOn
              ? 'This row is used between these dates, inclusive.'
              : row.startsOn
                ? 'This row starts on this date and continues onward.'
                : 'This row is used through this date.'}
          </p>
        )}
      </div>

      <div
        role="radiogroup"
        aria-label="Kind of class"
        className="mt-2 grid grid-cols-4 gap-[3px] bg-sunken border border-line rounded-[11px] p-[3px]"
      >
        {MEETING_KINDS.map((k) => {
          const spec = KIND[k]
          const Icon = spec.icon
          const active = row.kind === k
          return (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={active}

              aria-label={spec.label}
              title={spec.blurb}
              onClick={() => onPatch({ kind: k })}
              className={cx(
                'h-[30px] rounded-[8px] flex items-center justify-center gap-1.5 transition-all duration-150',
                'text-[12px] font-medium min-w-0',
                active ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(0,0,0,.08)]' : 'text-ink-3 hover:text-ink-2',
              )}
            >
              <Icon size={13} strokeWidth={active ? 2.2 : 2} className="shrink-0" aria-hidden />

              <span className="sm:hidden" aria-hidden>
                {spec.short}
              </span>
              <span className="hidden sm:inline truncate" aria-hidden>
                {spec.label}
              </span>
            </button>
          )
        })}
      </div>

      <div className="mt-2 relative">
        <MapPin size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none" />
        <Input
          aria-label={`Room for the ${KIND[row.kind].label.toLowerCase()}`}
          list={listId}
          value={row.room}
          onChange={(e) => onPatch({ room: e.target.value })}
          placeholder={defaultRoom ? `${defaultRoom} (course default)` : 'Leacock 132'}
          className="h-9 text-[13px] pl-8"
          spellCheck={false}
        />
      </div>
    </div>
  )
}
