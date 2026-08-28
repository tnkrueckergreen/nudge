import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type {
  Assignment,
  AppState,
  BlockSegment,
  ColorSlot,
  Course,
  ID,
  MeetingKind,
  PlannerEvent,
  ScheduleSlot,
  ScheduleOverride,
  Session,
  Settings,
  StudyBlock,
  Subtask,
  TaskKind,
  WorkStatus,
  WorkUnit,
} from './types'
import { uid } from './id'
import {
  MIN_LOGGABLE_MIN,
  STALE_MS,
  completePhase,
  readHeartbeat,
  recover,
  sessionFrom,
  settle,
  toWork,
  type Recovery,
} from './timer'
import { dayKey, minutesOfDay } from './date'
import { proposeBreakdown, defaultEffort } from './priority'
import { pruneMutes } from './nudges'
import { findGapOnDay } from './autoSchedule'
import { placeSteps, releaseSteps, repoint, replaceTaskPlan } from './steps'
import { DEFAULT_PALETTE, isPaletteId } from './theme'
import {
  stateToUnits,
  unitsToRelational,
  transitionUnitStatus,
  isAutoLog,
  mergeProjectedSessions,
  syncAssignmentsFromUnits,
  syncBlocksFromUnits,
  sessionCreditsBlock,
  applyCompositeStatus,
  reconcileUnitClosures,
  rootDeliverableId,
  stampCompletions,
} from './workEngine'

const STORAGE_KEY = 'nudge.state.v1'

export type StorageTrouble = 'full' | 'unavailable'

let storageTrouble: StorageTrouble | null = null
const storageListeners = new Set<(trouble: StorageTrouble | null) => void>()

/** Whether the last attempt to save ran into trouble, and a way to hear about
 *  it. Saving is best-effort — it must never take an action down with it. */
export const readStorageTrouble = (): StorageTrouble | null => storageTrouble
export function onStorageTrouble(fn: (trouble: StorageTrouble | null) => void): () => void {
  storageListeners.add(fn)
  return () => storageListeners.delete(fn)
}
function setStorageTrouble(next: StorageTrouble | null) {
  if (storageTrouble === next) return
  storageTrouble = next
  for (const fn of storageListeners) fn(next)
}

const isQuotaError = (e: unknown): boolean => {
  const name = (e as { name?: string } | null)?.name ?? ''
  const code = (e as { code?: number } | null)?.code
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || code === 22 || code === 1014
}

/**
 * localStorage, but a failed write is reported rather than thrown. Zustand
 * calls setItem synchronously inside `set`, so an exception here would escape
 * the store action it came from and abort the click that caused it.
 *
 * Throws when there is no usable storage at all, which is what
 * `createJSONStorage` expects: it catches that and runs the store unpersisted.
 */
function resolveStorage(): Storage {
  const base = (globalThis as { localStorage?: Storage }).localStorage
  if (!base) throw new Error('no localStorage')
  return {
    get length() {
      try {
        return base.length
      } catch {
        return 0
      }
    },
    clear: () => {
      try {
        base.clear()
      } catch {

      }
    },
    key: (i: number) => {
      try {
        return base.key(i)
      } catch {
        return null
      }
    },
    getItem: (k: string) => {
      try {
        return base.getItem(k)
      } catch {
        return null
      }
    },
    removeItem: (k: string) => {
      try {
        base.removeItem(k)
      } catch {

      }
    },
    setItem: (k: string, v: string) => {
      try {
        base.setItem(k, v)
        setStorageTrouble(null)
      } catch (e) {
        setStorageTrouble(isQuotaError(e) ? 'full' : 'unavailable')
      }
    },
  }
}

export const DEFAULT_SETTINGS: Settings = {
  focusMin: 25,
  shortBreakMin: 5,
  longBreakMin: 15,
  longBreakEvery: 4,
  dailyCapacityMin: 210,
  tone: 'balanced',
  theme: 'system',
  palette: DEFAULT_PALETTE,
  addMode: 'quick',
  dayStartHour: 7,
  dayEndHour: 23,
  sound: true,
  onboarded: false,
  mutedNudges: {},
}

const EMPTY: AppState = {
  version: 3,
  courses: [],
  assignments: [],
  blocks: [],
  plannerEvents: [],
  scheduleOverrides: [],
  sessions: [],
  units: {},
  todayList: [],
  settings: DEFAULT_SETTINGS,
  timer: null,
}

type Snapshot = Pick<
  AppState,
  'courses' | 'assignments' | 'blocks' | 'plannerEvents' | 'scheduleOverrides' | 'sessions' | 'todayList' | 'units'
>

interface UndoEntry {
  label: string
  snapshot: Snapshot
  at: number
}

export interface NudgeStore extends AppState {
  getUnits(): Record<ID, WorkUnit>
  setUnitStatus(id: ID, status: WorkStatus): void
  scheduleUnit(id: ID, slot: ScheduleSlot | null): void
  createUnit(input: Partial<WorkUnit> & { title: string }): WorkUnit
  removeUnit(id: ID): void

  addCourse(input: Partial<Course> & { code: string }): Course
  updateCourse(id: ID, patch: Partial<Course>): void

  setCourseArchived(id: ID, archived: boolean): void
  removeCourse(id: ID): void

  addAssignment(input: Partial<Assignment> & { title: string; due: string }): Assignment
  updateAssignment(id: ID, patch: Partial<Assignment>): void
  setAssignmentStatus(id: ID, status: Assignment['status']): void
  removeAssignment(id: ID): void

  addSubtask(assignmentId: ID, input: Partial<Subtask> & { title: string }): void
  updateSubtask(assignmentId: ID, subtaskId: ID, patch: Partial<Subtask>): void
  removeSubtask(assignmentId: ID, subtaskId: ID): void
  applyBreakdown(assignmentId: ID, totalMin: number): { steps: number; blocks: number; replaced: number }
  dismissBreakdown(assignmentId: ID): void

  addBlock(input: Partial<StudyBlock> & { start: string; end: string }): StudyBlock
  updateBlock(id: ID, patch: Partial<StudyBlock>): void
  moveBlock(id: ID, startMs: number, endMs: number): void

  duplicateBlock(id: ID): StudyBlock | null
  removeBlock(id: ID): void
  toggleBlockDone(id: ID): void

  addPlannerEvent(
    input: Partial<PlannerEvent> & {
      title: string
      kind: PlannerEvent['kind']
      start: string
      end: string
      allDay: boolean
    },
  ): PlannerEvent
  updatePlannerEvent(id: ID, patch: Partial<PlannerEvent>): void
  removePlannerEvent(id: ID): void
  upsertScheduleOverride(input: Omit<ScheduleOverride, 'id' | 'createdAt'>): ScheduleOverride
  removeScheduleOverride(id: ID): void

  logSession(input: Partial<Session> & { minutes: number }): void

  startSitting(input: {
    assignmentId: ID | null
    courseId: ID | null
    blockId: ID | null
    minutes: number
    justStart?: boolean
    label?: string

    plan?: BlockSegment[]
  }): void
  pauseTimer(): void
  resumeTimer(): void

  completeTimerPhase(): void

  startNextRound(): void

  endSitting(opts?: { finish?: boolean }): { minutes: number; totalMin: number } | null

  settleTimer(at?: number): void

  reconcileTimer(): Recovery | null

  addToToday(assignmentId: ID): void
  removeFromToday(assignmentId: ID): void
  reorderToday(from: number, to: number): void
  clearDoneFromToday(): void

  muteNudge(id: string): void
  updateSettings(patch: Partial<Settings>): void

  undo(): boolean
  pushUndo(label: string): void
  loadSample(): void
  resetAll(): void
  importState(next: Partial<AppState>): void
}

let undoStack: UndoEntry[] = []

const snapshotOf = (s: AppState): Snapshot => ({
  courses: s.courses,
  assignments: s.assignments,
  blocks: s.blocks,
  plannerEvents: s.plannerEvents,
  scheduleOverrides: s.scheduleOverrides,
  sessions: s.sessions,
  units: s.units ?? {},
  todayList: s.todayList,
})

const nextColor = (courses: Course[]): ColorSlot => {
  const used = new Set(courses.map((c) => c.color))
  for (let i = 1; i <= 8; i++) if (!used.has(i as ColorSlot)) return i as ColorSlot
  return ((courses.length % 8) + 1) as ColorSlot
}

export function syncBlockSessions(
  blocks: StudyBlock[],
  sessions: Session[],
  targetBlockIds: Set<ID>,
  done: boolean,
  nowIso: string,
): Session[] {
  const isAuto = (x: Session) => isAutoLog(x)
  if (!done) {
    return sessions.filter((x) => !(x.blockId && targetBlockIds.has(x.blockId) && isAuto(x)))
  }
  const added: Session[] = []
  for (const b of blocks) {
    if (!targetBlockIds.has(b.id) || b.done) continue
    const planned = Math.round((+new Date(b.end) - +new Date(b.start)) / 60000)
    const tracked = sessions.reduce(
      (sum, x) =>
        sessionCreditsBlock(x, b) && Number.isFinite(x.minutes) && x.minutes >= 0 ? sum + x.minutes : sum,
      0,
    )
    const topUp = Math.round((planned - tracked) * 10) / 10
    if (topUp >= MIN_LOGGABLE_MIN) {
      added.push({
        id: uid(),
        courseId: b.courseId,
        assignmentId: b.assignmentId,
        blockId: b.id,
        start: b.start,
        end: b.end,
        minutes: topUp,
        source: 'block',
        auto: true,
        createdAt: nowIso,
      })
    }
  }
  return added.length ? [...sessions, ...added] : sessions
}

export function normalizeCode(raw: string): string {
  const t = raw.trim().toUpperCase().replace(/[-_]+/g, ' ')
  const m = t.match(/^([A-Z]{2,5})\s*([0-9]{2,3}[A-Z]?[0-9]?)$/)
  if (m) return `${m[1]} ${m[2]}`
  return t.replace(/\s+/g, ' ')
}

interface LegacyTimer {
  mode?: string
  endsAt?: number
  totalSec?: number
  pausedSec?: number | null
  assignmentId?: ID | null
  courseId?: ID | null
  blockId?: ID | null
  justStart?: boolean
}

function withRecovery<T extends Pick<AppState, 'sessions' | 'assignments' | 'timer'>>(state: T, r: Recovery): T {
  const next: T = { ...state, timer: r.timer }
  if (r.session && !state.sessions.some((x) => x.sittingId === r.session!.sittingId)) {
    next.sessions = [...state.sessions, { id: uid(), ...r.session }]
    next.assignments = state.assignments.map((a) =>
      a.id === r.session!.assignmentId && a.status === 'todo' ? { ...a, status: 'doing' as const } : a,
    )
  }
  return next
}

let pendingRecovery: Recovery | null = null

export function takeTimerRecovery(): Recovery | null {
  const r = pendingRecovery
  pendingRecovery = null
  return r
}

export const useStore = create<NudgeStore>()(
  persist(
    (set, get) => {
      const mutate = (label: string, fn: (s: AppState) => Partial<AppState>) => {
        const before = get()
        const at = new Date().toISOString()
        undoStack.push({ label, snapshot: snapshotOf(before), at: Date.now() })
        if (undoStack.length > 40) undoStack.shift()
        const changes = fn(before)
        const nextState = { ...before, ...changes }
        const unitsTouched = !!(changes.units || changes.assignments || changes.blocks || changes.sessions)
        if ((changes.assignments || changes.blocks || changes.sessions) && !changes.units) {
          nextState.units = stateToUnits(nextState)
        }
        if (nextState.units && unitsTouched) {
          const priorUnits =
            before.units && Object.keys(before.units).length > 0 ? before.units : stateToUnits(before)
          nextState.units = reconcileUnitClosures(
            applyCompositeStatus({ ...nextState.units }),
            priorUnits,
            at,
          )
          const rel = unitsToRelational(nextState.units)
          nextState.sessions = mergeProjectedSessions(
            rel.sessions,
            nextState.sessions ?? before.sessions,
            priorUnits,
            nextState.units,
          )
          nextState.blocks = syncBlocksFromUnits(nextState.blocks ?? before.blocks, nextState.units)
          nextState.assignments = syncAssignmentsFromUnits(nextState.assignments, nextState.units, at)
        } else if (nextState.units) {
          nextState.assignments = syncAssignmentsFromUnits(nextState.assignments, nextState.units, at)
        }
        set(nextState as never)
      }

      return {
        ...EMPTY,

        getUnits() {
          return stateToUnits(get())
        },

        setUnitStatus(id, status) {
          const at = new Date().toISOString()
          mutate(status === 'done' ? 'Completed unit' : 'Reopened unit', (s) => {
            const currentUnits = stateToUnits(s)
            const nextUnits = transitionUnitStatus(currentUnits, id, status, at)
            const relational = unitsToRelational(nextUnits)
            return {
              units: nextUnits,
              assignments: relational.assignments,
              blocks: relational.blocks,
              sessions: mergeProjectedSessions(relational.sessions, s.sessions, currentUnits, nextUnits),
            }
          })
        },

        scheduleUnit(id, slot) {
          mutate('Updated schedule', (s) => {
            const currentUnits = stateToUnits(s)
            const target = currentUnits[id]
            if (!target) return s
            currentUnits[id] = { ...target, schedule: slot, updatedAt: new Date().toISOString() }
            const relational = unitsToRelational(currentUnits)
            return {
              units: currentUnits,
              assignments: relational.assignments,
              blocks: relational.blocks,
              sessions: mergeProjectedSessions(relational.sessions, s.sessions, stateToUnits(s), currentUnits),
            }
          })
        },

        createUnit(input) {
          const now = new Date().toISOString()
          const id = input.id ?? uid()
          const existingUnits = get().getUnits()
          const parentId = input.parentId && existingUnits[input.parentId] ? input.parentId : null
          // A child belongs to its parent's course. Without this the new unit
          // starts with none and the next recompute silently corrects it,
          // leaving the stored graph disagreeing with itself in between.
          const courseId = input.courseId ?? (parentId ? existingUnits[parentId].courseId : null)
          const schedule = input.schedule ?? null
          const fromSlot =
            schedule != null
              ? Math.round((+new Date(schedule.end) - +new Date(schedule.start)) / 60000)
              : undefined
          const estimateMin =
            input.estimateMin ??
            (fromSlot != null && Number.isFinite(fromSlot) ? Math.max(0, fromSlot) : parentId ? 45 : 60)
          const kind = input.kind ?? (parentId ? 'step' : 'assignment')
          const unit: WorkUnit = {
            id,
            parentId,
            courseId,
            title: input.title.trim(),
            kind: !parentId && kind === 'step' ? 'assignment' : kind,
            estimateMin,
            due: input.due,
            status: input.status ?? 'todo',
            schedule,
            plan: input.plan,
            logs: input.logs ?? [],
            createdAt: now,
            updatedAt: now,
            notes: input.notes,
            weight: input.weight,
            grade: input.grade,
            private: input.private,
            archived: input.archived,
            breakdownDismissed: input.breakdownDismissed,
            completedAt: input.completedAt,
          }
          mutate('Created work unit', (s) => {
            const priorUnits = stateToUnits(s)
            const currentUnits = { ...priorUnits, [id]: unit }
            const relational = unitsToRelational(currentUnits)
            return {
              units: currentUnits,
              assignments: relational.assignments,
              blocks: relational.blocks,
              sessions: mergeProjectedSessions(relational.sessions, s.sessions, priorUnits, currentUnits),
            }
          })
          return unit
        },

        removeUnit(id) {
          const running = get().timer
          if (running) {
            const units = stateToUnits(get())
            const gone = new Set<ID>()
            const walk = (targetId: ID) => {
              if (gone.has(targetId)) return
              gone.add(targetId)
              Object.values(units)
                .filter((u) => u.parentId === targetId)
                .forEach((child) => walk(child.id))
            }
            walk(id)
            if (
              (running.assignmentId && gone.has(running.assignmentId)) ||
              (running.blockId && gone.has(running.blockId))
            ) {
              get().endSitting()
            }
          }
          mutate('Removed work unit', (s) => {
            const currentUnits = stateToUnits(s)
            const deleteSubtree = (targetId: ID, visited = new Set<ID>()) => {
              if (visited.has(targetId)) return
              visited.add(targetId)
              Object.values(currentUnits)
                .filter((u) => u.parentId === targetId)
                .forEach((child) => deleteSubtree(child.id, visited))
              delete currentUnits[targetId]
            }
            deleteSubtree(id)
            const relational = unitsToRelational(currentUnits)
            return {
              units: currentUnits,
              assignments: relational.assignments,
              blocks: relational.blocks,
              sessions: mergeProjectedSessions(relational.sessions, s.sessions, stateToUnits(s), currentUnits),
            }
          })
        },

        addCourse(input) {
          const course: Course = {
            id: uid(),
            code: normalizeCode(input.code),
            title: input.title,
            color: input.color ?? nextColor(get().courses),
            professor: input.professor,
            room: input.room,
            currentGrade: input.currentGrade,
            targetGrade: input.targetGrade ?? 85,
            meetings: input.meetings ?? [],
            midterm: input.midterm,
            final: input.final,
            createdAt: new Date().toISOString(),
          }
          mutate('Added course', (s) => ({ courses: [...s.courses, course] }))
          return course
        },
        updateCourse(id, patch) {
          mutate('Updated course', (s) => ({
            courses: s.courses.map((c) =>
              c.id === id ? { ...c, ...patch, code: patch.code ? normalizeCode(patch.code) : c.code } : c,
            ),
          }))
        },

        setCourseArchived(id, archived) {
          const code = get().courses.find((c) => c.id === id)?.code ?? 'course'
          mutate(archived ? `Archived ${code}` : `Restored ${code}`, (s) => ({
            courses: s.courses.map((c) => (c.id === id ? { ...c, archived: archived || undefined } : c)),
          }))
        },
        removeCourse(id) {
          const running = get().timer
          if (running && running.courseId === id) get().endSitting()
          mutate('Deleted course', (s) => {
            // A block keeps the course it was made under, so moving a task to
            // another course splits the two. Blocks that survive on their own
            // course still have to let go of the tasks going away with this one.
            const goneTaskIds = new Set(s.assignments.filter((a) => a.courseId === id).map((a) => a.id))
            const goneBlockIds = new Set(s.blocks.filter((b) => b.courseId === id).map((b) => b.id))
            return {
              courses: s.courses.filter((c) => c.id !== id),
              assignments: s.assignments.filter((a) => a.courseId !== id),
              blocks: s.blocks
                .filter((b) => b.courseId !== id)
                .map((b) =>
                  b.assignmentId && goneTaskIds.has(b.assignmentId)
                    ? { ...b, assignmentId: null, subtaskId: null }
                    : b,
                ),
              sessions: s.sessions
                .filter((x) => !(x.blockId && goneBlockIds.has(x.blockId) && isAutoLog(x)))
                .map((x) => {
                  const blockId = x.blockId && goneBlockIds.has(x.blockId) ? null : x.blockId
                  const assignmentId = x.assignmentId && goneTaskIds.has(x.assignmentId) ? null : x.assignmentId
                  return blockId === x.blockId && assignmentId === x.assignmentId
                    ? x
                    : { ...x, blockId, assignmentId }
                }),
              todayList: s.todayList.filter(
                (t) => !s.assignments.some((a) => a.id === t.assignmentId && a.courseId === id),
              ),
            }
          })
        },

        addAssignment(input) {
          const kind: TaskKind = input.kind ?? 'assignment'
          const a: Assignment = {
            id: uid(),
            courseId: input.courseId ?? null,
            title: input.title.trim(),
            kind,
            due: input.due,
            weight: input.weight,
            status: input.status ?? 'todo',
            estimateMin: input.estimateMin ?? defaultEffort({ kind, weight: input.weight }),
            subtasks: input.subtasks ?? [],
            notes: input.notes,
            grade: input.grade,
            createdAt: input.createdAt ?? new Date().toISOString(),
            private: input.private,
            archived: input.archived,
            completedAt: input.completedAt,
            breakdownDismissed: input.breakdownDismissed,
          }
          mutate('Added task', (s) => ({ assignments: [...s.assignments, a] }))
          return a
        },
        updateAssignment(id, patch) {
          mutate('Updated task', (s) => ({
            assignments: s.assignments.map((a) => (a.id === id ? { ...a, ...patch } : a)),
          }))
        },
        setAssignmentStatus(id, status) {
          const running = get().timer
          if (running && running.assignmentId === id && status === 'done') get().endSitting()
          const at = new Date().toISOString()
          mutate(status === 'done' ? 'Completed task' : 'Changed status', (s) => {
            const current = s.assignments.find((a) => a.id === id)
            if (!current) return s
            const isCompleting = status === 'done' && current.status !== 'done'
            const isReopening = status !== 'done' && current.status === 'done'
            const targetBlockIds = new Set(
              s.blocks.filter((b) => b.assignmentId === id || b.id === id).map((b) => b.id),
            )
            const assignments = s.assignments.map((a) =>
              a.id === id
                ? {
                    ...a,
                    status,
                    completedAt: status === 'done' ? at : undefined,
                    subtasks: isCompleting
                      ? a.subtasks.map((t) => ({ ...t, done: true, completedAt: t.done ? t.completedAt : at }))
                      : isReopening
                        ? a.subtasks.map((t) => ({ ...t, done: false, completedAt: undefined }))
                        : a.subtasks,
                  }
                : a,
            )
            if (!isCompleting && !isReopening) return { assignments }
            const blocks =
              targetBlockIds.size > 0
                ? s.blocks.map((b) => (targetBlockIds.has(b.id) ? { ...b, done: isCompleting } : b))
                : s.blocks
            const sessions =
              targetBlockIds.size > 0
                ? syncBlockSessions(s.blocks, s.sessions, targetBlockIds, isCompleting, at)
                : s.sessions
            return { assignments, blocks, sessions }
          })
        },
        removeAssignment(id) {
          const running = get().timer
          if (running && running.assignmentId === id) get().endSitting()
          mutate('Deleted task', (s) => ({
            assignments: s.assignments.filter((a) => a.id !== id),
            blocks: s.blocks.map((b) =>
              b.assignmentId === id ? { ...b, assignmentId: null, subtaskId: null } : b,
            ),
            // Time spent still counts towards the course and the streak; it
            // just stops naming a task that is no longer there.
            sessions: s.sessions.map((x) => (x.assignmentId === id ? { ...x, assignmentId: null } : x)),
            todayList: s.todayList.filter((t) => t.assignmentId !== id),
          }))
        },

        addSubtask(assignmentId, input) {
          mutate('Added step', (s) => ({
            assignments: s.assignments.map((a) =>
              a.id === assignmentId
                ? {
                    ...a,
                    subtasks: [
                      ...a.subtasks,
                      { id: uid(), title: input.title.trim(), done: false, due: input.due, estimateMin: input.estimateMin },
                    ],
                  }
                : a,
            ),
          }))
        },
        updateSubtask(assignmentId, subtaskId, patch) {
          const at = new Date().toISOString()
          mutate('Updated step', (s) => {
            const targetBlockIds = new Set(
              patch.done != null
                ? s.blocks.filter((b) => b.subtaskId === subtaskId).map((b) => b.id)
                : [],
            )
            return {
              assignments: s.assignments.map((a) =>
                a.id === assignmentId
                  ? {
                      ...a,
                      subtasks: a.subtasks.map((t) =>
                        t.id === subtaskId
                          ? {
                              ...t,
                              ...patch,
                              completedAt:
                                patch.done === true
                                  ? at
                                  : patch.done === false
                                    ? undefined
                                    : t.completedAt,
                            }
                          : t,
                      ),
                      status: patch.done && a.status === 'todo' ? 'doing' : a.status,
                    }
                  : a,
              ),
              blocks:
                patch.done == null
                  ? s.blocks
                  : s.blocks.map((b) => (b.subtaskId === subtaskId ? { ...b, done: patch.done } : b)),
              sessions:
                patch.done != null && targetBlockIds.size > 0
                  ? syncBlockSessions(s.blocks, s.sessions, targetBlockIds, patch.done, at)
                  : s.sessions,
            }
          })
        },
        removeSubtask(assignmentId, subtaskId) {
          mutate('Deleted step', (s) => ({
            assignments: s.assignments.map((a) =>
              a.id === assignmentId ? { ...a, subtasks: a.subtasks.filter((t) => t.id !== subtaskId) } : a,
            ),
            blocks: releaseSteps(s.blocks, new Set([subtaskId]), Date.now()),
          }))
        },
        applyBreakdown(assignmentId, totalMin) {
          const st = get()
          const a = st.assignments.find((x) => x.id === assignmentId)
          if (!a) return { steps: 0, blocks: 0, replaced: 0 }

          const now = Date.now()
          const kept = replaceTaskPlan(st.blocks, a.id, new Set(a.subtasks.map((t) => t.id)), now)
          const { subtasks, blocks } = placeSteps({
            assignment: a,
            steps: proposeBreakdown(a, totalMin, now),
            blocks: kept,
            courses: st.courses,
            settings: st.settings,
            now,
          })
          mutate('Broke task into steps', (s) => ({
            assignments: s.assignments.map((x) =>
              x.id === assignmentId ? { ...x, subtasks: [...x.subtasks, ...subtasks] } : x,
            ),
            blocks: [...kept, ...blocks],
          }))
          return { steps: subtasks.length, blocks: blocks.length, replaced: st.blocks.length - kept.length }
        },
        dismissBreakdown(assignmentId) {
          set((s) => {
            const assignments = s.assignments.map((a) =>
              a.id === assignmentId ? { ...a, breakdownDismissed: true } : a,
            )
            return {
              assignments,
              units: stateToUnits({ ...s, assignments }),
            }
          })
        },

        addBlock(input) {
          const b: StudyBlock = {
            id: uid(),
            courseId: input.courseId ?? null,
            assignmentId: input.assignmentId ?? null,
            subtaskId: input.subtaskId ?? null,
            title: input.title,
            start: input.start,
            end: input.end,
            done: input.done ?? false,
            plan: input.plan,
            createdAt: new Date().toISOString(),
          }
          mutate('Added study block', (s) => ({ blocks: [...s.blocks, b] }))
          return b
        },
        updateBlock(id, patch) {
          mutate('Updated block', (s) => ({
            blocks: s.blocks.map((b) => (b.id === id ? { ...b, ...repoint(b, patch) } : b)),
          }))
        },

        moveBlock(id, startMs, endMs) {
          mutate('Moved block', (s) => ({
            blocks: s.blocks.map((b) =>
              b.id === id ? { ...b, start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString() } : b,
            ),
          }))
        },

        duplicateBlock(id) {
          const { blocks, courses, plannerEvents, scheduleOverrides, settings } = get()
          const src = blocks.find((b) => b.id === id)
          if (!src) return null
          const startMs = +new Date(src.start)
          const durationMin = Math.round((+new Date(src.end) - startMs) / 60_000)

          const slot =
            findGapOnDay({
              fromMs: +new Date(src.end),
              durationMin,
              blocks,
              courses,
              plannerEvents,
              scheduleOverrides,
              dayEndHour: settings.dayEndHour,
            }) ?? startMs + 86_400_000

          const copy: StudyBlock = {
            ...src,
            id: uid(),
            done: false,
            start: new Date(slot).toISOString(),
            end: new Date(slot + durationMin * 60_000).toISOString(),
            createdAt: new Date().toISOString(),
          }
          mutate('Duplicated block', (s) => ({ blocks: [...s.blocks, copy] }))
          return copy
        },
        removeBlock(id) {
          mutate('Deleted block', (s) => ({
            blocks: s.blocks.filter((b) => b.id !== id),
            // Time really spent is kept; it just stops pointing at a block that
            // no longer exists. The automatic top-up goes with the block.
            sessions: s.sessions
              .filter((x) => !(x.blockId === id && isAutoLog(x)))
              .map((x) => (x.blockId === id ? { ...x, blockId: null } : x)),
          }))
        },
        toggleBlockDone(id) {
          const b = get().blocks.find((x) => x.id === id)
          if (!b) return
          const nowDone = !b.done
          if (get().assignments.some((a) => a.id === id)) {
            get().setAssignmentStatus(id, nowDone ? 'done' : 'todo')
            return
          }
          const at = new Date().toISOString()
          mutate(nowDone ? 'Marked block done' : 'Reopened block', (s) => {
            const blocks = s.blocks.map((x) => (x.id === id ? { ...x, done: nowDone } : x))
            let assignments = s.assignments
            if (b.subtaskId) {
              const siblings = blocks.filter((x) => x.subtaskId === b.subtaskId)
              const allDone = siblings.length > 0 && siblings.every((x) => x.done)
              assignments = assignments.map((a) =>
                a.subtasks.some((t) => t.id === b.subtaskId)
                  ? {
                      ...a,
                      subtasks: a.subtasks.map((t) =>
                        t.id === b.subtaskId
                          ? { ...t, done: allDone, completedAt: allDone ? t.completedAt ?? at : undefined }
                          : t,
                      ),
                      status: (nowDone || allDone) && a.status === 'todo' ? ('doing' as const) : a.status,
                    }
                  : a,
              )
            }
            return {
              blocks,
              assignments,
              sessions: syncBlockSessions(s.blocks, s.sessions, new Set([id]), nowDone, at),
            }
          })
        },

        addPlannerEvent(input) {
          const event: PlannerEvent = {
            id: uid(),
            title: input.title.trim(),
            kind: input.kind,
            start: input.start,
            end: input.end,
            allDay: input.allDay,
            courseId: input.courseId ?? null,
            room: input.room?.trim() || undefined,
            createdAt: new Date().toISOString(),
          }
          mutate('Added planner item', (s) => ({ plannerEvents: [...s.plannerEvents, event] }))
          return event
        },
        updatePlannerEvent(id, patch) {
          mutate('Updated planner item', (s) => ({
            plannerEvents: s.plannerEvents.map((event) =>
              event.id === id
                ? {
                    ...event,
                    ...patch,
                    title: patch.title === undefined ? event.title : patch.title.trim(),
                    room: patch.room === undefined ? event.room : patch.room.trim() || undefined,
                  }
                : event,
            ),
          }))
        },
        removePlannerEvent(id) {
          mutate('Deleted planner item', (s) => ({
            plannerEvents: s.plannerEvents.filter((event) => event.id !== id),
          }))
        },
        upsertScheduleOverride(input) {
          const existing = get().scheduleOverrides.find((override) => override.date === input.date)
          const override: ScheduleOverride = existing
            ? { ...existing, ...input, title: input.title?.trim() || undefined }
            : {
                id: uid(),
                date: input.date,
                scheduleDay: input.scheduleDay,
                title: input.title?.trim() || undefined,
                createdAt: new Date().toISOString(),
              }
          mutate(existing ? 'Updated schedule day' : 'Changed schedule day', (s) => ({
            scheduleOverrides: existing
              ? s.scheduleOverrides.map((item) => (item.id === existing.id ? override : item))
              : [...s.scheduleOverrides, override],
          }))
          return override
        },
        removeScheduleOverride(id) {
          mutate('Reset schedule day', (s) => ({
            scheduleOverrides: s.scheduleOverrides.filter((override) => override.id !== id),
          }))
        },

        logSession(input) {
          if (!Number.isFinite(input.minutes) || input.minutes < MIN_LOGGABLE_MIN) return
          const nowIso = new Date().toISOString()
          const s: Session = {
            id: uid(),
            courseId: input.courseId ?? null,
            assignmentId: input.assignmentId ?? null,
            blockId: input.blockId ?? null,
            start: input.start ?? new Date(Date.now() - input.minutes * 60000).toISOString(),

            minutes: Math.round(input.minutes * 10) / 10,
            source: input.source ?? 'manual',
            sittingId: input.sittingId,
            auto: false,
            createdAt: nowIso,
          }
          mutate('Logged time', (st) => {
            const nextSessions = [...st.sessions, s]
            const placed = stateToUnits({ ...st, sessions: nextSessions })
            const rootId =
              (s.assignmentId && rootDeliverableId(placed, s.assignmentId)) ||
              (s.blockId && rootDeliverableId(placed, s.blockId)) ||
              null
            const nextAssignments = rootId
              ? st.assignments.map((a) => (a.id === rootId && a.status === 'todo' ? { ...a, status: 'doing' as const } : a))
              : st.assignments
            return {
              sessions: nextSessions,
              assignments: nextAssignments,
              units: stateToUnits({ ...st, sessions: nextSessions, assignments: nextAssignments }),
            }
          })
        },

        settleTimer(at) {
          const t = get().timer
          if (!t) return
          set({ timer: settle(t, at) })
        },

        reconcileTimer() {
          const t = get().timer
          if (!t) return null
          const r = recover(t, Date.now(), readHeartbeat())
          const recovered = withRecovery(get(), r)
          // Banking a session moves a task to "doing", so the unit graph has to
          // move with it. Leaving it behind meant the next action that only
          // touched, say, the today list would sync the stale statuses back.
          const at = new Date().toISOString()
          const units = stateToUnits(recovered as AppState)
          set({
            ...recovered,
            units,
            assignments: syncAssignmentsFromUnits(recovered.assignments, units, at),
            blocks: syncBlocksFromUnits(recovered.blocks, units),
          } as never)
          return r
        },

        startSitting(input) {
          if (get().timer) get().endSitting()
          const now = Date.now()

          const plan = input.plan?.length ? input.plan : undefined
          const first = plan?.[0]
          set({
            timer: {
              id: uid(),
              assignmentId: input.assignmentId,
              courseId: input.courseId,
              blockId: input.blockId,
              label: first?.label ?? input.label,
              source: input.justStart ? 'juststart' : 'pomodoro',
              startedAt: new Date(now).toISOString(),
              phase: first && first.kind === 'break' ? 'break' : 'work',
              runningSince: now,
              phaseSec: 0,
              phaseTotalSec: Math.max(1, Math.round((first?.minutes ?? input.minutes) * 60)),
              workedSec: 0,
              rounds: 0,
              justStart: plan ? undefined : input.justStart,
              plan,
              planIndex: plan ? 0 : undefined,
              lastSeenAt: now,
            },
          })
        },

        pauseTimer() {
          const t = get().timer
          if (!t || t.runningSince == null) return
          set({ timer: { ...settle(t), runningSince: null } })
        },

        resumeTimer() {
          const t = get().timer
          if (!t || t.runningSince != null) return
          const now = Date.now()
          set({ timer: { ...t, runningSince: now, lastSeenAt: now } })
        },

        completeTimerPhase() {
          const t = get().timer
          if (!t) return
          set({ timer: completePhase(t, get().settings) })
        },

        startNextRound() {
          const t = get().timer
          if (!t || t.phase === 'work') return
          const s = get().settings

          set({ timer: toWork({ ...settle(t), justStart: false }, Math.max(1, s.focusMin) * 60) })
        },

        endSitting(opts = {}) {
          const t0 = get().timer
          if (!t0) return null
          const now = Date.now()
          const t = settle(t0, now)
          const minutes = Math.round((t.workedSec / 60) * 10) / 10
          const keep = minutes >= MIN_LOGGABLE_MIN

          const before = get()

          if (keep || opts.finish) {
            undoStack.push({ label: opts.finish ? 'Finished a task' : 'Logged a session', snapshot: snapshotOf(before), at: now })
            if (undoStack.length > 40) undoStack.shift()
          }

          const already = before.sessions.some((x) => x.sittingId === t.id)
          let sessions = keep && !already ? [...before.sessions, { id: uid(), ...sessionFrom(t, now) }] : before.sessions
          const at = new Date(now).toISOString()

          const finishIds = opts.finish
            ? new Set(
                before.blocks
                  .filter(
                    (b) => (t.blockId && b.id === t.blockId) || (t.assignmentId && b.assignmentId === t.assignmentId),
                  )
                  .map((b) => b.id),
              )
            : new Set<ID>()

          if (opts.finish && finishIds.size > 0) {
            sessions = syncBlockSessions(before.blocks, sessions, finishIds, true, at)
          }

          const totalMin = t.assignmentId
            ? sessions.reduce(
                (sum, x) =>
                  x.assignmentId === t.assignmentId && Number.isFinite(x.minutes) && x.minutes >= 0
                    ? sum + x.minutes
                    : sum,
                0,
              )
            : minutes

          const blocks =
            opts.finish
              ? before.blocks.map((b) => (finishIds.has(b.id) ? { ...b, done: true } : b))
              : before.blocks

          const nextAssignments = t.assignmentId
            ? before.assignments.map((a) => {
                if (a.id !== t.assignmentId) return a
                if (opts.finish) {
                  return {
                    ...a,
                    status: 'done' as const,
                    completedAt: at,
                    subtasks: a.subtasks.map((x) => ({ ...x, done: true, completedAt: x.completedAt ?? at })),
                  }
                }

                return keep && a.status === 'todo' ? { ...a, status: 'doing' as const } : a
              })
            : before.assignments

          const nextUnits = reconcileUnitClosures(
            stateToUnits({
              ...before,
              sessions,
              blocks,
              assignments: nextAssignments,
            }),
            before.units && Object.keys(before.units).length > 0 ? before.units : stateToUnits(before),
            at,
          )
          const rel = unitsToRelational(nextUnits)
          const priorUnits =
            before.units && Object.keys(before.units).length > 0 ? before.units : stateToUnits(before)
          const syncedSessions = mergeProjectedSessions(rel.sessions, sessions, priorUnits, nextUnits)
          const syncedAssignments = syncAssignmentsFromUnits(nextAssignments, nextUnits, at)

          set({
            sessions: syncedSessions,
            blocks: syncBlocksFromUnits(blocks, nextUnits),
            assignments: syncedAssignments,
            units: nextUnits,
            timer: null,
          })
          return { minutes: keep ? minutes : 0, totalMin }
        },

        addToToday(assignmentId) {
          if (get().todayList.some((t) => t.assignmentId === assignmentId)) return
          mutate('Added to today', (s) => ({
            todayList: [...s.todayList, { assignmentId, day: dayKey(Date.now()) }],
          }))
        },
        removeFromToday(assignmentId) {
          mutate('Removed from today', (s) => ({
            todayList: s.todayList.filter((t) => t.assignmentId !== assignmentId),
          }))
        },
        reorderToday(from, to) {
          mutate('Reordered today', (s) => {
            const next = [...s.todayList]
            const [moved] = next.splice(from, 1)
            if (!moved) return {}
            next.splice(to, 0, moved)
            return { todayList: next }
          })
        },
        clearDoneFromToday() {
          const done = new Set(
            get()
              .assignments.filter((a) => a.status === 'done')
              .map((a) => a.id),
          )
          mutate('Cleared finished', (s) => ({
            todayList: s.todayList.filter((t) => !done.has(t.assignmentId)),
          }))
        },

        muteNudge(id) {
          set((s) => ({
            settings: {
              ...s.settings,
              mutedNudges: { ...pruneMutes(s.settings.mutedNudges, dayKey(Date.now())), [id]: dayKey(Date.now()) },
            },
          }))
        },
        updateSettings(patch) {
          set((s) => ({ settings: { ...s.settings, ...patch } }))
        },

        pushUndo(label) {
          undoStack.push({ label, snapshot: snapshotOf(get()), at: Date.now() })
          if (undoStack.length > 40) undoStack.shift()
        },
        undo() {
          const entry = undoStack.pop()
          if (!entry) return false
          set(entry.snapshot as never)
          return true
        },

        loadSample() {
          const sample = buildSample()
          undoStack.push({ label: 'Loaded sample data', snapshot: snapshotOf(get()), at: Date.now() })

          const fullSample = {
            ...sample,
            plannerEvents: [],
            scheduleOverrides: [],
            todayList: sample.todayList ?? [],
            settings: {
              ...get().settings,
              onboarded: true,
              termStart: sample.settings?.termStart,
              termEnd: sample.settings?.termEnd,
            },
            isSample: true,
          }

          set({
            ...fullSample,
            units: stateToUnits(fullSample as AppState),
          })
        },
        resetAll() {
          undoStack = []
          set({ ...EMPTY, units: {}, settings: { ...DEFAULT_SETTINGS, onboarded: true }, isSample: false })
        },
        importState(next) {
          undoStack.push({ label: 'Imported data', snapshot: snapshotOf(get()), at: Date.now() })
          const settings = { ...DEFAULT_SETTINGS, ...(next.settings ?? {}), onboarded: true }
          if (!isPaletteId(settings.palette)) settings.palette = DEFAULT_PALETTE
          const nextState: AppState = {
            version: 3,
            courses: next.courses ?? [],
            assignments: next.assignments ?? [],
            blocks: next.blocks ?? [],
            plannerEvents: next.plannerEvents ?? [],
            scheduleOverrides: next.scheduleOverrides ?? [],
            sessions: next.sessions ?? [],
            todayList: next.todayList ?? [],
            settings,
            timer: null,
            isSample: false,
          }
          const at = new Date().toISOString()
          // Backups no longer carry `units`, but older ones do — it is read for
          // what it is worth and rebuilt either way. Restoring is not a
          // transition, so completions are stamped without owing any top-ups.
          const imported = stampCompletions(stateToUnits({ ...nextState, units: next.units ?? {} }), at)
          set({
            ...nextState,
            units: imported,
            assignments: syncAssignmentsFromUnits(nextState.assignments, imported, at),
            blocks: syncBlocksFromUnits(nextState.blocks, imported),
          })
        },
      }
    },
    {
      name: STORAGE_KEY,
      version: 3,
      storage: createJSONStorage(resolveStorage),

      migrate: (persisted, version) => {
        const st = (persisted ?? {}) as Partial<AppState> & { timer?: unknown }
        st.version = 3
        if (version >= 3) return st as any
        const t = st.timer as LegacyTimer | null | undefined
        if (t && t.mode === 'focus' && typeof t.totalSec === 'number' && typeof t.endsAt === 'number') {
          const stale = t.pausedSec == null && Date.now() - t.endsAt > STALE_MS
          const remaining = t.pausedSec ?? Math.max(0, (t.endsAt - Date.now()) / 1000)
          const workedSec = stale ? 0 : Math.min(t.totalSec, Math.max(0, t.totalSec - remaining))
          const minutes = Math.round((workedSec / 60) * 10) / 10
          if (minutes >= MIN_LOGGABLE_MIN) {
            st.sessions = [
              ...(st.sessions ?? []),
              {
                id: uid(),
                courseId: t.courseId ?? null,
                assignmentId: t.assignmentId ?? null,
                blockId: t.blockId ?? null,
                start: new Date(t.endsAt - t.totalSec * 1000).toISOString(),
                minutes,
                source: t.justStart ? 'juststart' : 'pomodoro',
                createdAt: new Date().toISOString(),
              },
            ]
          }
        }
        st.timer = null
        return st as any
      },

      merge: (persisted, current) => {
        const at = new Date().toISOString()
        const next = { ...current, ...(persisted as Partial<NudgeStore>) } as NudgeStore
        next.settings = { ...DEFAULT_SETTINGS, ...next.settings }
        next.plannerEvents ??= []
        next.scheduleOverrides ??= []
        // Rehydrating is not a transition, so no top-ups are owed. What is owed
        // is a completion time for anything the graph works out is finished —
        // otherwise it is done with no date and shows up in neither list.
        next.units = stampCompletions(stateToUnits(next), at)
        next.assignments = syncAssignmentsFromUnits(next.assignments, next.units, at)
        next.blocks = syncBlocksFromUnits(next.blocks, next.units)
        if (!next.timer) return next
        pendingRecovery = recover(next.timer, Date.now(), readHeartbeat())
        const recovered = withRecovery(next, pendingRecovery)
        recovered.units = stampCompletions(stateToUnits(recovered), at)
        recovered.assignments = syncAssignmentsFromUnits(recovered.assignments, recovered.units, at)
        recovered.blocks = syncBlocksFromUnits(recovered.blocks, recovered.units)
        return recovered
      },
      // `units` is derived from the rows below it and rebuilt on load, so it is
      // deliberately not stored: keeping it doubled the payload and every write.
      partialize: (s) => ({
        version: s.version,
        courses: s.courses,
        assignments: s.assignments,
        blocks: s.blocks,
        plannerEvents: s.plannerEvents,
        scheduleOverrides: s.scheduleOverrides,
        sessions: s.sessions,
        todayList: s.todayList,
        settings: s.settings,
        timer: s.timer,
        isSample: s.isSample,
      }),
    },
  ),
)

/**
 * Nudge keeps everything in one browser, and nothing stopped two tabs from
 * overwriting each other: each held its own copy and the last one to save won,
 * silently discarding whatever the other had done.
 *
 * The `storage` event only fires in the *other* tabs, so a tab that has just
 * saved never reacts to itself. A tab with a timer running is left alone —
 * reloading it mid-session would disturb the sitting, and it will save its own
 * work when the timer ends.
 */
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY || e.newValue == null) return
    // The sitting on the clock belongs to the tab running it, so it is carried
    // across the reload rather than being replaced by the other tab's idea of
    // it — and the recovery that reloading queues up is dropped, so the other
    // tab does not announce a session this one is in the middle of.
    const running = useStore.getState().timer
    void Promise.resolve(useStore.persist.rehydrate()).then(() => {
      if (!running) return
      takeTimerRecovery()
      if (useStore.getState().timer?.id !== running.id) useStore.setState({ timer: running })
    })
  })
}

function buildSample(): Partial<AppState> {
  const now = new Date()
  const iso = (d: Date) => d.toISOString()
  const at = (dayOffset: number, hour: number, minute = 0) => {
    const d = new Date(now)
    d.setDate(d.getDate() + dayOffset)
    d.setHours(hour, minute, 0, 0)
    return d
  }
  const daysAgo = (n: number) => at(-n, 20)

  const mk = (
    code: string,
    color: ColorSlot,
    professor: string,
    room: string,

    meetings: [number, number, number, MeetingKind, string?][],
    extra: Partial<Course> = {},
  ): Course => ({
    id: uid(),
    code,
    color,
    professor,
    room,
    targetGrade: 85,
    createdAt: iso(at(-40, 9)),
    meetings: meetings.map(([day, start, end, kind, room]) => ({ id: uid(), day, start, end, kind, room })),
    ...extra,
  })

  const comp = mk('COMP 250', 1, 'Prof. Alberini', 'Leacock 132', [
    [1, 10 * 60 + 5, 11 * 60 + 25, 'lecture'],
    [3, 10 * 60 + 5, 11 * 60 + 25, 'lecture'],
    [3, 11 * 60 + 35, 12 * 60 + 25, 'tutorial', 'Trottier 2100'],
  ], { title: 'Intro to Computer Science', midterm: iso(at(9, 18)), currentGrade: 79 })

  const math = mk('MATH 133', 3, 'Prof. Drury', 'Burnside 1B45', [
    [1, 13 * 60 + 5, 14 * 60 + 25, 'lecture'],
    [3, 13 * 60 + 5, 14 * 60 + 25, 'lecture'],
    [5, 12 * 60 + 35, 13 * 60 + 25, 'tutorial', 'Burnside 1205'],
  ], { title: 'Linear Algebra & Geometry', currentGrade: 88 })

  const poli = mk('POLI 212', 5, 'Prof. Roberts', 'Arts W-215', [
    [2, 11 * 60 + 35, 12 * 60 + 55, 'lecture'],
    [4, 11 * 60 + 35, 12 * 60 + 55, 'lecture'],
    [2, 13 * 60, 13 * 60 + 50, 'conference', 'Ferrier 456'],
  ], { title: 'Government & Politics of Europe', currentGrade: 82 })

  const psyc = mk('PSYC 100', 2, 'Prof. Titone', 'Adams Auditorium', [
    [1, 8 * 60 + 35, 9 * 60 + 55, 'lecture'],
    [3, 8 * 60 + 35, 9 * 60 + 55, 'lecture'],
    [5, 9 * 60 + 35, 10 * 60 + 25, 'conference', 'Stewart Bio N2/2'],
    [4, 14 * 60 + 35, 17 * 60 + 25, 'lab', 'Stewart Bio S1/4'],
  ], { title: 'Introduction to Psychology', currentGrade: 91 })

  const courses = [comp, math, poli, psyc]

  const A = (
    courseId: string,
    title: string,
    kind: TaskKind,
    dueDate: Date,
    weight: number,
    extra: Partial<Assignment> = {},
  ): Assignment => ({
    id: uid(),
    courseId,
    title,
    kind,
    due: iso(dueDate),
    weight,
    status: 'todo',
    estimateMin: defaultEffort({ kind, weight }),
    subtasks: [],
    createdAt: iso(at(-9, 12)),
    ...extra,
  })

  const essay = A(poli.id, 'Comparative politics essay', 'essay', at(3, 23, 59), 30, {
    createdAt: iso(at(-11, 12)),
    estimateMin: 420,
  })
  const a3 = A(comp.id, 'Assignment 3: graphs', 'problemset', at(2, 23, 59), 12, {
    status: 'doing',
    estimateMin: 300,
    subtasks: [
      { id: uid(), title: 'Read the handout, list the questions', done: true, estimateMin: 30, completedAt: iso(daysAgo(2)) },
      { id: uid(), title: 'Q1–Q2 (BFS/DFS)', done: true, estimateMin: 75, completedAt: iso(daysAgo(1)) },
      { id: uid(), title: 'Q3 (shortest path)', done: false, estimateMin: 90, due: iso(at(0, 17)) },
      { id: uid(), title: 'Write-up and submit', done: false, estimateMin: 45, due: iso(at(1, 16, 15)) },
    ],
  })

  const assignments: Assignment[] = [
    a3,
    essay,
    A(math.id, 'WeBWorK 6', 'problemset', at(1, 23, 59), 4, { estimateMin: 90 }),
    A(psyc.id, 'Chapter 8–9 reading', 'reading', at(4, 9, 0), 2, { estimateMin: 90 }),
    A(comp.id, 'Midterm review', 'midterm', at(9, 18, 0), 25, { estimateMin: 480 }),
    A(math.id, 'WeBWorK 7', 'problemset', at(8, 23, 59), 4, { estimateMin: 90 }),
    A(poli.id, 'Seminar response 4', 'assignment', at(6, 12, 0), 5, { estimateMin: 60 }),
    A(psyc.id, 'Research methods quiz', 'quiz', at(12, 10, 0), 8, { estimateMin: 120 }),

    A(math.id, 'WeBWorK 5', 'problemset', at(-4, 23, 59), 4, {
      status: 'done',
      estimateMin: 60,
      grade: 92,
      completedAt: iso(daysAgo(5)),
      createdAt: iso(at(-14, 9)),
    }),
    A(comp.id, 'Assignment 2: recursion', 'problemset', at(-7, 23, 59), 12, {
      status: 'done',
      estimateMin: 180,
      grade: 74,
      completedAt: iso(daysAgo(7)),
      createdAt: iso(at(-20, 9)),
    }),
    A(psyc.id, 'Reflection paper 1', 'essay', at(-9, 23, 59), 10, {
      status: 'done',
      estimateMin: 150,
      grade: 88,
      completedAt: iso(daysAgo(11)),
      createdAt: iso(at(-21, 9)),
    }),
    A(poli.id, 'Reading response 3', 'assignment', at(-2, 12, 0), 5, {
      status: 'done',
      estimateMin: 60,
      grade: 85,
      completedAt: iso(daysAgo(2)),
      createdAt: iso(at(-12, 9)),
    }),
  ]

  const sessions: Session[] = []
  const pattern: [number, number, ColorSlot | 0][] = []
  for (let d = 24; d >= 1; d--) {
    const dow = at(-d, 12).getDay()
    if (dow === 0 && d % 3 !== 0) continue
    const seedy = (d * 2654435761) % 100
    if (seedy < 22) continue
    const rounds = 1 + (seedy % 3)
    for (let r = 0; r < rounds; r++) pattern.push([d, 25 + ((seedy + r * 13) % 4) * 15, 0])
  }
  const courseCycle = [comp, math, psyc, poli]
  pattern.forEach(([d, minutes], i) => {
    const c = courseCycle[(i + d) % courseCycle.length]

    if (c.id === poli.id && d <= 4) return
    const start = at(-d, 14 + ((i * 3) % 7), (i % 4) * 15)
    sessions.push({
      id: uid(),
      courseId: c.id,
      assignmentId: null,
      start: iso(start),
      minutes,
      source: 'pomodoro',
      createdAt: iso(start),
    })
  })

  sessions.push({
    id: uid(),
    courseId: comp.id,
    assignmentId: a3.id,
    start: iso(at(0, Math.max(8, new Date().getHours() - 2))),
    minutes: 50,
    source: 'pomodoro',
    createdAt: iso(now),
  })

  const placed: StudyBlock[] = []
  const B = (
    dayOffset: number,
    hour: number,
    min: number,
    dur: number,
    courseId: string,
    assignmentId: string | null,
    done = false,
    subtaskId?: string,
  ): StudyBlock => {
    const day = at(dayOffset, 0, 0)
    const dow = day.getDay()
    const busy: [number, number][] = courses
      .flatMap((c) => c.meetings.filter((m) => m.day === dow))
      .map((m) => [m.start - 10, m.end + 10])
    for (const p of placed) {
      if (dayKey(p.start) !== dayKey(day)) continue
      busy.push([minutesOfDay(p.start) - 10, minutesOfDay(p.end) + 10])
    }

    let start = hour * 60 + min
    const latest = 22 * 60 - dur
    while (start <= latest && busy.some(([s, e]) => start < e && s < start + dur)) start += 15

    const block: StudyBlock = {
      id: uid(),
      courseId,
      assignmentId,
      subtaskId,
      start: iso(at(dayOffset, 0, Math.min(start, latest))),
      end: iso(at(dayOffset, 0, Math.min(start, latest) + dur)),
      done,
      createdAt: iso(at(-1, 9)),
    }
    placed.push(block)
    return block
  }

  const blocks: StudyBlock[] = [
    B(0, 16, 0, 60, comp.id, a3.id, false, a3.subtasks[2].id),
    B(0, 19, 30, 90, poli.id, essay.id),
    B(1, 15, 0, 75, comp.id, a3.id, false, a3.subtasks[3].id),
    B(1, 18, 0, 60, math.id, null),
    B(2, 14, 0, 120, poli.id, essay.id),
    B(3, 10, 0, 90, poli.id, essay.id),
    B(-1, 19, 0, 60, poli.id, essay.id, false),
    B(-2, 17, 0, 60, comp.id, a3.id, true),
  ]

  return {
    courses,
    assignments,
    blocks,
    sessions,

    todayList: [
      { assignmentId: a3.id, day: dayKey(now) },
      { assignmentId: essay.id, day: dayKey(now) },
    ],
      settings: { ...DEFAULT_SETTINGS, onboarded: true, name: 'Tommy', termStart: dayKey(at(-40, 9)), termEnd: dayKey(at(60, 9)) },
    timer: null,
  }
}
