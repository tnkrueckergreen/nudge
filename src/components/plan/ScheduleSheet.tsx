import { useMemo, useState, type ReactNode } from 'react'
import {
  BookOpen,
  CalendarDays,
  CalendarOff,
  ClipboardCheck,
  Clock3,
  GraduationCap,
  Trash2,
} from 'lucide-react'
import { useStore } from '../../lib/store'
import { addDays, dayKey, fmtDay, fromDayKey } from '../../lib/date'
import type { PlannerEvent, PlannerEventKind, ScheduleOverride } from '../../lib/types'
import { Button, CourseDot, Field, Input, Select, Sheet, cx, useToast } from '../ui'

type Screen =
  | { page: 'home' }
  | { page: 'event'; eventId?: string; kind: PlannerEventKind }
  | { page: 'schedule'; overrideId?: string }

type EventDraft = {
  title: string
  kind: PlannerEventKind
  startDate: string
  endDate: string
  startTime: string
  endTime: string
  courseId: string
  room: string
}

type ScheduleDraft = {
  date: string
  scheduleDay: string
  title: string
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const EVENT_COPY: Record<PlannerEventKind, { title: string; body: string; placeholder: string }> = {
  custom_class: {
    title: 'One-time class',
    body: 'Guest lecture, make-up class, review session, or any class that only meets once.',
    placeholder: 'Guest lecture',
  },
  exam: {
    title: 'Exam',
    body: 'This blocks the exam in your schedule, so Nudge can plan study time around it. Track preparation as a task.',
    placeholder: 'ECON 230 midterm',
  },
  blocked_time: {
    title: 'Block time',
    body: 'Keep an appointment, commute, work shift, or personal commitment clear.',
    placeholder: 'Doctor appointment',
  },
  reading_break: {
    title: 'Reading break',
    body: 'Mark the whole break. Regular classes disappear and automatic planning leaves these days open.',
    placeholder: 'Reading break',
  },
  holiday: {
    title: 'Holiday',
    body: 'Mark the day off. Regular classes disappear and automatic planning leaves it clear.',
    placeholder: 'Thanksgiving',
  },
}

const allDayKind = (kind: PlannerEventKind) => kind === 'reading_break' || kind === 'holiday'

const localDate = (iso: string | Date) => dayKey(iso)

const localTime = (iso: string) => {
  const date = new Date(iso)
  return `${`${date.getHours()}`.padStart(2, '0')}:${`${date.getMinutes()}`.padStart(2, '0')}`
}

const atLocal = (date: string, time = '00:00') => {
  const [year, month, day] = date.split('-').map(Number)
  const [hours, minutes] = time.split(':').map(Number)
  return new Date(year, (month ?? 1) - 1, day ?? 1, hours ?? 0, minutes ?? 0).toISOString()
}

const initialEventDraft = (kind: PlannerEventKind, date: string, event?: PlannerEvent): EventDraft => {
  if (event) {
    return {
      title: event.title,
      kind: event.kind,
      startDate: localDate(event.start),
      endDate: event.allDay ? localDate(addDays(event.end, -1)) : localDate(event.start),
      startTime: localTime(event.start),
      endTime: localTime(event.end),
      courseId: event.courseId ?? '',
      room: event.room ?? '',
    }
  }
  const startTime = kind === 'exam' ? '09:00' : '10:00'
  const endTime = kind === 'exam' ? '12:00' : '11:00'
  return {
    title: '',
    kind,
    startDate: date,
    endDate: date,
    startTime,
    endTime,
    courseId: '',
    room: '',
  }
}

const initialScheduleDraft = (date: string, override?: ScheduleOverride): ScheduleDraft => ({
  date: override?.date ?? date,
  scheduleDay: override?.scheduleDay == null ? 'none' : String(override.scheduleDay),
  title: override?.title ?? '',
})

const eventDateLabel = (event: PlannerEvent) => {
  if (!event.allDay) return fmtDay(event.start)
  const first = fmtDay(event.start)
  const last = fmtDay(addDays(event.end, -1))
  return first === last ? first : `${first} – ${last}`
}

export function ScheduleSheet({
  initialDate,
  initial,
  onClose,
}: {
  initialDate: Date
  initial?: { type: 'exam' } | { type: 'event'; id: string } | { type: 'schedule'; id?: string }
  onClose: () => void
}) {
  const store = useStore()
  const courses = useStore((s) => s.courses)
  const events = useStore((s) => s.plannerEvents)
  const overrides = useStore((s) => s.scheduleOverrides)
  const { toast } = useToast()
  const defaultDate = dayKey(initialDate)

  const initialEvent = initial?.type === 'event' ? events.find((event) => event.id === initial.id) : undefined
  const initialOverride = initial?.type === 'schedule' && initial.id
    ? overrides.find((override) => override.id === initial.id)
    : undefined

  const [screen, setScreen] = useState<Screen>(() =>
    initialEvent
      ? { page: 'event', eventId: initialEvent.id, kind: initialEvent.kind }
      : initial?.type === 'exam'
        ? { page: 'event', kind: 'exam' }
      : initial?.type === 'schedule'
        ? { page: 'schedule', overrideId: initialOverride?.id }
        : { page: 'home' },
  )
  const [eventDraft, setEventDraft] = useState<EventDraft>(() =>
    initialEventDraft(initialEvent?.kind ?? (initial?.type === 'exam' ? 'exam' : 'custom_class'), defaultDate, initialEvent),
  )
  const [scheduleDraft, setScheduleDraft] = useState<ScheduleDraft>(() =>
    initialScheduleDraft(defaultDate, initialOverride),
  )

  const sortedEvents = useMemo(
    () => [...events].sort((a, b) => +new Date(a.start) - +new Date(b.start)),
    [events],
  )
  const sortedOverrides = useMemo(
    () => [...overrides].sort((a, b) => +fromDayKey(a.date) - +fromDayKey(b.date)),
    [overrides],
  )

  const openNewEvent = (kind: PlannerEventKind) => {
    setEventDraft(initialEventDraft(kind, defaultDate))
    setScreen({ page: 'event', kind })
  }

  const openEvent = (event: PlannerEvent) => {
    setEventDraft(initialEventDraft(event.kind, defaultDate, event))
    setScreen({ page: 'event', eventId: event.id, kind: event.kind })
  }

  const openSchedule = (override?: ScheduleOverride) => {
    setScheduleDraft(initialScheduleDraft(defaultDate, override))
    setScreen({ page: 'schedule', overrideId: override?.id })
  }

  const closeOrHome = () => (screen.page === 'home' ? onClose() : setScreen({ page: 'home' }))

  const activeEvent = screen.page === 'event' && screen.eventId
    ? events.find((event) => event.id === screen.eventId)
    : undefined
  const activeOverride = screen.page === 'schedule'
    ? overrides.find((override) => override.id === screen.overrideId) ?? overrides.find((override) => override.date === scheduleDraft.date)
    : undefined

  const updateEvent = <K extends keyof EventDraft>(key: K, value: EventDraft[K]) =>
    setEventDraft((draft) => ({ ...draft, [key]: value }))
  const updateSchedule = <K extends keyof ScheduleDraft>(key: K, value: ScheduleDraft[K]) =>
    setScheduleDraft((draft) => ({ ...draft, [key]: value }))

  const saveEvent = () => {
    const title = eventDraft.title.trim()
    const allDay = allDayKind(eventDraft.kind)
    const endDate = eventDraft.endDate < eventDraft.startDate ? eventDraft.startDate : eventDraft.endDate
    if (!title || (!allDay && eventDraft.endTime <= eventDraft.startTime)) return
    const input = {
      title,
      kind: eventDraft.kind,
      start: atLocal(eventDraft.startDate, allDay ? '00:00' : eventDraft.startTime),
      end: allDay
        ? atLocal(dayKey(addDays(fromDayKey(endDate), 1)), '00:00')
        : atLocal(eventDraft.startDate, eventDraft.endTime),
      allDay,
      courseId: eventDraft.courseId || null,
      room: eventDraft.room,
    }
    if (activeEvent) {
      store.updatePlannerEvent(activeEvent.id, input)
      toast('Schedule item updated')
    } else {
      store.addPlannerEvent(input)
      toast(`${EVENT_COPY[eventDraft.kind].title} added`, { action: { label: 'Undo', run: () => store.undo() } })
    }
    setScreen({ page: 'home' })
  }

  const saveSchedule = () => {
    const day = scheduleDraft.scheduleDay === 'none' ? null : Number(scheduleDraft.scheduleDay)
    if (!scheduleDraft.date || (day !== null && (!Number.isInteger(day) || day < 0 || day > 6))) return
    store.upsertScheduleOverride({ date: scheduleDraft.date, scheduleDay: day, title: scheduleDraft.title })
    const label = day == null ? 'No classes' : `${WEEKDAYS[day]} schedule`
    toast(`Using ${label}`, { action: { label: 'Undo', run: () => store.undo() } })
    setScreen({ page: 'home' })
  }

  if (screen.page === 'event') {
    const copy = EVENT_COPY[eventDraft.kind]
    const allDay = allDayKind(eventDraft.kind)
    const timeValid = allDay || eventDraft.endTime > eventDraft.startTime
    return (
      <Sheet
        open
        onClose={closeOrHome}
        title={activeEvent ? `Edit ${copy.title.toLowerCase()}` : `Add ${copy.title.toLowerCase()}`}
        description={copy.body}
        footer={
          <div className="flex items-center gap-2">
            {activeEvent && (
              <Button
                size="sm"
                variant="danger"
                aria-label="Delete schedule item"
                onClick={() => {
                  store.removePlannerEvent(activeEvent.id)
                  toast('Schedule item deleted', { action: { label: 'Undo', run: () => store.undo() } })
                  setScreen({ page: 'home' })
                }}
              >
                <Trash2 size={14} />
              </Button>
            )}
            <Button size="sm" onClick={() => setScreen({ page: 'home' })}>
              Cancel
            </Button>
            <div className="flex-1" />
            <Button size="sm" variant="primary" onClick={saveEvent} disabled={!eventDraft.title.trim() || !timeValid}>
              {activeEvent ? 'Save changes' : 'Add to schedule'}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <Field
            label={
              allDay
                ? 'What should this break be called?'
                : eventDraft.kind === 'exam'
                  ? 'Exam name'
                  : 'What is it?'
            }
          >
            <Input
              data-autofocus
              value={eventDraft.title}
              onChange={(event) => updateEvent('title', event.target.value)}
              placeholder={copy.placeholder}
            />
          </Field>

          {allDay ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Starts">
                <Input type="date" value={eventDraft.startDate} onChange={(event) => updateEvent('startDate', event.target.value)} />
              </Field>
              <Field label="Ends">
                <Input
                  type="date"
                  min={eventDraft.startDate}
                  value={eventDraft.endDate}
                  onChange={(event) => updateEvent('endDate', event.target.value)}
                />
              </Field>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Date" className="col-span-2">
                  <Input type="date" value={eventDraft.startDate} onChange={(event) => updateEvent('startDate', event.target.value)} />
                </Field>
                <Field label="Starts">
                  <Input type="time" step={900} value={eventDraft.startTime} onChange={(event) => updateEvent('startTime', event.target.value)} />
                </Field>
                <Field label="Ends">
                  <Input
                    type="time"
                    step={900}
                    value={eventDraft.endTime}
                    onChange={(event) => updateEvent('endTime', event.target.value)}
                  />
                </Field>
              </div>
              {!timeValid && <p className="-mt-2 text-[12px] text-[var(--c-critical)]">End time needs to be after the start.</p>}
            </>
          )}

          {!allDay && (
            <>
              <Field label="Course (optional)">
                <Select value={eventDraft.courseId} onChange={(event) => updateEvent('courseId', event.target.value)}>
                  <option value="">Not tied to a course</option>
                  {courses.filter((course) => !course.archived).map((course) => (
                    <option key={course.id} value={course.id}>{course.code}{course.title ? ` · ${course.title}` : ''}</option>
                  ))}
                </Select>
              </Field>
              {(eventDraft.kind === 'custom_class' || eventDraft.kind === 'exam') && (
                <Field label="Room or location (optional)">
                  <Input value={eventDraft.room} onChange={(event) => updateEvent('room', event.target.value)} placeholder="Leacock 132 or Zoom" />
                </Field>
              )}
            </>
          )}

          {allDay && (
            <p className="rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-[12.5px] leading-relaxed text-ink-2">
              Regular classes will be hidden for these dates, and Fill gaps will leave the days untouched. You can still add study time manually if you want to.
            </p>
          )}
        </div>
      </Sheet>
    )
  }

  if (screen.page === 'schedule') {
    return (
      <Sheet
        open
        onClose={closeOrHome}
        title="Use a different schedule"
        description="Useful after a holiday, on a make-up day, or whenever this date follows another weekday's class timetable."
        footer={
          <div className="flex items-center gap-2">
            {activeOverride && (
              <Button
                size="sm"
                variant="danger"
                aria-label="Remove custom schedule"
                onClick={() => {
                  store.removeScheduleOverride(activeOverride.id)
                  toast('Schedule reset', { action: { label: 'Undo', run: () => store.undo() } })
                  setScreen({ page: 'home' })
                }}
              >
                <Trash2 size={14} />
              </Button>
            )}
            <Button size="sm" onClick={() => setScreen({ page: 'home' })}>Cancel</Button>
            <div className="flex-1" />
            <Button size="sm" variant="primary" onClick={saveSchedule}>Save schedule</Button>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Date">
            <Input
              data-autofocus
              type="date"
              value={scheduleDraft.date}
              onChange={(event) => {
                const match = overrides.find((override) => override.date === event.target.value)
                setScheduleDraft(initialScheduleDraft(event.target.value, match))
                setScreen({ page: 'schedule', overrideId: match?.id })
              }}
            />
          </Field>
          <Field label="This date follows">
            <Select value={scheduleDraft.scheduleDay} onChange={(event) => updateSchedule('scheduleDay', event.target.value)}>
              <option value="none">No classes</option>
              {WEEKDAYS.map((weekday, index) => <option key={weekday} value={index}>{weekday} schedule</option>)}
            </Select>
          </Field>
          <Field label="Label (optional)" hint="A short note for you, like “Monday schedule after Labour Day.”">
            <Input value={scheduleDraft.title} onChange={(event) => updateSchedule('title', event.target.value)} placeholder="Monday schedule after holiday" />
          </Field>
          <p className="rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-[12.5px] leading-relaxed text-ink-2">
            Note: study blocks stay put.
          </p>
        </div>
      </Sheet>
    )
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="Schedule"
      description="Classes, exams, and commitments shape every plan Nudge makes."
      size="lg"
    >
      <div className="flex flex-col gap-5">
        <section>
          <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.07em] text-ink-3">Academic schedule</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <AddCard icon={<ClipboardCheck size={17} />} title="Exam" body="A high-stakes date and time" onClick={() => openNewEvent('exam')} />
            <AddCard icon={<GraduationCap size={17} />} title="One-time class" body="Guest lecture, make-up, or review" onClick={() => openNewEvent('custom_class')} />
          </div>
        </section>

        <section>
          <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.07em] text-ink-3">Commitments</p>
          <div className="grid gap-2 sm:grid-cols-3">
            <AddCard icon={<Clock3 size={17} />} title="Block time" body="Appointment or commitment" onClick={() => openNewEvent('blocked_time')} />
          </div>
        </section>

        <section>
          <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.07em] text-ink-3">Class-calendar changes</p>
          <div className="grid gap-2 sm:grid-cols-3">
            <AddCard icon={<BookOpen size={17} />} title="Reading break" body="A range of no-class days" onClick={() => openNewEvent('reading_break')} />
            <AddCard icon={<CalendarOff size={17} />} title="Holiday" body="Keep a day clear" onClick={() => openNewEvent('holiday')} />
            <AddCard icon={<CalendarDays size={17} />} title="Different schedule" body="e.g., use Monday on a Tuesday" onClick={() => openSchedule()} />
          </div>
        </section>

        {(sortedEvents.length > 0 || sortedOverrides.length > 0) && (
          <section className="border-t border-line pt-4">
            <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.07em] text-ink-3">Your schedule</p>
            <div className="flex flex-col gap-1">
              {sortedEvents.map((event) => {
                const eventCourse = event.courseId ? courses.find((course) => course.id === event.courseId) : undefined
                return (
                  <ChangeRow
                    key={event.id}
                    icon={
                      event.kind === 'exam' ? (
                        eventCourse ? <CourseDot course={eventCourse} size={14} /> : <ClipboardCheck size={14} />
                      ) : event.allDay ? (
                        <CalendarOff size={14} />
                      ) : (
                        <GraduationCap size={14} />
                      )
                    }
                    title={event.title}
                    meta={`${EVENT_COPY[event.kind].title} · ${eventDateLabel(event)}`}
                    onClick={() => openEvent(event)}
                  />
                )
              })}
              {sortedOverrides.map((override) => (
                <ChangeRow
                  key={override.id}
                  icon={<CalendarDays size={14} />}
                  title={override.title || `${override.scheduleDay == null ? 'No classes' : `${WEEKDAYS[override.scheduleDay]} schedule`}`}
                  meta={fmtDay(fromDayKey(override.date))}
                  onClick={() => openSchedule(override)}
                />
              ))}
            </div>
          </section>
        )}
      </div>
    </Sheet>
  )
}

function AddCard({
  icon,
  title,
  body,
  onClick,
}: {
  icon: ReactNode
  title: string
  body: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'min-h-[94px] rounded-xl border border-line bg-surface-2 p-3 text-left transition-colors',
        'hover:border-line-2 hover:bg-tint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink',
      )}
    >
      <span className="grid h-7 w-7 place-items-center rounded-lg bg-surface text-ink-2 shadow-[0_1px_1px_rgba(0,0,0,.04)]">{icon}</span>
      <span className="mt-2 block text-[13px] font-semibold text-ink">{title}</span>
      <span className="mt-0.5 block text-[11.5px] leading-snug text-ink-3">{body}</span>
    </button>
  )
}

function ChangeRow({
  icon,
  title,
  meta,
  onClick,
}: {
  icon: ReactNode
  title: string
  meta: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-tint transition-colors"
    >
      <span className="grid h-7 w-7 place-items-center rounded-md bg-surface-2 text-ink-3">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] font-medium text-ink">{title}</span>
        <span className="block truncate text-[11.5px] text-ink-3">{meta}</span>
      </span>
      <span className="text-[12px] text-ink-3">Edit</span>
    </button>
  )
}
