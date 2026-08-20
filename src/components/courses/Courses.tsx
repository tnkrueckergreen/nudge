import { useEffect, useMemo, useState } from 'react'
import { ArchiveRestore, CalendarClock, ChevronDown, ChevronRight, GraduationCap, Plus, User } from 'lucide-react'
import type { Course } from '../../lib/types'
import type { Derived } from '../../lib/derive'
import { useStore } from '../../lib/store'
import { gradeOutlook } from '../../lib/stats'
import { atMinutes, daysBetween, fmtDuration, fmtTimeRange, startOfDay } from '../../lib/date'
import { distinctPlaces, fmtDays, groupMeetings, hasMultipleMeetingKinds, parsePlace } from '../../lib/meetings'
import { colorOf } from '../../lib/theme'
import { KindBadge, PlaceLine } from '../schedule/ClassBits'
import { Button, Card, Chip, CourseDot, EmptyState, useToast } from '../ui'
import { TaskRow } from '../tasks/TaskRow'

export function Courses({
  derived,
  now,
  onOpenTask,
  onEditCourse,
  onAddCourse,
  focusCourseId,
}: {
  derived: Derived
  now: number
  onOpenTask: (id: string) => void
  onEditCourse: (id: string) => void
  onAddCourse: () => void
  focusCourseId?: string | null
}) {
  const courses = useStore((s) => s.courses)
  const assignments = useStore((s) => s.assignments)
  const [expanded, setExpanded] = useState<string | null>(focusCourseId ?? null)

  useEffect(() => {
    if (focusCourseId) setExpanded(focusCourseId)
  }, [focusCourseId])

  const active = courses.filter((c) => !c.archived)
  const archived = courses.filter((c) => c.archived)

  if (active.length === 0 && archived.length === 0) {
    return (
      <div className="px-3 sm:px-6 py-6 max-w-[900px] mx-auto">
        <Card>
          <EmptyState
            icon={<GraduationCap size={20} />}
            title="No courses yet"
            body="Add your course codes. Nudge will then organize tasks, grades, and class times by course."
            action={
              <Button variant="primary" onClick={onAddCourse}>
                <Plus size={16} />
                Add a course
              </Button>
            }
          />
        </Card>
      </div>
    )
  }

  return (
    <div className="px-3 sm:px-6 pt-4 sm:pt-7 pb-8 max-w-[1180px] mx-auto">
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-[22px] sm:text-[27px] font-semibold tracking-[-0.02em] text-ink">Courses</h1>
        <Button variant="primary" size="sm" onClick={onAddCourse}>
          <Plus size={15} />
          Add course
        </Button>
      </div>

      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {active.map((c) => (
          <CourseCard
            key={c.id}
            course={c}
            derived={derived}
            now={now}
            expanded={expanded === c.id}
            onToggle={() => setExpanded((e) => (e === c.id ? null : c.id))}
            onEdit={() => onEditCourse(c.id)}
            onOpenTask={onOpenTask}
            assignmentsCount={assignments.filter((a) => a.courseId === c.id && a.status !== 'done').length}
          />
        ))}
      </div>

      {archived.length > 0 && <ArchivedCourses courses={archived} onEditCourse={onEditCourse} />}
    </div>
  )
}

function ArchivedCourses({
  courses,
  onEditCourse,
}: {
  courses: Course[]
  onEditCourse: (id: string) => void
}) {
  const store = useStore()
  const assignments = useStore((s) => s.assignments)
  const { toast } = useToast()
  const [open, setOpen] = useState(false)

  return (
    <section className="mt-5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1.5 px-1 pb-2 text-[12px] font-semibold uppercase tracking-[0.04em] text-ink-3 hover:text-ink transition-colors"
      >
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        Archived
        <span className="tnum font-normal">{courses.length}</span>
      </button>

      {open && (
        <div className="bg-surface border border-line rounded-card shadow-card p-1">
          {courses.map((c) => {
            const kept = assignments.filter((a) => a.courseId === c.id).length
            return (
              <div key={c.id} className="group flex items-center gap-2.5 px-2.5 py-2 rounded-xl hover:bg-tint transition-colors">
                <CourseDot course={c} size={15} className="opacity-70" />
                <button type="button" onClick={() => onEditCourse(c.id)} className="min-w-0 flex-1 text-left">
                  <span className="text-[14px] font-medium text-ink-2">{c.code}</span>
                  {c.title && <span className="text-[12.5px] text-ink-3 ml-2 truncate">{c.title}</span>}
                </button>
                <span className="text-[11.5px] text-ink-3 tnum shrink-0">
                  {kept} {kept === 1 ? 'task' : 'tasks'} kept
                </span>
                <Button
                  size="sm"
                  onClick={() => {
                    store.setCourseArchived(c.id, false)
                    toast(`${c.code} restored`, { action: { label: 'Undo', run: () => store.undo() } })
                  }}
                >
                  <ArchiveRestore size={14} />
                  Restore
                </Button>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

function CourseCard({
  course,
  derived,
  now,
  expanded,
  onToggle,
  onEdit,
  onOpenTask,
  assignmentsCount,
}: {
  course: Course
  derived: Derived
  now: number
  expanded: boolean
  onToggle: () => void
  onEdit: () => void
  onOpenTask: (id: string) => void
  assignmentsCount: number
}) {
  const assignments = useStore((s) => s.assignments)
  const outlook = useMemo(() => gradeOutlook(course, assignments), [course, assignments])
  const stale = derived.staleByCourse.get(course.id) ?? 0
  const minutes = derived.byCourse.get(course.id) ?? 0
  const tasks = derived.ranked.filter((r) => r.assignment.courseId === course.id)
  const oneRoom = parsePlace(course.room)

  const exams = [
    course.midterm ? { label: 'Midterm', iso: course.midterm } : null,
    course.final ? { label: 'Final', iso: course.final } : null,
  ].filter(Boolean) as { label: string; iso: string }[]
  const nextExam = exams
    .map((e) => ({ ...e, days: daysBetween(now, +new Date(e.iso)) }))
    .filter((e) => e.days >= 0)
    .sort((a, b) => a.days - b.days)[0]

  return (
    <Card onOpen={onEdit} className="overflow-hidden flex flex-col">
      <div className="p-3.5 flex-1 flex flex-col">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="text-[16px] font-semibold text-ink leading-tight flex items-center gap-2">
              <CourseDot course={course} size={16} />
              {course.code}
            </h2>
            {course.title && <p className="text-[12.5px] text-ink-3 truncate mt-0.5">{course.title}</p>}
          </div>
          <button
            onClick={onEdit}
            className="text-[12px] font-medium text-ink-3 hover:text-ink px-1.5 py-0.5 rounded-md hover:bg-tint transition-colors shrink-0"
          >
            Edit
          </button>
        </div>

        {(course.professor || (oneRoom && !course.meetings.length)) && (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-3">
            {course.professor && (
              <span className="inline-flex items-center gap-1 min-w-0">
                <User size={12} className="shrink-0" />
                <span className="truncate">{course.professor}</span>
              </span>
            )}
            {!course.meetings.length && <PlaceLine place={oneRoom} className="text-ink-3" />}
          </div>
        )}

        <ScheduleStrip course={course} />

        <div className="mt-3">
          <div className="flex items-baseline justify-between text-[12px] mb-1.5">
            <span className="text-ink-3">Grade</span>
            <span className="tnum text-ink-2">
              {outlook.display != null ? `${outlook.display}%` : '—'}
              {outlook.target != null && <span className="text-ink-3"> / {outlook.target}% target</span>}
            </span>
          </div>
          <GradeBar outlook={outlook} course={course} />
          {outlook.needed != null && outlook.remainingWeight > 0 && (
            <p className="mt-1.5 text-[11.5px] text-ink-3 leading-snug">
              {outlook.outOfReach ? (
                <>
                  <span className="text-[var(--c-critical-ink)] font-medium">Target is out of reach.</span> You would need{' '}
                  {outlook.needed}% on the remaining {Math.round(outlook.remainingWeight)}%.
                </>
              ) : (
                <>
                  Need <span className="text-ink font-medium tnum">{Math.max(0, outlook.needed)}%</span> on the
                  remaining {Math.round(outlook.remainingWeight)}% to hit target.
                </>
              )}
            </p>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {nextExam && (
            <Chip tone={nextExam.days <= 7 ? 'warn' : 'neutral'} className="tnum">
              <CalendarClock size={11} />
              {nextExam.label} in {nextExam.days}d
            </Chip>
          )}
          <Chip tone="quiet" className="tnum">
            {assignmentsCount} open
          </Chip>
          <Chip tone="quiet" className="tnum">
            {fmtDuration(minutes)} logged
          </Chip>
          {stale >= 3 && (
            <Chip tone="warn" className="tnum">
              {stale}d untouched
            </Chip>
          )}
        </div>

        {tasks.length > 0 && (
          <button
            onClick={onToggle}
            className="mt-3 -mb-1 self-start text-[12.5px] font-medium text-ink-2 hover:text-ink transition-colors"
            aria-expanded={expanded}
          >
            {expanded ? 'Hide tasks' : `Show ${tasks.length} task${tasks.length === 1 ? '' : 's'}`}
          </button>
        )}
      </div>

      {expanded && tasks.length > 0 && (
        <div className="border-t border-line px-1.5 py-1 bg-surface-2 a-rise">
          {tasks.map((r) => (
            <TaskRow
              key={r.assignment.id}
              r={r}
              now={now}
              compact
              onOpen={() => onOpenTask(r.assignment.id)}
              onToggle={() => useStore.getState().setAssignmentStatus(r.assignment.id, 'done')}
            />
          ))}
        </div>
      )}
    </Card>
  )
}

function ScheduleStrip({ course }: { course: Course }) {
  const groups = useMemo(() => groupMeetings(course.meetings), [course.meetings])
  const places = useMemo(() => distinctPlaces(course), [course])
  const hasMultipleKinds = useMemo(() => hasMultipleMeetingKinds(course), [course])

  const single = places.length === 1 ? places[0] : null
  if (!groups.length) return null

  const day = startOfDay(Date.now())

  return (
    <div className="mt-2.5 flex flex-col gap-1.5">
      {groups.map((g, i) => {
        const place = single ? null : parsePlace(g.room ?? course.room)
        return (
          <div key={i} className="flex items-start gap-2 min-w-0">
            {hasMultipleKinds && <KindBadge kind={g.kind} className="mt-[1px]" />}
            <div className="min-w-0 flex-1">
              <p className="text-[12px] leading-[18px] flex items-baseline gap-1.5 min-w-0">
                <span className="font-medium text-ink-2 shrink-0">{fmtDays(g.days)}</span>
                <span className="tnum text-ink-3 truncate">
                  {fmtTimeRange(atMinutes(day, g.start), atMinutes(day, g.end))}
                </span>
              </p>
              {place && <PlaceLine place={place} size="xs" className="text-ink-3" />}
            </div>
          </div>
        )
      })}
      {single && <PlaceLine place={single} className="text-ink-3 mt-0.5" />}
    </div>
  )
}

function GradeBar({ outlook, course }: { outlook: ReturnType<typeof gradeOutlook>; course: Course }) {
  const value = outlook.display ?? 0
  const target = outlook.target ?? 0
  return (
    <div className="relative h-[7px] w-full rounded-full bg-sunken overflow-hidden">
      <div
        className="h-full rounded-full transition-[width] duration-500"
        style={{ width: `${Math.min(100, value)}%`, background: colorOf(course) }}
      />
      {target > 0 && (
        <span
          className="absolute top-0 h-full w-[2px] bg-ink/45"
          style={{ left: `calc(${Math.min(100, target)}% - 1px)` }}
          title={`Target ${target}%`}
          aria-hidden
        />
      )}
    </div>
  )
}
