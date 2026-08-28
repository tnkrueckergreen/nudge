import { FlaskConical, MessagesSquare, Presentation, Users, type LucideIcon } from 'lucide-react'
import type { Assignment, Course, Meeting, MeetingKind, PlannerEvent, ScheduleOverride, StudyBlock } from './types'
import { dayKey, startOfDay } from './date'

export const MEETING_KINDS: readonly MeetingKind[] = ['lecture', 'tutorial', 'conference', 'lab']

export interface KindSpec {
  label: string

  short: string
  icon: LucideIcon

  blurb: string
}

export const KIND: Record<MeetingKind, KindSpec> = {
  lecture: {
    label: 'Lecture',
    short: 'LEC',
    icon: Presentation,
    blurb: 'The main class, everyone together',
  },
  tutorial: {
    label: 'Tutorial',
    short: 'TUT',
    icon: Users,
    blurb: 'Smaller group, usually with a TA',
  },
  conference: {
    label: 'Conference',
    short: 'CONF',
    icon: MessagesSquare,
    blurb: 'Discussion section',
  },
  lab: {
    label: 'Lab',
    short: 'LAB',
    icon: FlaskConical,
    blurb: 'Hands-on, in a lab room',
  },
}

export const kindOf = (k: MeetingKind | undefined): KindSpec => KIND[k ?? 'lecture'] ?? KIND.lecture

export interface Place {

  raw: string

  building: string

  room?: string

  remote: boolean

  key: string
}

const REMOTE = /\b(online|remote|zoom|teams|virtual|async|recorded|myCourses)\b/i

const BUILDING_NOISE = /\b(hall|building|bldg|pavilion|centre|center|complex)\b/g

export function parsePlace(raw: string | undefined | null): Place | null {
  const text = (raw ?? '').trim().replace(/\s+/g, ' ')
  if (!text) return null

  const remote = REMOTE.test(text)

  const norm = (s: string) => {
    const bare = s.toLowerCase().replace(/[^a-z0-9 ]+/g, '')
    const trimmed = bare.replace(BUILDING_NOISE, '').replace(/\s+/g, '')
    return trimmed || bare.replace(/\s+/g, '')
  }

  if (remote) return { raw: text, building: text, remote: true, key: 'remote' }

  const bare = text.match(/^(?:room|rm\.?)\s+(.+)$/i)
  if (bare) return { raw: text, building: '', room: bare[1], remote: false, key: norm(bare[1]) }

  const tokens = text.split(' ')
  let cut = -1
  for (let i = tokens.length - 1; i > 0; i--) {
    if (/\d/.test(tokens[i])) {
      cut = i
      break
    }
  }

  if (cut > 0) {
    const building = tokens.slice(0, cut).join(' ')
    return { raw: text, building, room: tokens.slice(cut).join(' '), remote: false, key: norm(building) }
  }

  if (tokens.length === 1) {
    const glued = text.match(/^([A-Za-z][A-Za-z.'&-]*[A-Za-z])[\s-]?(\d[\w/-]*)$/)
    if (glued) return { raw: text, building: glued[1], room: glued[2], remote: false, key: norm(glued[1]) }
  }

  return { raw: text, building: text, remote: false, key: norm(text) }
}

export const placeOf = (course: Course, meeting: Meeting): Place | null =>
  parsePlace(meeting.room?.trim() || course.room)

export const samePlace = (a: Place | null, b: Place | null) => !!a && !!b && a.key === b.key

export function knownBuildings(courses: Course[]): string[] {
  const seen = new Map<string, string>()
  for (const c of courses) {
    for (const raw of [c.room, ...c.meetings.map((m) => m.room)]) {
      const p = parsePlace(raw)
      if (p && p.building && !p.remote && !seen.has(p.key)) seen.set(p.key, p.building)
    }
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b))
}

export function distinctPlaces(course: Course): Place[] {
  const seen = new Map<string, Place>()
  for (const m of course.meetings) {
    const p = placeOf(course, m)
    if (p && !seen.has(p.raw.toLowerCase())) seen.set(p.raw.toLowerCase(), p)
  }
  return [...seen.values()]
}

export function hasMultipleMeetingKinds(course: Course): boolean {
  if (!course.meetings || course.meetings.length <= 1) return false
  const first = course.meetings[0].kind
  return course.meetings.some((m) => m.kind !== first)
}

const TIGHT_HOP_MIN = 10

const HOP_WINDOW_MIN = 30

export interface Hop {
  from: Place
  to: Place

  gapMin: number

  tight: boolean

  clash: boolean
}

export function hopBetween(
  prev: { end: number; place: Place | null } | undefined,
  next: { start: number; place: Place | null },
): Hop | null {
  if (!prev?.place || !next.place) return null
  if (samePlace(prev.place, next.place)) return null
  const gapMin = Math.round((next.start - prev.end) / 60_000)
  if (gapMin > HOP_WINDOW_MIN) return null
  return {
    from: prev.place,
    to: next.place,
    gapMin,
    tight: gapMin < TIGHT_HOP_MIN,
    clash: gapMin < 0,
  }
}

export interface ClassOccurrence {
  id: string
  course: Course
  meeting: Meeting

  start: number
  end: number
  place: Place | null
}

export interface PlannerScheduleContext {
  plannerEvents?: PlannerEvent[]
  scheduleOverrides?: ScheduleOverride[]
}

export const plannerEventOnDay = (event: PlannerEvent, day: Date | number): boolean => {
  const target = +startOfDay(day)
  if (!event.allDay) return dayKey(event.start) === dayKey(target)
  return target >= +startOfDay(event.start) && target < +startOfDay(event.end)
}

export const allDayEventsOn = (events: PlannerEvent[], day: Date | number) =>
  events.filter((event) => event.allDay && plannerEventOnDay(event, day))

export const scheduleOverrideOn = (overrides: ScheduleOverride[], day: Date | number) =>
  overrides.find((override) => override.date === dayKey(day))

export function scheduleDayFor(day: Date | number, overrides: ScheduleOverride[] = []): number | null {
  const override = scheduleOverrideOn(overrides, day)
  if (override) return override.scheduleDay == null ? null : override.scheduleDay
  return new Date(+startOfDay(day)).getDay()
}

export function classesOn(courses: Course[], day: Date | number, context: PlannerScheduleContext = {}): ClassOccurrence[] {
  const base = +startOfDay(day)
  const hasBreak = (context.plannerEvents ?? []).some(
    (event) =>
      event.allDay &&
      (event.kind === 'holiday' || event.kind === 'reading_break') &&
      plannerEventOnDay(event, base),
  )
  if (hasBreak) return []
  const weekday = scheduleDayFor(base, context.scheduleOverrides)
  if (weekday == null) return []
  const out: ClassOccurrence[] = []
  for (const c of courses) {
    if (c.archived) continue
    for (const m of c.meetings) {
      if (m.day !== weekday) continue
      out.push({
        id: `${c.id}:${m.id}:${base}`,
        course: c,
        meeting: m,
        start: base + m.start * 60_000,
        end: base + m.end * 60_000,
        place: placeOf(c, m),
      })
    }
  }
  return out.sort((a, b) => a.start - b.start || a.end - b.end)
}

export function nextClass(
  courses: Course[],
  now: number,
  withinDays = 7,
  context: PlannerScheduleContext = {},
): ClassOccurrence | null {
  for (let i = 0; i <= withinDays; i++) {
    const day = +startOfDay(now) + i * 86_400_000
    const hit = classesOn(courses, day, context).find((c) => c.end > now)
    if (hit) return hit
  }
  return null
}

export interface AgendaEntry {
  id: string
  start: number
  end: number

  title: string
  course?: Course
  place: Place | null
  cls?: ClassOccurrence
  block?: StudyBlock
  event?: PlannerEvent

  hop: Hop | null
}

export function dayAgenda(
  courses: Course[],
  blocks: StudyBlock[],
  day: Date | number,
  assignments: Assignment[] = [],
  context: PlannerScheduleContext = {},
): AgendaEntry[] {
  const base = +startOfDay(day)
  const end = base + 86_400_000
  const courseById = new Map(courses.map((c) => [c.id, c]))
  const assignmentById = new Map(assignments.map((a) => [a.id, a]))

  const entries: Omit<AgendaEntry, 'hop'>[] = classesOn(courses, day, context).map((cls) => ({
    id: cls.id,
    start: cls.start,
    end: cls.end,
    title: cls.course.code,
    course: cls.course,
    place: cls.place,
    cls,
  }))

  for (const b of blocks) {
    const start = +new Date(b.start)
    if (start < base || start >= end) continue
    const linked = b.assignmentId ? assignmentById.get(b.assignmentId) : undefined
    const course = courseById.get(linked?.courseId ?? b.courseId ?? '')
    const step = b.subtaskId ? linked?.subtasks.find((t) => t.id === b.subtaskId) : undefined
    entries.push({
      id: `block:${b.id}`,
      start,
      end: +new Date(b.end),
      title: b.title || step?.title || linked?.title || course?.code || 'Study',
      course,
      place: null,
      block: b,
    })
  }

  for (const event of context.plannerEvents ?? []) {
    if (!plannerEventOnDay(event, day)) continue
    const course = event.courseId ? courseById.get(event.courseId) : undefined
    entries.push({
      id: `event:${event.id}`,
      start: event.allDay ? base : +new Date(event.start),
      end: event.allDay ? end : +new Date(event.end),
      title: event.title,
      course,
      place: parsePlace(event.room || course?.room),
      event,
    })
  }

  entries.sort((a, b) => a.start - b.start || a.end - b.end)

  let lastPlaced: Omit<AgendaEntry, 'hop'> | undefined
  return entries.map((e) => {
    const hop = e.place ? hopBetween(lastPlaced, e) : null
    if (e.place) lastPlaced = e
    return { ...e, hop }
  })
}

export interface MeetingGroup {

  days: number[]
  start: number
  end: number
  kind: MeetingKind
  room?: string

  members: Meeting[]
}

const groupKey = (m: Meeting) => `${m.start}|${m.end}|${m.kind}|${(m.room ?? '').trim().toLowerCase()}`

export function groupMeetings(meetings: Meeting[]): MeetingGroup[] {
  const byKey = new Map<string, MeetingGroup>()
  for (const m of [...meetings].sort((a, b) => a.start - b.start || a.day - b.day)) {
    const k = groupKey(m)
    const hit = byKey.get(k)
    if (hit) {
      if (!hit.days.includes(m.day)) hit.days.push(m.day)
      hit.members.push(m)
    } else {
      byKey.set(k, { days: [m.day], start: m.start, end: m.end, kind: m.kind, room: m.room, members: [m] })
    }
  }
  return [...byKey.values()]
    .map((g) => ({ ...g, days: g.days.sort((a, b) => a - b) }))
    .sort((a, b) => (a.days[0] ?? 0) - (b.days[0] ?? 0) || a.start - b.start)
}

const WEEKDAY_LETTER = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export const fmtDays = (days: number[]) => days.map((d) => WEEKDAY_SHORT[d]).join(' ')
export const dayLetter = (d: number) => WEEKDAY_LETTER[d]
export const dayShort = (d: number) => WEEKDAY_SHORT[d]
