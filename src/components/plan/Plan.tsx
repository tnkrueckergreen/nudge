import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CalendarPlus, CalendarRange, ChevronLeft, ChevronRight, GraduationCap, Info, Sparkles } from 'lucide-react'
import { useStore } from '../../lib/store'
import type { Derived } from '../../lib/derive'
import { addDays, fmtDay, fmtDayShort, fmtDuration, fmtTime, startOfDay, startOfWeek } from '../../lib/date'
import { autoSchedule } from '../../lib/autoSchedule'
import { washOf } from '../../lib/theme'
import { WeekGrid } from './WeekGrid'
import { BlockSheet } from './BlockSheet'
import { Button, Card, CourseDot, EmptyState, IconButton, cx, useToast } from '../ui'
import { useIsMobile } from '../../lib/hooks'
import type { Surface } from '../../lib/ai/prompt'
import { useAiConfig } from '../../lib/ai/useAI'

export function Plan({
  derived,
  now,
  onStartFocus,
  onAddCourse,
  onEditCourse,
  onAskAi,
  weekOffset,
  setWeekOffset,
  showClasses,
  setShowClasses,
  fillSignal,
  focusBlock,
  onFocusHandled,
}: {
  derived: Derived
  now: number
  onStartFocus: (assignmentId: string | null, courseId: string | null, blockId: string | null) => void
  onAddCourse: () => void
  onEditCourse: (courseId: string) => void
  onAskAi: (intent?: { surface: Surface; request?: string; horizonDays?: number }) => void

  weekOffset: number
  setWeekOffset: (fn: (n: number) => number) => void
  showClasses: boolean
  setShowClasses: (fn: (v: boolean) => boolean) => void

  fillSignal: number

  focusBlock?: { id: string; nonce: number } | null

  onFocusHandled?: () => void
}) {
  const courses = useStore((s) => s.courses)
  const assignments = useStore((s) => s.assignments)
  const blocks = useStore((s) => s.blocks)
  const settings = useStore((s) => s.settings)
  const store = useStore()
  const { toast } = useToast()
  const isMobile = useIsMobile()
  const aiConfig = useAiConfig()

  const [armed, setArmed] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)

  const weekStart = useMemo(() => addDays(startOfWeek(now), weekOffset * 7), [now, weekOffset])
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart])
  const visibleDays = isMobile ? 3 : 7

  const weekBlocks = useMemo(() => {
    const from = +weekStart
    const to = +addDays(weekStart, 7)
    return blocks.filter((b) => {
      const t = +new Date(b.start)
      return t >= from && t < to
    })
  }, [blocks, weekStart])

  const undoable = (label: string) => toast(label, { action: { label: 'Undo', run: () => store.undo() } })

  const handleMove = useCallback(
    (id: string, startMs: number, endMs: number, duplicate: boolean) => {
      if (duplicate) {
        const src = blocks.find((b) => b.id === id)
        if (!src) return
        store.addBlock({
          courseId: src.courseId,
          assignmentId: src.assignmentId,
          title: src.title,
          start: new Date(startMs).toISOString(),
          end: new Date(endMs).toISOString(),
        })
        undoable('Block duplicated')
      } else {
        store.moveBlock(id, startMs, endMs)
      }
    },

    [blocks, store],
  )

  const handleCreate = useCallback(
    (startMs: number, endMs: number) => {

      const armedTask = armed ? assignments.find((a) => a.id === armed) : null
      const fallback = derived.ranked[0]
      const target = armedTask ?? fallback?.assignment ?? null
      store.addBlock({
        assignmentId: target?.id ?? null,
        courseId: target?.courseId ?? null,
        start: new Date(startMs).toISOString(),
        end: new Date(endMs).toISOString(),
      })
      const mins = Math.round((endMs - startMs) / 60000)
      const label = target
        ? `${fmtDuration(mins)} for ${target.title}`
        : `${fmtDuration(mins)} study block`

      toast(label, { action: { label: 'Undo', run: () => store.undo() } })
      setArmed(null)
    },

    [armed, assignments, derived.ranked, store, toast],
  )

  const handleNudge = useCallback(
    (id: string, deltaMin: number, resize: boolean) => {
      const b = blocks.find((x) => x.id === id)
      if (!b) return
      const s = +new Date(b.start)
      const e = +new Date(b.end)
      if (resize) store.moveBlock(id, s, Math.max(s + 15 * 60000, e + deltaMin * 60000))
      else store.moveBlock(id, s + deltaMin * 60000, e + deltaMin * 60000)
    },
    [blocks, store],
  )

  const handleDelete = useCallback(
    (id: string) => {
      store.removeBlock(id)
      setSelected(null)
      undoable('Block deleted')
    },

    [store],
  )

  const fillWeek = () => {

    const from = weekOffset === 0 && +startOfDay(now) > +weekStart ? startOfDay(now) : weekStart
    const daysLeft = Math.max(1, 7 - Math.round((+from - +weekStart) / 86_400_000))
    const proposals = autoSchedule({
      ranked: derived.ranked,
      blocks,
      courses,
      now,
      from,
      days: daysLeft,
      dayStartHour: settings.dayStartHour,
      dayEndHour: settings.dayEndHour,
      dailyCapacityMin: settings.dailyCapacityMin,
    })
    if (!proposals.length) {
      toast(
        derived.ranked.length
          ? 'Your week already has time for every open task.'
          : 'Add a task first, then Nudge can find time for it.',
      )
      return
    }
    store.pushUndo('Filled the week')
    for (const p of proposals) {
      useStore.setState((s) => ({
        blocks: [
          ...s.blocks,
          {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            courseId: p.courseId,
            assignmentId: p.assignmentId,
            start: new Date(p.start).toISOString(),
            end: new Date(p.end).toISOString(),
            done: false,
            createdAt: new Date().toISOString(),
          },
        ],
      }))
    }
    const total = proposals.reduce((s, p) => s + (p.end - p.start) / 60000, 0)
    toast(`Planned ${fmtDuration(total)} across ${proposals.length} block${proposals.length === 1 ? '' : 's'}`, {
      action: { label: 'Undo', run: () => store.undo() },
    })
  }

  useEffect(() => {
    if (!focusBlock) return
    setSelected(focusBlock.id)
    onFocusHandled?.()
  }, [focusBlock, onFocusHandled])

  const lastFill = useRef(fillSignal)
  useEffect(() => {
    if (fillSignal === lastFill.current) return
    lastFill.current = fillSignal
    fillWeek()

  }, [fillSignal])

  const tray = useMemo(() => {
    return derived.ranked.slice(0, 8).map((r) => {
      const planned = blocks
        .filter((b) => b.assignmentId === r.assignment.id && +new Date(b.end) >= now)
        .reduce((s, b) => s + (+new Date(b.end) - +new Date(b.start)) / 60000, 0)
      return { r, planned, gap: Math.max(0, r.remainingMin - planned) }
    })
  }, [derived.ranked, blocks, now])

  const selectedBlock = selected ? blocks.find((b) => b.id === selected) : null
  const weekLabel = `${fmtDayShort(weekStart)} – ${fmtDayShort(addDays(weekStart, 6))}`
  const thisWeek = weekOffset === 0

  const weekMinutes = weekBlocks.reduce((s, b) => s + (+new Date(b.end) - +new Date(b.start)) / 60000, 0)

  if (courses.length === 0 && assignments.length === 0) {
    return (
      <div className="p-4 sm:p-6">
        <Card className="max-w-lg mx-auto">
          <EmptyState
            icon={<CalendarRange size={20} />}
            title="Plan your week"
            body="Add a course and a task, then drag out study blocks or have Nudge draft a plan."
            action={<Button variant="primary" onClick={onAddCourse}>Add your first course</Button>}
          />
        </Card>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full min-h-0">

      <div className="px-3 sm:px-6 pt-3 sm:pt-5 pb-2.5 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-0.5">
          <IconButton label="Previous week" size="sm" onClick={() => setWeekOffset((w) => w - 1)}>
            <ChevronLeft size={17} />
          </IconButton>
          <IconButton label="Next week" size="sm" onClick={() => setWeekOffset((w) => w + 1)}>
            <ChevronRight size={17} />
          </IconButton>
        </div>
        <div className="min-w-0">
          <h1 className="text-[16px] sm:text-[18px] font-semibold leading-tight text-ink truncate">
            {thisWeek ? 'This week' : weekLabel}
          </h1>
          <p className="text-[11.5px] text-ink-3 tnum leading-tight">
            {thisWeek ? weekLabel : ''}
            {weekMinutes > 0 && `${thisWeek ? ' · ' : ''}${fmtDuration(weekMinutes)} planned`}
          </p>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          {!thisWeek && (
            <Button size="sm" onClick={() => setWeekOffset(() => 0)}>
              Today
            </Button>
          )}
          <Button
            size="sm"
            variant={showClasses ? 'quiet' : 'ghost'}
            onClick={() => setShowClasses((v) => !v)}
            aria-pressed={showClasses}
            title={showClasses ? 'Hide class times' : 'Show class times'}
          >
            <GraduationCap size={15} />
            <span className="hidden lg:inline">Classes</span>
          </Button>
          <Button
            size="sm"
            variant={aiConfig.available ? 'secondary' : 'primary'}
            onClick={fillWeek}
            title="Drop study blocks into the free slots, by deadline pressure"
          >
            <CalendarPlus size={14} />
            <span className="hidden sm:inline">Fill gaps</span>
          </Button>
          {aiConfig.available && (
            <Button
              size="sm"
              variant="primary"
              onClick={() => onAskAi({ surface: 'plan_week', horizonDays: 9 })}
              title="Build a plan for this week"
            >
              <Sparkles size={14} />
              <span className="hidden sm:inline">Plan my week</span>
            </Button>
          )}
        </div>
      </div>

      {tray.length > 0 && (
        <div className="px-3 sm:px-6 pb-2.5">
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar -mx-1 px-1 py-0.5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3 shrink-0 pr-0.5">
              Needs time
            </span>
            {tray.map(({ r, gap }) => {
              const active = armed === r.assignment.id
              return (
                <button
                  key={r.assignment.id}
                  type="button"
                  onClick={() => setArmed(active ? null : r.assignment.id)}
                  aria-pressed={active}
                  className={cx(
                    'shrink-0 h-8 pl-2 pr-2.5 rounded-lg border flex items-center gap-1.5 text-[12.5px] font-medium',
                    'transition-all duration-150 active:scale-[.97]',
                    active
                      ? 'border-ink bg-invert-bg text-invert-ink'
                      : 'border-line bg-surface text-ink hover:border-line-2',
                  )}
                  style={active ? undefined : { background: washOf(r.course, 8) }}
                >
                  <CourseDot
                    course={r.course}
                    size={12}
                    style={active ? { color: 'currentColor' } : undefined}
                  />
                  <span className="truncate max-w-[150px]">{r.assignment.title}</span>
                  {gap > 0 && (
                    <span className={cx('tnum', active ? 'opacity-70' : 'text-ink-3')}>{fmtDuration(gap)}</span>
                  )}
                </button>
              )
            })}
          </div>
          {armed && (
            <p className="mt-1.5 text-[12px] text-ink-2 flex items-center gap-1.5 a-rise">
              <Info size={13} className="shrink-0" />
              Drag or tap the calendar to add time for this task.
              <button className="underline underline-offset-2 hover:text-ink" onClick={() => setArmed(null)}>
                cancel
              </button>
            </p>
          )}
        </div>
      )}

      <div className="flex-1 min-h-0 flex px-3 sm:px-6 pb-3 sm:pb-6">
        <WeekGrid
          days={days}
          visibleDays={visibleDays}
          blocks={weekBlocks}
          courses={courses}
          assignments={assignments}
          startHour={settings.dayStartHour}
          endHour={settings.dayEndHour}
          hourPx={isMobile ? 54 : 58}
          now={now}
          showClasses={showClasses}
          selectedId={selected}
          onMoveBlock={handleMove}
          onCreate={handleCreate}
          onSelect={setSelected}
          onSelectCourse={onEditCourse}
          onNudgeBlock={handleNudge}
          onDeleteBlock={handleDelete}
          onToggleDone={(id) => store.toggleBlockDone(id)}
        />
      </div>

      {selectedBlock && (
        <BlockSheet
          block={selectedBlock}
          courses={courses}
          assignments={assignments}
          onClose={() => setSelected(null)}
          onPatch={(patch) => store.updateBlock(selectedBlock.id, patch)}
          onReschedule={(startMs, endMs) => store.moveBlock(selectedBlock.id, startMs, endMs)}
          onDuplicate={() => {
            const copy = store.duplicateBlock(selectedBlock.id)
            if (!copy) return

            setSelected(copy.id)
            toast(`Copied to ${fmtDay(copy.start)}, ${fmtTime(copy.start)}`, {
              action: { label: 'Undo', run: () => store.undo() },
            })
          }}
          onDelete={() => handleDelete(selectedBlock.id)}
          onToggleDone={() => {
            store.toggleBlockDone(selectedBlock.id)
            setSelected(null)
          }}
          onFocus={() => {
            onStartFocus(selectedBlock.assignmentId, selectedBlock.courseId, selectedBlock.id)
            setSelected(null)
          }}
        />
      )}
    </div>
  )
}
