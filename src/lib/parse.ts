import type { Course, TaskKind } from './types'
import { normalizeCode } from './store'
import { addDays, startOfDay } from './date'

export interface Parsed {
  title: string
  courseId: string | null
  courseCode: string | null
  kind: TaskKind
  due: Date

  dueExplicit: boolean
  weight?: number
  estimateMin?: number
}

const KIND_WORDS: [RegExp, TaskKind][] = [
  [/\b(essay|paper|response paper|term paper|writing)\b/i, 'essay'],
  [/\b(problem set|pset|ps\d*|webwork|homework|hw)\b/i, 'problemset'],
  [/\b(project|app|build)\b/i, 'project'],
  [/\b(reading|read|chapter|chapters|ch\.?\s?\d+)\b/i, 'reading'],
  [/\b(take[\s-]?home|open[\s-]?book)\s+(exam|test)\b/i, 'takehome'],
  [/\b(quiz|test)\b/i, 'quiz'],
  [/\b(midterm|mt)\b/i, 'midterm'],
  [/\bfinal\b/i, 'final'],
  [/\b(lab|report)\b/i, 'lab'],
  [/\b(presentation|present|slides|talk)\b/i, 'presentation'],

  [
    /\b(laundry|dishes|groceries|grocery|shopping|clean|cleaning|tidy|vacuum|bins|rubbish|trash|chores?|errands?|appointment|dentist|doctor|haircut|renew|pharmacy|prescription|bank|post office|package|packing|pack|move|birthday|gift|present for|call (?:mum|mom|dad|home)|laundromat|rent|bills?)\b/i,
    'personal',
  ],
]

const WEEKDAYS = [
  ['sunday', 'sun'],
  ['monday', 'mon'],
  ['tuesday', 'tue', 'tues'],
  ['wednesday', 'wed'],
  ['thursday', 'thu', 'thur', 'thurs'],
  ['friday', 'fri'],
  ['saturday', 'sat'],
]

const MONTHS = [
  'jan', 'feb', 'mar', 'apr', 'may', 'jun',
  'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
]

interface Cut {
  start: number
  end: number
}

export function parseQuickAdd(raw: string, courses: Course[], now: Date = new Date()): Parsed {
  const text = raw.trim()
  const cuts: Cut[] = []
  const eat = (m: RegExpMatchArray | null) => {
    if (m?.index != null) cuts.push({ start: m.index, end: m.index + m[0].length })
  }

  let courseId: string | null = null
  let courseCode: string | null = null

  for (const c of courses) {
    if (c.archived) continue
    const [subj, num] = c.code.split(' ')
    const re = new RegExp(`\\b${subj}\\s*${num ?? ''}\\b`, 'i')
    const m = text.match(re)
    if (m) {
      courseId = c.id
      courseCode = c.code
      eat(m)
      break
    }
  }
  if (!courseId) {

    for (const c of courses) {
      if (c.archived) continue
      const subj = c.code.split(' ')[0]
      const m = text.match(new RegExp(`\\b${subj}\\b`, 'i'))
      if (m && courses.filter((x) => !x.archived && x.code.startsWith(subj)).length === 1) {
        courseId = c.id
        courseCode = c.code
        eat(m)
        break
      }
    }
  }
  if (!courseId) {
    const m = text.match(/\b([a-z]{3,4})\s?(\d{3}[a-z]?\d?)\b/i)
    if (m) {
      courseCode = normalizeCode(`${m[1]} ${m[2]}`)
      eat(m)
    }
  }

  let weight: number | undefined
  const wm = text.match(/\b(\d{1,3}(?:\.\d)?)\s?%/)
  if (wm) {
    const v = parseFloat(wm[1])
    if (v > 0 && v <= 100) {
      weight = v
      eat(wm)
    }
  }

  let estimateMin: number | undefined
  const em =
    text.match(/~?\b(\d{1,2})\s?h(?:rs?|ours?)?\s?(\d{1,2})?\s?m?(?:in)?\b/i) ??
    text.match(/~?\b(\d{2,3})\s?m(?:in|ins|inutes)?\b/i) ??
    text.match(/~?\b(\d(?:\.\d)?)\s?h(?:rs?|ours?)?\b/i)
  if (em) {
    if (/h/i.test(em[0])) {
      estimateMin = Math.round(parseFloat(em[1]) * 60 + (em[2] ? parseInt(em[2], 10) : 0))
    } else {
      estimateMin = parseInt(em[1], 10)
    }
    if (estimateMin > 0 && estimateMin <= 2400) eat(em)
    else estimateMin = undefined
  }

  let hour: number | null = null
  let minute = 0
  const tm = text.match(/\b(\d{1,2})(?::(\d{2}))?\s?(am|pm)\b/i)
  if (tm) {
    let h = parseInt(tm[1], 10) % 12
    if (/pm/i.test(tm[3])) h += 12
    hour = h
    minute = tm[2] ? parseInt(tm[2], 10) : 0
    eat(tm)
  } else {
    const t24 = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/)
    if (t24) {
      hour = parseInt(t24[1], 10)
      minute = parseInt(t24[2], 10)
      eat(t24)
    } else {
      const noon = text.match(/\b(noon|midday)\b/i)
      const night = text.match(/\b(midnight|eod)\b/i)
      if (noon) {
        hour = 12
        eat(noon)
      } else if (night) {
        hour = 23
        minute = 59
        eat(night)
      }
    }
  }

  let day: Date | null = null
  const rel = text.match(/\b(today|tonight|tmrw?|tmr|tomorrow|overmorrow)\b/i)
  if (rel) {
    const w = rel[1].toLowerCase()
    day = w === 'today' || w === 'tonight' ? new Date(now) : addDays(now, w === 'overmorrow' ? 2 : 1)
    if (w === 'tonight' && hour == null) hour = 22
    eat(rel)
  }

  if (!day) {
    const inDays = text.match(/\bin\s+(\d{1,2})\s?(day|days|d)\b/i)
    if (inDays) {
      day = addDays(now, parseInt(inDays[1], 10))
      eat(inDays)
    }
  }
  if (!day) {
    const inWeeks = text.match(/\bin\s+(\d{1,2})\s?(week|weeks|w)\b/i)
    if (inWeeks) {
      day = addDays(now, parseInt(inWeeks[1], 10) * 7)
      eat(inWeeks)
    }
  }

  if (!day) {
    for (let i = 0; i < WEEKDAYS.length; i++) {
      const names = WEEKDAYS[i].join('|')
      const m = text.match(new RegExp(`\\b(next\\s+)?(${names})\\b`, 'i'))
      if (!m) continue
      const target = i
      const cur = now.getDay()
      let delta = (target - cur + 7) % 7
      if (delta === 0) delta = 7
      if (m[1]) delta += 7
      day = addDays(now, delta)
      eat(m)
      break
    }
  }

  if (!day) {
    const md = text.match(new RegExp(`\\b(${MONTHS.join('|')})[a-z]*\\.?\\s+(\\d{1,2})\\b`, 'i'))
    const dm = text.match(new RegExp(`\\b(\\d{1,2})\\s+(${MONTHS.join('|')})[a-z]*\\b`, 'i'))
    const hit = md ?? dm
    if (hit) {
      const monthName = (md ? hit[1] : hit[2]).slice(0, 3).toLowerCase()
      const dayNum = parseInt(md ? hit[2] : hit[1], 10)
      const month = MONTHS.indexOf(monthName)
      if (month >= 0 && dayNum >= 1 && dayNum <= 31) {
        const d = new Date(now.getFullYear(), month, dayNum)

        if (+d < +startOfDay(now) - 86_400_000 * 2) d.setFullYear(d.getFullYear() + 1)
        day = d
        eat(hit)
      }
    }
  }

  const dueExplicit = day != null || hour != null
  const base = day ?? (hour != null ? new Date(now) : addDays(now, 7))
  const due = startOfDay(base)
  due.setHours(hour ?? 23, hour != null ? minute : 59, 0, 0)

  if (!day && hour != null && +due < +now) due.setDate(due.getDate() + 1)

  let kind: TaskKind = 'assignment'
  for (const [re, k] of KIND_WORDS) {
    if (re.test(text)) {
      kind = k
      break
    }
  }

  let title = ''
  let cursor = 0
  const sorted = [...cuts].sort((a, b) => a.start - b.start)
  for (const c of sorted) {
    if (c.start >= cursor) {
      title += text.slice(cursor, c.start)
      cursor = c.end
    } else if (c.end > cursor) cursor = c.end
  }
  title += text.slice(cursor)
  title = title
    .replace(/\b(due|by|on|at|for|worth|next)\b/gi, ' ')
    .replace(/[\s,]+/g, ' ')
    .trim()

  if (!title) {
    title = kind === 'assignment' ? 'New task' : KIND_TITLES[kind]
  }
  title = title.charAt(0).toUpperCase() + title.slice(1)

  return { title, courseId, courseCode, kind, due, dueExplicit, weight, estimateMin }
}

const KIND_TITLES: Record<TaskKind, string> = {
  assignment: 'Assignment',
  personal: 'Personal task',
  essay: 'Essay',
  problemset: 'Problem set',
  project: 'Project',
  reading: 'Reading',
  quiz: 'Quiz / test prep',
  midterm: 'Midterm prep',
  final: 'Final prep',
  takehome: 'Take-home exam',
  lab: 'Lab',
  presentation: 'Presentation',
}
