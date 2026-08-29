import { Fragment, useMemo, type CSSProperties } from 'react'
import { BookOpen, CalendarOff, CalendarPlus, Check, ClipboardCheck, Clock3, Play } from 'lucide-react'
import type { Assignment, Course, PlannerEvent, ScheduleOverride, StudyBlock } from '../../lib/types'
import { dayAgenda, hasMultipleMeetingKinds, kindOf, nextClass, type AgendaEntry } from '../../lib/meetings'
import { fmtDay, fmtDuration, fmtTime, fmtTimeRange } from '../../lib/date'
import { Button, CourseDot, Panel, SectionTitle, cardClick, cx } from '../ui'
import { HopRow, PlaceLine } from './ClassBits'
import { SegmentBar } from './SessionPlan'

export function DaySchedule({
  courses,
  blocks,
  assignments,
  plannerEvents,
  scheduleOverrides,
  now,
  onGoPlan,
  onStartFocus,
  onOpenCourse,
  onOpenTask,
  onToggleDone,
  className,
  style,
}: {
  courses: Course[]
  blocks: StudyBlock[]
  assignments: Assignment[]
  plannerEvents: PlannerEvent[]
  scheduleOverrides: ScheduleOverride[]
  now: number
  onGoPlan: () => void
  onStartFocus: (assignmentId: string | null, courseId: string | null, blockId: string) => void
  onOpenCourse: (courseId: string) => void
  onOpenTask: (assignmentId: string) => void
  onToggleDone: (blockId: string) => void
  className?: string
  style?: CSSProperties
}) {
  const agenda = useMemo(
    () => dayAgenda(courses, blocks, now, assignments, { plannerEvents, scheduleOverrides }),
    [courses, blocks, assignments, plannerEvents, scheduleOverrides, now],
  )
  const nextId = agenda.find((e) => e.start > now)?.id

  const startableId = agenda.find(
    (e) => e.block && !e.block.done && e.end > now && e.start - now < 30 * 60_000,
  )?.id

  const upcoming = useMemo(
    () => (agenda.length ? null : nextClass(courses, now, 7, { plannerEvents, scheduleOverrides })),
    [agenda.length, courses, plannerEvents, scheduleOverrides, now],
  )
  const classCount = agenda.filter((e) => e.cls).length
  const blockedMin = agenda
    .filter((e) => e.block)
    .reduce((s, e) => s + (e.end - e.start) / 60_000, 0)

  return (
    <Panel as="section" className={cx('px-2 py-2.5', className)} style={style}>
      <SectionTitle
        className="px-1.5"
        right={
          <button
            onClick={onGoPlan}
            className="text-[11.5px] font-medium text-ink-2 hover:text-ink inline-flex items-center gap-1"
          >
            <CalendarPlus size={12} /> Plan
          </button>
        }
      >
        Today's schedule
      </SectionTitle>
      <div>
        {agenda.length === 0 ? (
          <div className="px-2 py-2 text-center">
            <p className="text-[13px] text-ink-2 leading-relaxed">
              {courses.length === 0
                ? 'No classes and nothing blocked out.'
                : 'No classes today, and nothing blocked out.'}
            </p>
            {upcoming && (
              <p className="mt-1 text-[11.5px] text-ink-3 leading-relaxed">
                Next is {upcoming.course.code}{hasMultipleMeetingKinds(upcoming.course) ? ` ${kindOf(upcoming.meeting.kind).label.toLowerCase()}` : ''},{' '}
                {fmtDay(upcoming.start)} at {fmtTime(upcoming.start, { compact: true })}
                {upcoming.place ? ` · ${upcoming.place.raw}` : ''}.
              </p>
            )}
            <Button size="sm" className="mt-3" onClick={onGoPlan}>
              <CalendarPlus size={14} />
              Block out time
            </Button>
          </div>
        ) : (
          <>
            <ul className="flex flex-col gap-0.5">
              {agenda.map((entry) => (
                <Fragment key={entry.id}>
                  {entry.hop && <HopRow hop={entry.hop} />}
                  <Row
                    entry={entry}
                    now={now}
                    isNext={entry.id === nextId}
                    startable={entry.id === startableId}
                    onStartFocus={onStartFocus}
                    onOpenCourse={onOpenCourse}
                    onOpenTask={onOpenTask}
                    onToggleDone={onToggleDone}
                  />
                </Fragment>
              ))}
            </ul>

            <p className="mt-2 px-1.5 text-[11.5px] text-ink-3 tnum">
              {classCount > 0 && `${classCount} class${classCount === 1 ? '' : 'es'}`}
              {classCount > 0 && blockedMin > 0 && ' · '}
              {blockedMin > 0 && `${fmtDuration(blockedMin)} blocked out`}
            </p>
          </>
        )}
      </div>
    </Panel>
  )
}

function Row({
  entry,
  now,
  isNext,
  startable,
  onStartFocus,
  onOpenCourse,
  onOpenTask,
  onToggleDone,
}: {
  entry: AgendaEntry
  now: number
  isNext: boolean

  startable?: boolean
  onStartFocus: (assignmentId: string | null, courseId: string | null, blockId: string) => void
  onOpenCourse: (courseId: string) => void
  onOpenTask: (assignmentId: string) => void
  onToggleDone: (blockId: string) => void
  className?: string
  style?: CSSProperties
}) {
  const live = entry.start <= now && entry.end >= now
  const past = entry.end < now
  const cls = entry.cls
  const course = cls?.course

  const wrap = cx(
    'flex items-start gap-2.5 px-1.5 py-2 rounded-xl transition-colors',
    live && 'bg-tint',
  )
  const timeLine = fmtTimeRange(entry.start, entry.end)

  if (cls && course) {
    const spec = kindOf(cls.meeting.kind)
    const multiKind = hasMultipleMeetingKinds(course)
    return (
      <li className={cx(wrap, 'cursor-pointer')} title={timeLine} onClick={cardClick(() => onOpenCourse(course.id))}>
        <TimeCell at={entry.start} muted={past} />
        <span className="w-[18px] shrink-0 grid place-items-center h-[17px]">
          <CourseDot course={course} />
        </span>
        <button
          type="button"
          onClick={() => onOpenCourse(course.id)}
          className="min-w-0 flex-1 text-left"
          aria-label={`${course.code}${multiKind ? ` ${spec.label}` : ''}, ${timeLine}${cls.place ? `, ${cls.place.raw}` : ''}`}
        >
          <p className="flex items-baseline gap-1.5 min-w-0">
            <span
              className={cx(
                'text-[13px] font-medium leading-[17px] truncate',
                past ? 'text-ink-3' : 'text-ink',
              )}
            >
              {course.code}
            </span>
            {multiKind && <span className="ui-eyebrow shrink-0">{spec.short}</span>}
          </p>
          {cls.place && <PlaceLine place={cls.place} className="mt-0.5 min-w-0" />}
        </button>
        {live ? <NowTag /> : isNext ? <NextTag /> : null}
      </li>
    )
  }

  if (entry.event) {
    return <EventRow entry={entry} now={now} />
  }

  const b = entry.block
  if (!b) return null
  const mins = Math.round((entry.end - entry.start) / 60_000)
  const due = !!startable && !b.done
  const openBlock = b.assignmentId
    ? () => onOpenTask(b.assignmentId as string)
    : b.courseId
      ? () => onOpenCourse(b.courseId as string)
      : null
  return (
    <li
      className={cx(wrap, openBlock && 'cursor-pointer')}
      title={timeLine}
      onClick={openBlock ? cardClick(openBlock) : undefined}
    >
      <TimeCell at={entry.start} muted={past || b.done} />
      <button
        type="button"
        onClick={() => onToggleDone(b.id)}
        aria-label={b.done ? 'Mark not done' : 'Mark done'}
        className={cx(
          'shrink-0 h-[17px] w-[18px] grid place-items-center transition-transform hover:scale-110 active:scale-95',
        )}
      >
        <span
          className={cx(
            'h-[16px] w-[16px] rounded-full border-[1.5px] grid place-items-center',
            b.done
              ? 'bg-invert-bg border-invert-bg text-invert-ink'
              : 'border-line-2 text-transparent hover:border-ink',
          )}
        >
          <Check size={10} strokeWidth={3} />
        </span>
      </button>
      <div className="min-w-0 flex-1">
        <p
          className={cx(
            'text-[13px] font-medium leading-[17px] truncate',
            b.done ? 'text-ink-3 line-through' : past ? 'text-ink-3' : 'text-ink',
          )}
        >
          {entry.title}
        </p>
        <p className="flex items-center gap-1.5 text-[11.5px] text-ink-3 tnum leading-tight mt-0.5">

          <span>
            <span className="sr-only">{timeLine} · </span>
            {fmtDuration(mins)}
          </span>
          {live && !b.done && <NowTag />}
          {!live && isNext && !b.done && <NextTag />}
        </p>

        {!b.done && !past && b.plan && b.plan.length > 1 && (
          <SegmentBar segments={b.plan} height={3} className="mt-1.5 max-w-[150px]" />
        )}
      </div>
      {!b.done &&
        (due ? (
          <Button
            size="xs"
            variant={live ? 'primary' : 'secondary'}
            onClick={() => onStartFocus(b.assignmentId, b.courseId, b.id)}
            className="shrink-0"
          >
            <Play size={12} />
            Start
          </Button>
        ) : (
          <button
            type="button"
            aria-label="Start this block"
            onClick={() => onStartFocus(b.assignmentId, b.courseId, b.id)}
            className="shrink-0 h-6 w-6 grid place-items-center rounded-lg text-ink-3 hover:text-ink hover:bg-tint transition-colors"
          >
            <Play size={13} />
          </button>
        ))}
    </li>
  )
}

function EventRow({ entry, now }: { entry: AgendaEntry; now: number }) {
  const event = entry.event as PlannerEvent
  const live = entry.start <= now && entry.end >= now
  const past = entry.end < now
  const Icon =
    event.kind === 'custom_class'
      ? BookOpen
      : event.kind === 'exam'
        ? ClipboardCheck
        : event.kind === 'blocked_time'
          ? Clock3
          : CalendarOff
  const kind =
    event.kind === 'custom_class'
      ? 'Class'
      : event.kind === 'exam'
        ? 'Exam'
        : event.kind === 'blocked_time'
          ? 'Blocked time'
          : event.kind === 'reading_break'
            ? 'Reading break'
            : 'Holiday'
  const timeLine = event.allDay ? 'All day' : fmtTimeRange(entry.start, entry.end)
  const exam = event.kind === 'exam'

  return (
    <li
      className={cx(
        'flex items-start gap-2.5 px-1.5 py-2 rounded-xl border border-dashed transition-colors',
        exam
          ? 'border-[color-mix(in_srgb,var(--c-critical)_45%,transparent)] bg-[color-mix(in_srgb,var(--c-critical)_8%,transparent)]'
          : 'border-line-2',
        !exam && live && 'bg-tint',
        past && 'opacity-65',
      )}
      title={`${kind} · ${event.title}${event.room ? ` · ${event.room}` : ''}`}
    >
      {event.allDay ? (
        <span className="w-[42px] shrink-0 text-right text-[10.5px] font-medium text-ink-3 leading-[17px]">
          All day
        </span>
      ) : (
        <TimeCell at={entry.start} muted={past} />
      )}
      <span className={cx('w-[18px] shrink-0 grid place-items-center h-[17px]', exam ? 'text-[var(--c-critical-ink)]' : 'text-ink-2')}>
        <Icon size={14} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className={cx('flex items-center gap-1.5 min-w-0 text-[13px] font-medium leading-[17px]', past ? 'text-ink-3' : exam ? 'text-[var(--c-critical-ink)]' : 'text-ink')}>
          <span className="truncate">{event.title}</span>
          {exam && <span className="ui-chip ui-chip-critical shrink-0">Exam</span>}
        </p>
        <p className="text-[11.5px] text-ink-3 tnum leading-tight mt-0.5 truncate">
          <span className="sr-only">{timeLine} · </span>
          {kind}
          {!event.allDay && ` · ${timeLine}`}
          {event.room && ` · ${event.room}`}
        </p>
      </div>
    </li>
  )
}

function TimeCell({ at, muted }: { at: number; muted?: boolean }) {
  const t = fmtTime(at, { compact: true })
  const m = /(am|pm)$/.exec(t)
  return (
    <span
      className={cx(
        'w-[42px] shrink-0 text-right tnum leading-[17px] whitespace-nowrap',
        muted ? 'text-ink-3' : 'text-ink-2',
      )}
      aria-hidden
    >
      <span className="text-[11.5px] font-medium">{m ? t.slice(0, -2) : t}</span>
      {m && <span className="text-[9.5px] text-ink-3">{m[1]}</span>}
    </span>
  )
}

const NowTag = () => <span className="ui-eyebrow ui-eyebrow-flag shrink-0">Now</span>

const NextTag = () => <span className="ui-eyebrow shrink-0">Next</span>
