import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, CalendarOff, Check, ClipboardCheck, Clock3, GripHorizontal } from 'lucide-react'
import type { Assignment, Course, PlannerEvent, ScheduleOverride, StudyBlock } from '../../lib/types'
import { atMinutes, clamp, dayKey, fmtDuration, fmtHourLabel, fmtTime, isSameDay, minutesOfDay } from '../../lib/date'
import { blockSpan, layoutSpans } from '../../lib/layout'
import {
  allDayEventsOn,
  classesOn,
  hasMultipleMeetingKinds,
  hopBetween,
  kindOf,
  scheduleOverrideOn,
  type ClassOccurrence,
  type Hop,
} from '../../lib/meetings'
import { stepOf } from '../../lib/steps'
import { edgeOf, solidOf, washOf } from '../../lib/theme'
import { HopTag, KindGlyph } from '../schedule/ClassBits'
import { usePlannerGestures, type Draft } from './usePlannerGestures'
import { cx } from '../ui'

const GUTTER = 52

type GridItem =
  | { kind: 'block'; block: StudyBlock }
  | { kind: 'class'; occ: ClassOccurrence; hop: Hop | null }
  | { kind: 'event'; event: PlannerEvent }

const itemSpan = (it: GridItem) =>
  it.kind === 'block'
    ? blockSpan(it.block)
    : it.kind === 'class'
      ? { startMin: it.occ.meeting.start, endMin: it.occ.meeting.end }
      : blockSpan(it.event)

const ITEM = {
  inset: 2,
  radius: 6,
  padX: 6,
  padY: 2,
} as const

const itemFrame = (leftPct: number, widthPct: number) => ({
  left: `calc(${leftPct}% + ${ITEM.inset}px)`,
  width: `calc(${widthPct}% - ${ITEM.inset * 2}px)`,
  borderRadius: ITEM.radius,
  padding: `${ITEM.padY}px ${ITEM.padX}px`,
})

export interface WeekGridProps {
  days: Date[]
  visibleDays: number
  blocks: StudyBlock[]
  courses: Course[]
  assignments: Assignment[]
  plannerEvents: PlannerEvent[]
  scheduleOverrides: ScheduleOverride[]
  startHour: number
  endHour: number
  hourPx: number
  now: number
  showClasses: boolean
  selectedId: string | null
  onMoveBlock: (id: string, startMs: number, endMs: number, duplicate: boolean) => void
  onCreate: (startMs: number, endMs: number) => void
  onSelect: (id: string | null) => void

  onSelectCourse: (courseId: string) => void
  onSelectPlannerEvent: (eventId: string) => void
  onNudgeBlock: (id: string, deltaMin: number, resize: boolean) => void
  onDeleteBlock: (id: string) => void
  onToggleDone: (id: string) => void
}

export function WeekGrid(props: WeekGridProps) {
  const {
    days,
    visibleDays,
    blocks,
    courses,
    assignments,
    plannerEvents,
    scheduleOverrides,
    startHour,
    endHour,
    hourPx,
    now,
    showClasses,
    selectedId,
    onMoveBlock,
    onCreate,
    onSelect,
    onSelectCourse,
    onSelectPlannerEvent,
    onNudgeBlock,
    onDeleteBlock,
    onToggleDone,
  } = props

  const scrollRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const [colW, setColW] = useState(140)
  const [measured, setMeasured] = useState(false)
  const pxPerMin = hourPx / 60
  const dayMinStart = startHour * 60
  const dayMinEnd = endHour * 60
  const bodyHeight = (dayMinEnd - dayMinStart) * pxPerMin

  const courseById = useMemo(() => new Map(courses.map((c) => [c.id, c])), [courses])
  const assignmentById = useMemo(() => new Map(assignments.map((a) => [a.id, a])), [assignments])

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = () => {
      const w = el.clientWidth - GUTTER
      setColW(Math.max(96, Math.floor((w / visibleDays) * 100) / 100))
      setMeasured(true)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [visibleDays])

  const dayIndexOf = useCallback(
    (iso: string) => days.findIndex((d) => isSameDay(d, new Date(iso))),
    [days],
  )

  const getBlock = useCallback(
    (id: string) => {
      const b = blocks.find((x) => x.id === id)
      if (!b) return null
      const dayIdx = dayIndexOf(b.start)
      if (dayIdx < 0) return null
      const { startMin, endMin } = blockSpan(b)
      return { dayIdx, startMin, endMin }
    },
    [blocks, dayIndexOf],
  )

  const perDay = useMemo(() => {
    return days.map((day) => {
      const k = dayKey(day)
      const items: GridItem[] = blocks
        .filter((b) => dayKey(b.start) === k)
        .map((block) => ({ kind: 'block' as const, block }))

      if (showClasses) {
        const occs = classesOn(courses, day, { plannerEvents, scheduleOverrides })
        occs.forEach((occ, i) => {
          items.push({ kind: 'class', occ, hop: hopBetween(occs[i - 1], occ) })
        })
      }

      plannerEvents
        .filter((event) => !event.allDay && dayKey(event.start) === k)
        .forEach((event) => items.push({ kind: 'event', event }))

      return { day, laid: layoutSpans(items, itemSpan) }
    })
  }, [days, blocks, courses, plannerEvents, scheduleOverrides, showClasses])

  const snapTargets = useCallback(
    (excludeBlockId: string | null) => {
      const out = new Set<number>()
      for (const day of perDay) {
        for (const l of day.laid) {
          if (l.item.kind === 'block' && l.item.block.id === excludeBlockId) continue
          out.add(l.startMin)
          out.add(l.endMin)
        }
      }
      return [...out]
    },
    [perDay],
  )

  const { draft, handlers } = usePlannerGestures({
    gridRef,
    scrollRef,
    dayCount: days.length,
    startHour,
    endHour,
    pxPerMin,
    snapMin: 15,
    minDurationMin: 15,
    getBlock,
    onMove: (id, dayIdx, startMin, endMin, duplicate) => {
      const day = days[dayIdx]
      onMoveBlock(id, +atMinutes(day, startMin), +atMinutes(day, endMin), duplicate)
    },
    onCreate: (dayIdx, startMin, endMin) => {
      const day = days[dayIdx]
      onCreate(+atMinutes(day, startMin), +atMinutes(day, endMin))
    },
    onTapBlock: onSelect,
    snapTargets,
  })

  const didInitialScroll = useRef(false)
  useEffect(() => {
    if (didInitialScroll.current || !scrollRef.current || !measured) return
    didInitialScroll.current = true
    const target = clamp(minutesOfDay(now) - 90, dayMinStart, dayMinEnd - 240)
    scrollRef.current.scrollTop = (target - dayMinStart) * pxPerMin
    const todayIdx = days.findIndex((d) => isSameDay(d, now))
    if (todayIdx > 0 && visibleDays < days.length) {
      scrollRef.current.scrollLeft = Math.max(0, (todayIdx - 0.5) * colW)
    }
  }, [now, dayMinStart, dayMinEnd, pxPerMin, days, visibleDays, colW, measured])

  const hours = useMemo(
    () => Array.from({ length: endHour - startHour + 1 }, (_, i) => startHour + i),
    [startHour, endHour],
  )

  const top = (min: number) => (min - dayMinStart) * pxPerMin
  const height = (a: number, b: number) => Math.max(12, (b - a) * pxPerMin)

  const nowMin = minutesOfDay(now)
  const todayIdx = days.findIndex((d) => isSameDay(d, now))
  const draggedBlock = draft?.blockId ? blocks.find((b) => b.id === draft.blockId) : undefined

  return (
    <div
      ref={scrollRef}
      className="relative flex-1 overflow-auto scroll-slim overscroll-contain bg-surface rounded-card border border-line"
      style={{ scrollbarGutter: 'stable' }}
    >
      <div style={{ width: GUTTER + colW * days.length, minWidth: '100%' }}>

        <div className="sticky top-0 z-30 flex bg-surface/95 backdrop-blur-sm border-b border-line">
          <div
            className="sticky left-0 z-10 bg-surface shrink-0 border-r border-line"
            style={{ width: GUTTER }}
          />
          {days.map((day, i) => {
            const isToday = isSameDay(day, now)
            const allDay = allDayEventsOn(plannerEvents, day)
            const override = scheduleOverrideOn(scheduleOverrides, day)
            const mins = perDay[i].laid.reduce(
              (s, l) => s + (l.item.kind === 'block' ? l.endMin - l.startMin : 0),
              0,
            )
            return (
              <div
                key={+day}
                className={cx(
                  'shrink-0 px-2 py-2 text-center border-r border-line last:border-r-0',
                  isToday && 'bg-tint',
                )}
                style={{ width: colW }}
              >
                <div className="text-[10.5px] uppercase tracking-[0.08em] font-semibold text-ink-3">
                  {day.toLocaleDateString(undefined, { weekday: 'short' })}
                </div>
                <div
                  className={cx(
                    'mx-auto mt-0.5 grid place-items-center h-[26px] w-[26px] rounded-full text-[14px] font-semibold tnum',
                    isToday ? 'bg-invert-bg text-invert-ink' : 'text-ink',
                  )}
                >
                  {day.getDate()}
                </div>
                <div className="mt-0.5 h-[14px] text-[10.5px] text-ink-3 tnum">
                  {mins > 0 ? fmtDuration(mins) : ''}
                </div>
                {override && (
                  <div className="mt-0.5 truncate text-[9.5px] font-medium text-ink-3" title={override.title}>
                    {override.scheduleDay == null
                      ? 'No classes'
                      : `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][override.scheduleDay]} schedule`}
                  </div>
                )}
                {allDay.slice(0, 2).map((event) => (
                  <div
                    key={event.id}
                    className="mt-0.5 truncate rounded-md border border-line bg-surface-2 px-1 py-[1px] text-[9.5px] font-medium text-ink-2"
                    title={event.title}
                  >
                    {event.title}
                  </div>
                ))}
                {allDay.length > 2 && <div className="mt-0.5 text-[9.5px] text-ink-3">+{allDay.length - 2} more</div>}
              </div>
            )
          })}
        </div>

        <div className="flex">
          <div
            className="sticky left-0 z-20 shrink-0 bg-surface border-r border-line"
            style={{ width: GUTTER, height: bodyHeight }}
          >
            {hours.map((h) => (
              <div
                key={h}
                className="absolute right-1.5 -translate-y-1/2 text-[10.5px] font-medium text-ink-3 tnum select-none"
                style={{ top: top(h * 60) }}
              >
                {h > startHour ? fmtHourLabel(h) : ''}
              </div>
            ))}
          </div>

          <div
            ref={gridRef}
            className="relative flex grid-surface"
            style={{ height: bodyHeight }}
            {...handlers}
          >
            {perDay.map(({ day, laid }, dayIdx) => {
              const isToday = isSameDay(day, now)
              const isPast = +day < +new Date(now).setHours(0, 0, 0, 0)
              return (
                <div
                  key={+day}
                  className={cx('relative shrink-0 border-r border-line last:border-r-0', isToday && 'bg-tint/40')}
                  style={{ width: colW }}
                >

                  {hours.map((h) => (
                    <div
                      key={h}
                      className="absolute inset-x-0 border-t border-line pointer-events-none"
                      style={{ top: top(h * 60) }}
                    />
                  ))}
                  {hours.slice(0, -1).map((h) => (
                    <div
                      key={`half-${h}`}
                      className="absolute inset-x-0 border-t border-line/45 pointer-events-none"
                      style={{ top: top(h * 60 + 30) }}
                    />
                  ))}

                  {(isPast || isToday) && (
                    <div
                      className="absolute inset-x-0 top-0 bg-sunken/55 pointer-events-none"
                      style={{
                        height: isPast ? bodyHeight : clamp(top(nowMin), 0, bodyHeight),
                      }}
                    />
                  )}

                  {laid.map(({ item, startMin, endMin, col, cols }, i) => {
                    if (item.kind === 'class') {
                      return (
                        <ClassChip
                          key={`class-${i}`}
                          occ={item.occ}
                          hop={item.hop}
                          top={top(startMin)}
                          height={height(startMin, endMin)}
                          left={(col / cols) * 100}
                          width={(1 / cols) * 100}
                          colW={colW}
                          onOpen={() => onSelectCourse(item.occ.course.id)}
                        />
                      )
                    }

                    if (item.kind === 'event') {
                      return (
                        <PlannerEventChip
                          key={item.event.id}
                          event={item.event}
                          top={top(startMin)}
                          height={height(startMin, endMin)}
                          left={(col / cols) * 100}
                          width={(1 / cols) * 100}
                          onOpen={() => onSelectPlannerEvent(item.event.id)}
                        />
                      )
                    }

                    const block = item.block

                    if (draft?.active && draft.blockId === block.id && !draft.duplicate) return null
                    return (
                      <BlockChip
                        key={block.id}
                        block={block}
                        course={block.courseId ? courseById.get(block.courseId) : undefined}
                        assignment={block.assignmentId ? assignmentById.get(block.assignmentId) : undefined}
                        top={top(startMin)}
                        height={height(startMin, endMin)}
                        left={(col / cols) * 100}
                        width={(1 / cols) * 100}
                        dragging={false}
                        selected={selectedId === block.id}
                        past={+new Date(block.end) < now}
                        onKeyCommand={(cmd, shift) => {
                          if (cmd === 'delete') onDeleteBlock(block.id)
                          else if (cmd === 'done') onToggleDone(block.id)
                          else if (cmd === 'open') onSelect(block.id)
                          else onNudgeBlock(block.id, cmd === 'up' ? -15 : 15, shift)
                        }}
                      />
                    )
                  })}

                  {draft?.active && draft.origin && draft.origin.dayIdx === dayIdx && draft.mode === 'move' && (
                    <div
                      className="absolute rounded-lg border-2 border-dashed border-line-2 pointer-events-none"
                      style={{
                        top: top(draft.origin.startMin),
                        height: height(draft.origin.startMin, draft.origin.endMin),
                        left: 2,
                        right: 3,
                      }}
                    />
                  )}

                  {draft?.active && draft.mode === 'create' && draft.dayIdx === dayIdx && (
                    <div
                      className="absolute rounded-lg border border-ink/25 bg-tint-2 px-2 py-1 pointer-events-none flex flex-col justify-center"
                      style={{
                        top: top(draft.startMin),
                        height: height(draft.startMin, draft.endMin),
                        left: 2,
                        right: 3,
                      }}
                    >
                      <div className="text-[11px] font-semibold text-ink tnum leading-tight">
                        {fmtTime(atMinutes(day, draft.startMin))}
                      </div>
                      <div className="text-[10.5px] text-ink-2 tnum leading-tight">
                        {fmtDuration(draft.endMin - draft.startMin)}
                      </div>
                    </div>
                  )}

                  {isToday && nowMin >= dayMinStart && nowMin <= dayMinEnd && (
                    <div
                      className="absolute inset-x-0 z-20 pointer-events-none"
                      style={{ top: top(nowMin) }}
                      aria-hidden
                    >
                      <div className="relative h-0 border-t-2" style={{ borderColor: 'var(--c-critical)' }}>
                        <span
                          className="absolute -left-[3px] -top-[4px] h-[7px] w-[7px] rounded-full"
                          style={{ background: 'var(--c-critical)' }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )
            })}

            {draft?.active && draft.magnetAt != null && (
              <div
                className="absolute inset-x-0 z-30 pointer-events-none border-t border-dashed border-ink/40"
                style={{ top: top(draft.magnetAt) }}
                aria-hidden
              />
            )}

            {draft?.active && draft.blockId && draggedBlock && (
              <div
                className="absolute z-40 pointer-events-none"
                style={{ left: draft.dayIdx * colW, width: colW, top: 0, bottom: 0 }}
              >
                <BlockChip
                  block={draggedBlock}
                  course={draggedBlock.courseId ? courseById.get(draggedBlock.courseId) : undefined}
                  assignment={
                    draggedBlock.assignmentId ? assignmentById.get(draggedBlock.assignmentId) : undefined
                  }
                  top={top(draft.startMin)}
                  height={height(draft.startMin, draft.endMin)}
                  left={0}
                  width={100}
                  dragging
                  selected={false}
                  past={false}
                  onKeyCommand={() => {}}
                />
              </div>
            )}

            {draft?.active && draft.mode !== 'create' && (
              <div
                className="absolute z-40 pointer-events-none px-2 py-1 rounded-lg bg-invert-bg text-invert-ink text-[11px] font-semibold tnum shadow-pop whitespace-nowrap"
                style={{
                  left: clamp(draft.dayIdx * colW + colW / 2, 84, colW * days.length - 84),
                  transform: 'translateX(-50%)',
                  top: Math.max(2, top(draft.startMin) - 26),
                }}
              >
                {fmtTime(atMinutes(days[draft.dayIdx], draft.startMin))} –{' '}
                {fmtTime(atMinutes(days[draft.dayIdx], draft.endMin))}
                <span className="opacity-60"> · {fmtDuration(draft.endMin - draft.startMin)}</span>
                {draft.duplicate && <span className="opacity-60"> · copy</span>}
              </div>
            )}
          </div>
        </div>
      </div>

      {todayIdx < 0 && <span className="sr-only">This week does not include today.</span>}
    </div>
  )
}

function ClassChip({
  occ,
  hop,
  top,
  height,
  left,
  width,
  colW,
  onOpen,
}: {
  occ: ClassOccurrence
  hop: Hop | null
  top: number
  height: number
  left: number
  width: number

  colW: number
  onOpen: () => void
}) {
  const { course: c, meeting: m, place } = occ
  const spec = kindOf(m.kind)
  const hasMultipleKinds = hasMultipleMeetingKinds(c)

  const dense = colW < 118
  const roomy = colW >= 148

  const showWhere = height >= 34
  const showRoom = !dense && height >= 46 && !!place?.room
  const where = place ? `${place.building}${showRoom ? ` ${place.room}` : ''}` : ''

  const showGlyph = hasMultipleKinds && (!dense || !showWhere)

  return (
    <button
      type="button"

      data-class-id={c.id}
      onClick={onOpen}
      aria-label={`${c.code}${hasMultipleKinds ? ` ${spec.label}` : ''}${place ? `, ${place.raw}` : ''}${
        hop ? `, ${hop.gapMin} minutes from ${hop.from.building}` : ''
      }: edit class times`}
      title={`${c.code}${hasMultipleKinds ? ` · ${spec.label}` : ''}${place ? ` · ${place.raw}` : ''}${
        hop ? `\n${hop.clash ? 'Clashes with' : `${hop.gapMin} min from`} ${hop.from.building}` : ''
      }`}
      className="absolute overflow-hidden text-left select-none cursor-pointer hover:brightness-[0.98] transition-[filter]"
      style={{
        ...itemFrame(left, width),
        top,
        height,

        backgroundColor: solidOf(c, 9),
        backgroundImage: `repeating-linear-gradient(-45deg, ${washOf(c, 16)} 0 4px, transparent 4px 9px)`,
        boxShadow: `inset 0 0 0 1px ${edgeOf(c, 26)}`,
      }}
    >
      <div className="flex items-center gap-1 min-w-0">
        {showGlyph && <KindGlyph kind={m.kind} size={11} className="text-ink-2 opacity-80" />}
        <span className="text-[10.5px] font-semibold text-ink-2 leading-tight truncate min-w-0">{c.code}</span>

        {hop && height >= 24 && <HopTag hop={hop} minutes={roomy} className="ml-auto" />}
      </div>
      {showWhere && (hasMultipleKinds || where) && (
        <div className="text-[10px] text-ink-3 leading-tight truncate">
          {hasMultipleKinds ? (
            <>
              <span className="font-medium">{spec.short}</span>
              {place ? ` · ${where}` : ''}
            </>
          ) : (
            where
          )}
        </div>
      )}
    </button>
  )
}

function PlannerEventChip({
  event,
  top,
  height,
  left,
  width,
  onOpen,
}: {
  event: PlannerEvent
  top: number
  height: number
  left: number
  width: number
  onOpen: () => void
}) {
  const isClass = event.kind === 'custom_class'
  const isExam = event.kind === 'exam'
  const Icon = isClass ? BookOpen : isExam ? ClipboardCheck : event.kind === 'blocked_time' ? Clock3 : CalendarOff
  const kind = isClass ? 'Class' : isExam ? 'Exam' : 'Blocked time'
  const compact = height < 38

  return (
    <button
      type="button"
      data-planner-event-id={event.id}
      onClick={onOpen}
      aria-label={`${kind}: ${event.title}, ${fmtTime(event.start)} to ${fmtTime(event.end)}. Edit planner item`}
      title={`${kind} · ${event.title}${event.room ? ` · ${event.room}` : ''}`}
      className={cx(
        'absolute overflow-hidden text-left border border-dashed border-ink/30 bg-surface-2 text-ink',
        'hover:bg-tint hover:border-ink/45 transition-colors',
      )}
      style={{ ...itemFrame(left, width), top, height }}
    >
      <div className="flex h-full flex-col justify-start">
        <div className="flex items-start gap-1 min-w-0">
          <Icon size={12} className="mt-[1px] shrink-0 text-ink-2" />
          <span className={cx('text-[11px] font-semibold leading-[1.25] min-w-0', compact ? 'truncate' : 'line-clamp-2')}>
            {event.title}
          </span>
        </div>
        {!compact && (
          <span className="mt-auto text-[10px] text-ink-3 leading-tight truncate">
            {kind} · {fmtTime(event.start, { compact: true })}
            {event.room ? ` · ${event.room}` : ''}
          </span>
        )}
      </div>
    </button>
  )
}

interface ChipProps {
  block: StudyBlock
  course?: Course
  assignment?: Assignment
  top: number
  height: number
  left: number
  width: number
  dragging: boolean
  selected: boolean
  past: boolean
  onKeyCommand: (cmd: 'up' | 'down' | 'delete' | 'done' | 'open', shift: boolean) => void
}

function BlockChip({
  block,
  course,
  assignment,
  top,
  height,
  left,
  width,
  dragging,
  selected,
  past,
  onKeyCommand,
}: ChipProps) {
  const step = stepOf(block, assignment)
  const title = block.title || step?.title || assignment?.title || course?.code || 'Study'
  const compact = height < 42
  const tiny = height < 28
  const done = !!block.done

  const handleH = Math.max(3, Math.min(11, Math.floor(height / 4)))

  return (
    <div
      data-block-id={block.id}
      role="button"
      tabIndex={0}
      title={step && assignment ? `${assignment.title} · ${step.title}` : undefined}
      aria-label={`${title}${step && assignment ? `, step of ${assignment.title}` : ''}, ${fmtTime(
        block.start,
      )} to ${fmtTime(block.end)}${done ? ', done' : ''}`}
      onKeyDown={(e) => {
        const k = e.key
        if (k === 'ArrowUp' || k === 'ArrowDown') {
          e.preventDefault()
          onKeyCommand(k === 'ArrowUp' ? 'up' : 'down', e.shiftKey)
        } else if (k === 'Delete' || k === 'Backspace') {
          e.preventDefault()
          onKeyCommand('delete', false)
        } else if (k === 'Enter') {
          e.preventDefault()
          onKeyCommand('open', false)
        } else if (k === ' ') {
          e.preventDefault()
          onKeyCommand('done', false)
        }
      }}
      className={cx(
        'block-grab absolute overflow-hidden group select-none',
        'transition-[box-shadow,opacity,transform] duration-150 ease-[var(--ease-out-soft)]',
        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink',
        dragging ? 'z-40 shadow-pop cursor-grabbing' : 'cursor-grab hover:shadow-card',
        selected && !dragging && 'ring-2 ring-ink ring-offset-1 ring-offset-surface z-20',
        done && 'opacity-60',
        past && !done && 'opacity-75',
      )}
      style={{
        ...itemFrame(left, width),
        top,
        height,

        background: solidOf(course, dragging ? 24 : 15),
        boxShadow: `inset 0 0 0 1px ${edgeOf(course, dragging ? 46 : 34)}`,
      }}
    >

      <div
        data-handle="start"
        style={{ height: handleH }}
        className="absolute inset-x-0 top-0 cursor-ns-resize z-10 flex items-start justify-center"
      >
        <span className="mt-[1px] h-[3px] w-6 rounded-full bg-ink/25 opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>

      <div className="h-full flex flex-col justify-start pointer-events-none">
        <div className="flex items-start gap-1 min-w-0">
          {done && <Check size={11} className="shrink-0 mt-[2px] text-ink-2" />}
          <span
            className={cx(
              'text-[11.5px] font-semibold leading-[1.25] text-ink min-w-0',
              tiny ? 'truncate' : 'line-clamp-2',
              done && 'line-through decoration-1',
            )}
          >
            {title}
          </span>
        </div>
        {!compact && !dragging && (
          <span className="text-[10.5px] text-ink-2 tnum leading-tight mt-auto mb-0.5 truncate">
            {fmtTime(block.start, { compact: true })}–{fmtTime(block.end, { compact: true })}
            {course && assignment ? ` · ${course.code}` : step && assignment ? ` · ${assignment.title}` : ''}
          </span>
        )}
      </div>

      <div
        data-handle="end"
        style={{ height: handleH }}
        className="absolute inset-x-0 bottom-0 cursor-ns-resize z-10 flex items-end justify-center"
      >
        <GripHorizontal
          size={12}
          className="mb-[-1px] text-ink/35 opacity-0 group-hover:opacity-100 transition-opacity"
        />
      </div>
    </div>
  )
}

export type { Draft }
