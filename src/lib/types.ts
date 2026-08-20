export type ID = string

export type DayKey = string

export type Iso = string

export type ColorSlot = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8

export type PaletteId = 'sand' | 'slate' | 'ocean' | 'forest' | 'plum' | 'rose'

export type MeetingKind = 'lecture' | 'tutorial' | 'lab' | 'conference'

export interface Meeting {
  id: ID
  day: number
  start: number
  end: number
  kind: MeetingKind
  room?: string
}

export interface Course {
  id: ID
  code: string
  title?: string
  color: ColorSlot
  professor?: string
  room?: string
  currentGrade?: number
  targetGrade?: number
  meetings: Meeting[]
  midterm?: Iso
  final?: Iso
  archived?: boolean
  createdAt: Iso
}

export type TaskStatus = 'todo' | 'doing' | 'done'

export type TaskKind =
  | 'assignment'
  | 'essay'
  | 'problemset'
  | 'project'
  | 'reading'
  | 'quiz'
  | 'midterm'
  | 'final'
  | 'lab'
  | 'presentation'
  | 'personal'

export interface Subtask {
  id: ID
  title: string
  done: boolean
  due?: Iso
  estimateMin?: number
  completedAt?: Iso
  parentId?: ID
}

export interface Assignment {
  id: ID
  courseId: ID | null
  title: string
  kind: TaskKind
  due: Iso
  weight?: number
  status: TaskStatus
  estimateMin?: number
  subtasks: Subtask[]
  notes?: string
  grade?: number
  completedAt?: Iso
  createdAt: Iso
  private?: boolean
  breakdownDismissed?: boolean
  archived?: boolean
}

export interface BlockSegment {
  kind: 'prep' | 'focus' | 'break' | 'practice' | 'review' | 'wrap'
  minutes: number
  label: string
}

export interface StudyBlock {
  id: ID
  courseId: ID | null
  assignmentId: ID | null
  subtaskId?: ID | null
  title?: string
  start: Iso
  end: Iso
  done?: boolean
  plan?: BlockSegment[]
  locked?: boolean
  createdAt: Iso
}

export type SessionSource = 'pomodoro' | 'juststart' | 'manual' | 'block'

export interface Session {
  id: ID
  courseId: ID | null
  assignmentId: ID | null
  blockId?: ID | null
  start: Iso
  end?: Iso
  minutes: number
  source: SessionSource
  sittingId?: ID
  auto?: boolean
  createdAt: Iso
}

export interface TimerState {
  id: ID
  assignmentId: ID | null
  courseId: ID | null
  blockId: ID | null
  label?: string
  source: SessionSource
  startedAt: Iso
  phase: 'work' | 'break' | 'ready'
  runningSince: number | null
  phaseSec: number
  phaseTotalSec: number
  workedSec: number
  rounds: number
  justStart?: boolean
  plan?: BlockSegment[]
  planIndex?: number
  lastSeenAt: number
}

export interface Settings {
  name?: string
  addMode: 'quick' | 'detailed'
  focusMin: number
  shortBreakMin: number
  longBreakMin: number
  longBreakEvery: number
  dailyCapacityMin: number
  tone: 'gentle' | 'balanced' | 'blunt'
  theme: 'system' | 'light' | 'dark'
  palette: PaletteId
  dayStartHour: number
  dayEndHour: number
  sound: boolean
  termStart?: DayKey
  termEnd?: DayKey
  onboarded: boolean
  mutedNudges: Record<string, DayKey>
}

export interface TodayRef {
  assignmentId: ID
  day: DayKey
}

export interface ScheduleSlot {
  start: Iso
  end: Iso
  locked?: boolean
}

export interface TimeLog {
  id: ID
  start: Iso
  end?: Iso
  minutes: number
  source: SessionSource
  sittingId?: ID
  auto?: boolean
  createdAt: Iso
}

export type WorkStatus = 'todo' | 'doing' | 'done'

export interface WorkUnit {
  id: ID
  parentId: ID | null
  courseId: ID | null
  title: string
  kind: TaskKind | 'step' | 'sitting'
  due?: Iso
  weight?: number
  grade?: number
  status: WorkStatus
  estimateMin: number
  schedule?: ScheduleSlot | null
  plan?: BlockSegment[]
  logs: TimeLog[]
  notes?: string
  completedAt?: Iso
  createdAt: Iso
  updatedAt?: Iso
  private?: boolean
  breakdownDismissed?: boolean
  archived?: boolean
}

export interface AppState {
  version: number
  courses: Course[]
  assignments: Assignment[]
  blocks: StudyBlock[]
  sessions: Session[]
  units?: Record<ID, WorkUnit>
  todayList: TodayRef[]
  settings: Settings
  timer: TimerState | null
  isSample?: boolean
}
