class MemoryStorage implements Storage {
  private map = new Map<string, string>()
  get length() {
    return this.map.size
  }
  clear() {
    this.map.clear()
  }
  getItem(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null
  }
  key(i: number) {
    return Array.from(this.map.keys())[i] ?? null
  }
  removeItem(k: string) {
    this.map.delete(k)
  }
  setItem(k: string, v: string) {
    this.map.set(k, String(v))
  }
}

const storageWorks = (() => {
  try {
    globalThis.localStorage.setItem('__probe__', '1')
    const ok = globalThis.localStorage.getItem('__probe__') === '1'
    globalThis.localStorage.removeItem('__probe__')
    return ok
  } catch {
    return false
  }
})()
if (!storageWorks) {
  Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true })
}

const KEY = process.env.GEMINI_KEY?.trim() ?? ''
if (!KEY) {
  console.error('GEMINI_KEY is not set. Run via the wrapper so the key never reaches a transcript.')
  process.exit(2)
}
localStorage.setItem('nudge.ai.key.v1', KEY)

const PIN = process.env.PIN_MODEL?.trim() || 'gemini-3.5-flash-lite'
const SPACING_MS = Number(process.env.SPACING_MS ?? 3000)

const main = async () => {
  const { writeFileSync, mkdirSync } = await import('node:fs')
  const { ask, AiError } = await import('../src/lib/ai/client')
  const { buildContext, describePending } = await import('../src/lib/ai/context')
  const { systemPrompt, userTurn, budgetFor, thinkingFor } = await import('../src/lib/ai/prompt')
  const { ACTION_GROUPS, schemaFor } = await import('../src/lib/ai/schema')
  const { parseReply, validateReply } = await import('../src/lib/ai/validate')
  const { DEFAULT_PREFS } = await import('../src/lib/ai/config')
  const { DEFAULT_SETTINGS } = await import('../src/lib/store')
  const { rankAssignments, dayLoads, computeCalibration } = await import('../src/lib/priority')
  const { startOfDay } = await import('../src/lib/date')
  const type = await import('../src/lib/types')
  void type

  const NOW = new Date(2026, 7, 12, 14, 30, 0, 0).getTime()
  const iso = (y: number, m: number, d: number, hh = 23, mm = 59) => new Date(y, m - 1, d, hh, mm).toISOString()

  const SHORT_IDS = process.env.IDS === 'short'
  const ID: Record<string, string> = SHORT_IDS
    ? {
        webwork: 'a-webwork6',
        ps4: 'a-ps4',
        essay: 'a-essay',
        reading: 'a-reading',
        quiz2: 'a-quiz2',
        thu: 'b-thu',
        sat: 'b-sat',
        outline: 's-outline',
        draft: 's-draft',
        ww4: 'a-ww4',
        ww5: 'a-ww5',
        ww7: 'a-ww7',
        midterm: 'a-midterm',
        lab: 'a-lab',
        chemps: 'a-chemps',
        psycresp: 'a-psycresp',
        psycpaper: 'a-psycpaper',
        pres: 'a-pres',
        compquiz: 'a-compquiz',
      }
    : {
        webwork: '9f3c1a24-7b0e-4d55-8e21-6a4f0c9b2d17',
        ps4: '2d8e5f61-4c37-4a90-b1e8-53f7ac0d9e42',
        essay: '7a1b9c03-5e42-4f18-9d6a-08c3b5e71f94',
        reading: 'c4e07b58-1d93-4620-a7f5-9b2e6d48c013',
        quiz2: '1e6a4d70-8f25-49b3-84c7-2d9f0b63a851',
        thu: 'b52f8c19-6a04-4e77-9312-fd7c8b05e6a3',
        sat: '3c9d7e46-0b81-4a52-bf63-1e58d24a7c90',
        outline: '84fb2e07-9c15-4d38-a06b-7e3105c9f2d6',
        draft: 'd07c395a-2f68-41be-9047-6ba82e5c13f7',
        ww4: '6b48e2d1-9037-4c5a-8f21-a3e70d95c684',
        ww5: 'd2a70c95-3e18-4b6d-9a04-7c85f1e30b29',
        ww7: '05d9a3f7-c142-4e86-b39f-6817e2d40b5c',
        midterm: 'a83e5f1c-79b4-40d6-8237-e5c091ab64f7',
        lab: '4c1f7b90-2d63-4859-a71e-90b5c3e8f624',
        chemps: '9e25d0b8-6a34-4f79-91c2-70e5384bd1af',
        psycresp: '71b0f4a8-5c39-4d27-be16-08a3579e2cd4',
        psycpaper: '2f6c81b3-407d-49ea-95f8-c1d602a7b385',
        pres: 'ba39d570-16f2-4c48-8e05-7d94b6f31a2e',
        compquiz: '58e4a19c-0d76-4f31-b825-3ac7e9016db4',
      }

  type Course = Parameters<typeof buildContext>[0]['courses'][number]
  type Assignment = Parameters<typeof buildContext>[0]['assignments'][number]
  type StudyBlock = Parameters<typeof buildContext>[0]['blocks'][number]

  const courses: Course[] = [
    {
      id: 'c-comp',
      code: 'COMP 250',
      color: 1,
      meetings: [
        { id: 'm1', day: 1, start: 605, end: 685, kind: 'lecture' },
        { id: 'm2', day: 3, start: 605, end: 685, kind: 'lecture' },
      ],
      targetGrade: 85,
      createdAt: iso(2026, 1, 5),
    },
    {
      id: 'c-math',
      code: 'MATH 133',
      color: 2,
      meetings: [{ id: 'm3', day: 2, start: 510, end: 590, kind: 'lecture' }],
      targetGrade: 80,
      createdAt: iso(2026, 1, 5),
    },
    { id: 'c-poli', code: 'POLI 212', color: 4, meetings: [], targetGrade: 80, createdAt: iso(2026, 1, 5) },
  ]

  const assignments: Assignment[] = [
    {
      id: ID.webwork,
      courseId: 'c-math',
      title: 'WeBWorK 6',
      kind: 'problemset',
      due: iso(2026, 8, 14, 23, 59),
      weight: 4,
      status: 'todo',
      estimateMin: 90,
      subtasks: [],
      createdAt: iso(2026, 8, 1),
    },
    {
      id: ID.ps4,
      courseId: 'c-comp',
      title: 'Problem set 4',
      kind: 'problemset',
      due: iso(2026, 8, 17, 23, 59),
      weight: 8,
      status: 'todo',
      estimateMin: 180,
      subtasks: [],
      createdAt: iso(2026, 8, 1),
    },
    {
      id: ID.essay,
      courseId: 'c-poli',
      title: 'Term paper',
      kind: 'essay',
      due: iso(2026, 8, 21, 17, 0),
      weight: 25,
      status: 'todo',
      estimateMin: 600,
      subtasks: [
        { id: ID.outline, title: 'Outline the argument', done: false },
        { id: ID.draft, title: 'Draft section 1', done: false },
      ],
      createdAt: iso(2026, 8, 1),
    },
    {
      id: ID.quiz2,
      courseId: 'c-math',
      title: 'Quiz 2',
      kind: 'quiz',
      due: iso(2026, 8, 5),
      weight: 5,
      status: 'done',
      subtasks: [],
      completedAt: iso(2026, 8, 5),
      createdAt: iso(2026, 8, 1),
    },
    {
      id: ID.reading,
      courseId: 'c-poli',
      title: 'Chapter 7 reading',
      kind: 'reading',
      due: iso(2026, 8, 18, 23, 59),
      status: 'todo',
      estimateMin: 60,
      subtasks: [],
      createdAt: iso(2026, 8, 1),
    },
  ]

  if (process.env.HEAVY === '1') {
    courses.push(
      { id: 'c-psyc', code: 'PSYC 215', color: 5, meetings: [{ id: 'm4', day: 4, start: 780, end: 860, kind: 'lecture' }], targetGrade: 82, createdAt: iso(2026, 1, 5) },
      { id: 'c-chem', code: 'CHEM 110', color: 6, meetings: [{ id: 'm5', day: 1, start: 480, end: 560, kind: 'lecture' }, { id: 'm6', day: 5, start: 840, end: 980, kind: 'lab' }], targetGrade: 78, createdAt: iso(2026, 1, 5) },
    )
    const more: Assignment[] = [
      { id: ID.ww4, courseId: 'c-math', title: 'WeBWorK 4', kind: 'problemset', due: iso(2026, 8, 13, 23, 59), weight: 4, status: 'todo', estimateMin: 90, subtasks: [], createdAt: iso(2026, 7, 20) },
      { id: ID.ww5, courseId: 'c-math', title: 'WeBWorK 5', kind: 'problemset', due: iso(2026, 8, 13, 23, 59), weight: 4, status: 'todo', estimateMin: 90, subtasks: [], createdAt: iso(2026, 7, 27) },
      { id: ID.ww7, courseId: 'c-math', title: 'WeBWorK 7', kind: 'problemset', due: iso(2026, 8, 21, 23, 59), weight: 4, status: 'todo', estimateMin: 90, subtasks: [], createdAt: iso(2026, 8, 8) },
      { id: ID.midterm, courseId: 'c-math', title: 'MATH 133 midterm', kind: 'midterm', due: iso(2026, 8, 19, 14, 0), weight: 20, status: 'todo', estimateMin: 420, subtasks: [], createdAt: iso(2026, 8, 1) },
      { id: ID.lab, courseId: 'c-chem', title: 'Lab report 3', kind: 'lab', due: iso(2026, 8, 16, 23, 59), weight: 6, status: 'todo', estimateMin: 150, subtasks: [], createdAt: iso(2026, 8, 4) },
      { id: ID.chemps, courseId: 'c-chem', title: 'Chem problem set 5', kind: 'problemset', due: iso(2026, 8, 20, 23, 59), weight: 5, status: 'todo', estimateMin: 120, subtasks: [], createdAt: iso(2026, 8, 6) },
      { id: ID.psycresp, courseId: 'c-psyc', title: 'Reading response 4', kind: 'reading', due: iso(2026, 8, 15, 23, 59), weight: 3, status: 'todo', estimateMin: 75, subtasks: [], createdAt: iso(2026, 8, 5) },
      { id: ID.psycpaper, courseId: 'c-psyc', title: 'Research paper draft', kind: 'essay', due: iso(2026, 8, 24, 17, 0), weight: 20, status: 'todo', estimateMin: 480, subtasks: [], createdAt: iso(2026, 8, 1) },
      { id: ID.pres, courseId: 'c-comp', title: 'Group presentation', kind: 'presentation', due: iso(2026, 8, 26, 10, 5), weight: 10, status: 'todo', estimateMin: 240, subtasks: [], createdAt: iso(2026, 8, 2) },
      { id: ID.compquiz, courseId: 'c-comp', title: 'Quiz 5', kind: 'quiz', due: iso(2026, 8, 19, 23, 59), weight: 5, status: 'todo', estimateMin: 60, subtasks: [], createdAt: iso(2026, 8, 7) },
    ]
    assignments.push(...more)
  }

  const blocks: StudyBlock[] = [
    {
      id: ID.thu,
      courseId: 'c-comp',
      assignmentId: ID.ps4,
      start: new Date(2026, 7, 13, 19, 0).toISOString(),
      end: new Date(2026, 7, 13, 20, 30).toISOString(),
      createdAt: iso(2026, 8, 10),
    },
    {
      id: ID.sat,
      courseId: 'c-poli',
      assignmentId: ID.essay,
      start: new Date(2026, 7, 15, 14, 0).toISOString(),
      end: new Date(2026, 7, 15, 16, 0).toISOString(),
      createdAt: iso(2026, 8, 10),
    },
  ]

  const settings = { ...DEFAULT_SETTINGS, onboarded: true }

  const byAssignment = new Map<string, number>()
  const calibration = computeCalibration(assignments, byAssignment)
  const ranked = rankAssignments(assignments, {
    now: NOW,
    dailyCapacityMin: settings.dailyCapacityMin,
    studiedTodayMin: 0,
    courses,
    calibration,
    minutesByAssignment: byAssignment,
    staleByCourse: new Map(),
  })

  const context = buildContext({
    now: NOW,
    settings,
    courses,
    assignments,
    focusNotes: [
      {
        id: 'focus-recursion',
        text: 'I keep losing track of the base case when proving recursive algorithms.',
        courseId: 'c-comp',
        assignmentId: ID.ps4,
        createdAt: iso(2026, 8, 11, 18, 30),
      },
    ],
    blocks,
    plannerEvents: [],
    scheduleOverrides: [],
    ranked,
    loads: dayLoads(blocks, [], startOfDay(NOW), 7, settings.dailyCapacityMin),
    calibration,
    streak: 3,
    studiedTodayMin: 0,
    staleByCourse: new Map(),
    todayIds: new Set([ID.essay]),
    prefs: DEFAULT_PREFS,
  })

  const courseCodes = courses.map((c) => c.code)
  const system = systemPrompt(settings)
  const schema = schemaFor(courseCodes)

  const SURFACE = (process.env.SURFACE ?? 'ask') as Parameters<typeof budgetFor>[0]

  const turnFor = (request: string, pending?: string) =>
    userTurn({
      surface: SURFACE,
      context: context.text,
      request,
      pending,
      adjusting: !!pending,
    })

  const VARIANT = process.env.VARIANT ?? ''
  if (VARIANT.includes('no-requested')) {
    delete (schema.properties as Record<string, unknown>).requested
    schema.required = schema.required.filter((k: string) => k !== 'requested')
  }

  if (VARIANT.includes('optional-lists')) {
    const groups = new Set<string>(ACTION_GROUPS)
    schema.required = schema.required.filter((k: string) => !groups.has(k))
  }

  const realFetch = globalThis.fetch.bind(globalThis)
  let captured = false
  let capturedResponse = false

  const OUT = '.probe-runs'
  mkdirSync(OUT, { recursive: true })

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.body && typeof init.body === 'string') {
      const body = JSON.parse(init.body) as Record<string, unknown>
      body.model = PIN
      if (!captured) {
        captured = true
        writeFileSync(`${OUT}/envelope.json`, JSON.stringify(body, null, 2))
        writeFileSync(`${OUT}/envelope.system.txt`, String(body.system_instruction ?? ''))
        writeFileSync(`${OUT}/envelope.input.txt`, String(body.input ?? ''))
      }
      init = { ...init, body: JSON.stringify(body) }
    }
    const res = await realFetch(input as RequestInfo, init)

    if (!capturedResponse) {
      capturedResponse = true
      res
        .clone()
        .text()
        .then((t) => writeFileSync(`${OUT}/response.json`, t))
        .catch(() => {})
    }
    return res
  }) as typeof fetch

  interface Probe {
    name: string
    request: string

    want: string[]

    forbid?: string[]

    check?: (reply: Record<string, unknown>) => string | null
  }

  const notAnEmptyUpdate = (reply: Record<string, unknown>): string | null => {
    const list = Array.isArray(reply.update_tasks) ? (reply.update_tasks as Record<string, unknown>[]) : []
    for (const e of list) {
      const fields = Object.keys(e).filter((k) => k !== 'reason' && k !== 'taskId')
      if (!fields.length) return `update_tasks entry with a taskId and no fields (${JSON.stringify(e)})`
    }
    return null
  }

  const card =
    (kind: string, extra?: (v: Record<string, unknown>) => string | null) =>
    (reply: Record<string, unknown>): string | null => {
      const list = Array.isArray(reply.views) ? (reply.views as Record<string, unknown>[]) : []
      const hit = list.find((v) => v?.kind === kind)
      if (!hit) return `wanted a ${kind} card, got ${list.map((v) => String(v?.kind)).join(' + ') || 'none'}`
      if (list.length > 2) return `${list.length} cards for one question`
      return extra ? extra(hit) : null
    }

  const personal =
    (title: RegExp) =>
    (reply: Record<string, unknown>): string | null => {
      const list = Array.isArray(reply.create_tasks) ? (reply.create_tasks as Record<string, unknown>[]) : []
      const hit = list.find((t) => title.test(String(t?.title ?? '')))
      if (!hit) return `no task matching ${title}, got ${list.map((t) => String(t?.title)).join(' + ') || 'none'}`
      if (hit.courseCode !== 'NONE') return `filed under ${String(hit.courseCode)}, which is not a course it belongs to`
      if (hit.kind != null && hit.kind !== 'personal') return `typed "${String(hit.kind)}", which is coursework`

      if (typeof hit.weight === 'number' && hit.weight > 0)
        return `given a real grade weight of ${String(hit.weight)}% for a chore`
      return null
    }

  const onDays =
    (title: RegExp, days: string[]) =>
    (reply: Record<string, unknown>): string | null => {
      const list = Array.isArray(reply.create_tasks) ? (reply.create_tasks as Record<string, unknown>[]) : []
      const hit = list.find((t) => title.test(String(t?.title ?? '')))
      if (!hit) return null
      return days.includes(String(hit.date)) ? null : `dated ${String(hit.date)}, not ${days.join(' or ')}`
    }

  const SUITES: Record<string, Probe[]> = {

    views: [
      {
        name: 'forgot what is coming up',
        request: 'I forgot what I have coming up',
        want: ['views'],
        forbid: ['create_tasks', 'schedule_blocks'],
        check: card('agenda'),
      },
      {
        name: 'meeting times for one course',
        request: 'I forgot my meeting times for COMP 250',
        want: ['views'],
        check: card('timetable', (v) =>
          v.courseCode === 'COMP 250' ? null : `timetable not scoped to the course (courseCode=${String(v.courseCode)})`,
        ),
      },
      {
        name: 'every class, one card',
        request: 'Pull up the full class schedule for each of my classes',
        want: ['views'],
        check: card('timetable', (v) =>
          v.courseCode && v.courseCode !== 'NONE' ? `narrowed to ${String(v.courseCode)} when they asked for all` : null,
        ),
      },
      {
        name: 'remind me about this',
        request: 'Remind me about the term paper',
        want: ['views'],
        check: card('task'),
      },
      {
        name: 'what is left for one course',
        request: 'What do I still have left for MATH 133?',
        want: ['views'],
      },
      {
        name: 'how busy',
        request: 'How busy am I this week?',
        want: ['views'],
        check: card('workload'),
      },
      {
        name: 'one day',
        request: 'What have I got on Thursday?',
        want: ['views'],
        check: card('day'),
      },
      {
        name: 'how much have I studied',
        request: 'How much have I actually studied lately?',
        want: ['views'],
        check: card('progress'),
      },

      {
        name: 'advice takes no card',
        request: 'How should I revise for a midterm I have not started?',
        want: [],
        forbid: ['views', 'create_tasks', 'schedule_blocks'],
      },

      {
        name: 'change and show, together',
        request: 'Mark WeBWorK 6 done and show me what is left this week',
        want: ['completion', 'views'],
        check: notAnEmptyUpdate,
      },
    ],

    general: [
      {
        name: 'laundry reminder',
        request: 'Remind me to do my laundry',
        want: ['create_tasks'],
        check: personal(/laundry/i),
      },
      {
        name: 'chore with a day in it',
        request: 'Remind me to clean my room this weekend',
        want: ['create_tasks'],
        check: (reply) => personal(/room/i)(reply) ?? onDays(/room/i, ['2026-08-15', '2026-08-16'])(reply),
      },
      {
        name: 'set a timer',
        request: 'Set a timer for 25 minutes',
        want: ['commands'],
        forbid: ['create_tasks', 'schedule_blocks'],
        check: (reply) => {
          const list = Array.isArray(reply.commands) ? (reply.commands as Record<string, unknown>[]) : []
          const hit = list.find((c) => c?.action === 'start_focus')
          if (!hit) return `wanted start_focus, got ${list.map((c) => String(c?.action)).join(' + ') || 'none'}`
          return hit.minutes === 25 ? null : `timer set for ${String(hit.minutes)} minutes, not 25`
        },
      },
      {
        name: 'appointment',
        request: 'I have a dentist appointment on Thursday at 2, put it in',
        want: [],

        check: (reply) => {
          const tasks = Array.isArray(reply.create_tasks) ? (reply.create_tasks as Record<string, unknown>[]) : []
          if (tasks.some((t) => /dentist/i.test(String(t?.title ?? '')))) return personal(/dentist/i)(reply)
          const blocks = Array.isArray(reply.schedule_blocks) ? (reply.schedule_blocks as unknown[]) : []
          return blocks.length ? null : 'the appointment landed in nothing — neither a task nor a block'
        },
      },
      {
        name: 'chore onto the calendar',
        request: 'Find me an hour on Saturday to sort my room out',
        want: ['schedule_blocks'],
      },
      {
        name: 'personal and academic in one sentence',
        request: 'Add groceries to tomorrow and mark WeBWorK 6 done',
        want: ['create_tasks', 'completion'],
        check: notAnEmptyUpdate,
      },

      {
        name: 'method is not a task',
        request: 'How do I get a red wine stain out of a white shirt?',
        want: [],
        forbid: ['create_tasks', 'schedule_blocks', 'views'],
      },
    ],

    core: [
      {
        name: 'three-part / completion first',
        request: 'Mark WeBWorK 6 done, add a MATH 133 quiz next Friday worth 10%, and open the planner',
        want: ['completion', 'create_tasks', 'commands'],
        check: notAnEmptyUpdate,
      },
      {
        name: 'three-part / completion middle',
        request: 'Add a MATH 133 quiz next Friday worth 10%, mark WeBWorK 6 done, and open the planner',
        want: ['completion', 'create_tasks', 'commands'],
        check: notAnEmptyUpdate,
      },
      {
        name: 'three-part / completion last',
        request: 'Add a MATH 133 quiz next Friday worth 10%, open the planner, and mark WeBWorK 6 done',
        want: ['completion', 'create_tasks', 'commands'],
        check: notAnEmptyUpdate,
      },
      {
        name: 'two-part control',
        request: 'Mark WeBWorK 6 done and open the planner',
        want: ['completion', 'commands'],
        check: notAnEmptyUpdate,
      },
      {
        name: 'single-capability control',
        request: 'Mark WeBWorK 6 as done',
        want: ['completion'],
        forbid: ['create_tasks', 'commands'],
        check: notAnEmptyUpdate,
      },
      {
        name: 'mis-route regression / two completions',
        request: 'I already finished Chapter 7 reading, and I finished WeBWorK 6 too',
        want: ['completion'],
        check: notAnEmptyUpdate,
      },
    ],

    symptom: [
      {
        name: 'reported symptom',
        request: 'Mark WeBWorK 6 done, add a MATH 133 quiz next Friday worth 10%, and open the planner',
        want: ['completion', 'create_tasks', 'commands'],
        check: notAnEmptyUpdate,
      },
    ],

    hard: [
      {
        name: 'four-part compound',
        request:
          'Mark WeBWorK 6 done, add a MATH 133 quiz next Friday worth 10%, take the term paper off today, and open the planner',
        want: ['completion', 'create_tasks', 'today_list', 'commands'],
        check: notAnEmptyUpdate,
      },
      {
        name: 'take X off today, in a compound',
        request: 'Mark WeBWorK 6 done, take the term paper off today, and open the planner',
        want: ['completion', 'today_list', 'commands'],
        check: notAnEmptyUpdate,
      },
      {
        name: 'three parts, all needing ids',
        request:
          'Mark WeBWorK 6 done, move my Thursday study block to Friday at the same time, and put Chapter 7 reading on today’s list',
        want: ['completion', 'move_blocks', 'today_list'],
        check: notAnEmptyUpdate,
      },
    ],

    regress: [
      {
        name: 'settings alone',
        request: 'I can only study 2 hours a day',
        want: ['update_settings'],
        forbid: ['update_tasks', 'create_tasks'],
      },
      {
        name: 'delete alone',
        request: 'Delete the term paper, I dropped that class',
        want: ['delete_tasks'],
        forbid: ['update_tasks'],
      },
      {
        name: 'rename is still an update',
        request: 'Rename WeBWorK 6 to WeBWorK 6 (sections 3.1-3.4)',
        want: ['update_tasks'],
        forbid: ['create_tasks', 'delete_tasks'],
      },
      {
        name: 'deadline move is still an update',
        request: 'WeBWorK 6 got pushed to next Monday',
        want: ['update_tasks'],
        forbid: ['create_tasks'],
      },
      {
        name: 'course with meetings',
        request: 'Add PSYC 200, Tuesdays and Thursdays 10:00 to 11:30',
        want: ['create_courses'],
      },
      {
        name: 'rename plus completion',
        request: 'Rename Chapter 7 reading to Chapter 7-8 reading, and mark WeBWorK 6 done',
        want: ['completion', 'update_tasks'],
      },
    ],
  }

  const suiteName = process.argv[2] ?? 'core'
  const reps = Number(process.argv[3] ?? 3)
  const probes = SUITES[suiteName]
  if (!probes) {
    console.error(`Unknown suite "${suiteName}". Known: ${Object.keys(SUITES).join(', ')}`)
    process.exit(2)
  }

  const groupsPresent = (reply: Record<string, unknown>): string[] => {
    const out: string[] = []
    for (const g of ACTION_GROUPS) {
      const v = reply[g]
      if (Array.isArray(v) && v.length) out.push(g)
    }
    const doneEntry =
      (Array.isArray(reply.complete_tasks) && (reply.complete_tasks as Record<string, unknown>[]).length > 0) ||
      (Array.isArray(reply.update_tasks) &&
        (reply.update_tasks as Record<string, unknown>[]).some((e) => typeof e?.done === 'boolean'))
    if (doneEntry) out.push('completion')
    return out
  }

  const vstate = {
    assignments,
    courses,
    blocks,
    now: NOW,
    dayEndHour: settings.dayEndHour,
    dailyCapacityMin: settings.dailyCapacityMin,

    settings,
    todayIds: new Set([ID.essay]),
  }

  const WARMUP = 'Put two hours of term paper work on Sunday afternoon'
  const freshPending = async (): Promise<string | undefined> => {
    const res = await ask({
      system,
      input: turnFor(WARMUP),
      schema,
      maxOutputTokens: budgetFor(SURFACE),
      thinkingLevel: thinkingFor(SURFACE),
      timeoutMs: 60_000,
    })
    const v = validateReply(parseReply(res.text), vstate)
    if (!v?.proposals.length) return undefined
    return describePending(v.proposals, courses, assignments)
  }

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const transcript: { name: string; rep: number; request: string; reply: Record<string, unknown> }[] = []
  const results: {
    name: string
    rep: number
    ok: boolean
    groups: string[]
    requested: number
    missing: string[]
    extra: string[]
    note: string
    proposals: number
    rejected: string[]

    spentTokens: number
  }[] = []

  console.log(`\nsuite=${suiteName}  model=${PIN}  surface=${SURFACE}  variant=${VARIANT || 'none'}  heavy=${process.env.HEAVY === '1'}  reps=${reps}  cases=${probes.length}\n`)

  for (let rep = 1; rep <= reps; rep++) {
    for (const p of probes) {
      let line = ''
      try {
        const pending = process.env.PENDING === '1' ? await freshPending() : undefined
        if (pending) await sleep(SPACING_MS)
        const res = await ask({
          system,
          input: turnFor(p.request, pending),
          schema,
          maxOutputTokens: budgetFor(SURFACE),
          thinkingLevel: thinkingFor(SURFACE),
          timeoutMs: 60_000,
        })
        let parsed: Record<string, unknown> | null = null
        try {
          parsed = JSON.parse(res.text) as Record<string, unknown>
        } catch {
          parsed = null
        }
        if (!parsed) {
          results.push({
            name: p.name,
            rep,
            ok: false,
            groups: [],
            requested: 0,
            missing: p.want,
            extra: [],
            note: 'UNPARSEABLE',
            proposals: 0,
            rejected: [],
            spentTokens: (res.tokens?.output ?? 0) + (res.tokens?.thought ?? 0),
          })
          writeFileSync(`${OUT}/unparseable-${Date.now()}.txt`, res.text)
          line = `  ✗ ${p.name} #${rep} — unparseable reply (saved)`
          console.log(line)
          await sleep(SPACING_MS)
          continue
        }

        transcript.push({ name: p.name, rep, request: p.request, reply: parsed })

        const groups = groupsPresent(parsed)
        const missing = p.want.filter((w) => !groups.includes(w))
        const extra = (p.forbid ?? []).filter((f) => groups.includes(f))
        const note = p.check?.(parsed) ?? ''
        const requested = Array.isArray(parsed.requested) ? (parsed.requested as unknown[]).length : 0

        const validated = validateReply(parseReply(res.text), vstate)

        const ok = !missing.length && !extra.length && !note
        results.push({
          name: p.name,
          rep,
          ok,
          groups,
          requested,
          missing,
          extra,
          note,
          proposals: validated?.proposals.length ?? 0,
          rejected: validated?.rejected.map((r) => `${r.type}: ${r.why}`) ?? [],
          spentTokens: (res.tokens?.output ?? 0) + (res.tokens?.thought ?? 0),
        })
        line = `  ${ok ? '✓' : '✗'} ${p.name} #${rep} — requested:${requested} groups:[${groups.join(', ')}]${
          missing.length ? ` MISSING:[${missing.join(', ')}]` : ''
        }${extra.length ? ` UNWANTED:[${extra.join(', ')}]` : ''}${note ? ` NOTE: ${note}` : ''} → ${
          validated?.proposals.length ?? 0
        } proposals${validated?.rejected.length ? `, ${validated.rejected.length} rejected` : ''}`
        console.log(line)
      } catch (e) {
        const kind = e instanceof AiError ? e.kind : 'unknown'
        results.push({
          name: p.name,
          rep,
          ok: false,
          groups: [],
          requested: 0,
          missing: p.want,
          extra: [],
          note: `ERROR ${kind}`,
          proposals: 0,
          rejected: [],
        })
        console.log(`  ! ${p.name} #${rep} — ${kind}: ${(e as Error).message}`)
      }
      await sleep(SPACING_MS)
    }
  }

  console.log('\n--- summary ---')
  const byName = new Map<string, typeof results>()
  for (const r of results) {
    const arr = byName.get(r.name) ?? []
    arr.push(r)
    byName.set(r.name, arr)
  }
  let allOk = true
  for (const [name, rs] of byName) {
    const passed = rs.filter((r) => r.ok).length
    if (passed !== rs.length) allOk = false
    const misses = [...new Set(rs.flatMap((r) => r.missing))]
    const notes = [...new Set(rs.map((r) => r.note).filter(Boolean))]
    console.log(
      `  ${passed}/${rs.length}  ${name}${misses.length ? `   missing: ${misses.join(', ')}` : ''}${
        notes.length ? `   ${notes.join(' | ')}` : ''
      }`,
    )
  }
  const total = results.filter((r) => r.ok).length
  console.log(`\n${total}/${results.length} passed`)

  const budget = budgetFor(SURFACE)
  const spends = results.map((r) => r.spentTokens).filter((n) => n > 0)
  if (spends.length) {
    const peak = Math.max(...spends)
    const mean = Math.round(spends.reduce((a, b) => a + b, 0) / spends.length)
    const worst = results.find((r) => r.spentTokens === peak)
    console.log(
      `thought+output: peak ${peak}/${budget} (${Math.round((peak / budget) * 100)}%) on "${worst?.name}", mean ${mean}\n`,
    )
  } else {
    console.log('')
  }
  const stamp = `${suiteName}-${SURFACE}${VARIANT ? `-${VARIANT}` : ''}-${Date.now()}`
  writeFileSync(`${OUT}/results-${stamp}.json`, JSON.stringify(results, null, 2))
  writeFileSync(`${OUT}/transcript-${stamp}.json`, JSON.stringify(transcript, null, 2))
  process.exit(allOk ? 0 : 1)
}

void main()
