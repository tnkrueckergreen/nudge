import type {
  ID,
  WorkUnit,
  WorkStatus,
  AppState,
  Assignment,
  StudyBlock,
  Session,
  Subtask,
  TaskKind,
  ScheduleSlot,
  TimeLog,
} from './types'
import { uid } from './id'
import { MIN_LOGGABLE_MIN } from './timer'

export { MIN_LOGGABLE_MIN }

const TASK_KINDS: ReadonlySet<string> = new Set([
  'assignment',
  'essay',
  'problemset',
  'project',
  'reading',
  'quiz',
  'midterm',
  'final',
  'lab',
  'presentation',
  'personal',
])

function isTaskKind(kind: string): kind is TaskKind {
  return TASK_KINDS.has(kind)
}

export function durationMinutes(start: string, end: string): number {
  const n = Math.round((+new Date(end) - +new Date(start)) / 60000)
  return Number.isFinite(n) ? Math.max(0, n) : 0
}

export function isAutoLog(log: Pick<TimeLog, 'source' | 'auto'>): boolean {
  if (log.auto === false) return false
  if (log.auto === true) return true
  return log.source === 'block'
}

function slotFrom(block: StudyBlock): ScheduleSlot {
  return {
    start: block.start,
    end: block.end,
    ...(block.locked ? { locked: true } : {}),
  }
}

function cloneUnit(u: WorkUnit): WorkUnit {
  return {
    ...u,
    logs: u.logs.map((l) => ({ ...l })),
    schedule: u.schedule ? { ...u.schedule } : u.schedule,
    plan: u.plan?.map((p) => ({ ...p })),
  }
}

function cloneUnits(src: Record<ID, WorkUnit> | undefined): Record<ID, WorkUnit> {
  if (!src || Object.keys(src).length === 0) return {}
  const out: Record<ID, WorkUnit> = {}
  for (const [id, u] of Object.entries(src)) out[id] = cloneUnit(u)
  return out
}

function breakParentCycles(units: Record<ID, WorkUnit>): void {
  for (const start of Object.keys(units)) {
    const seen = new Map<ID, number>()
    const path: ID[] = []
    let current: ID | null = start
    while (current && units[current]) {
      const previous = seen.get(current)
      if (previous !== undefined) {
        const cycleNode = path[previous]
        units[cycleNode] = { ...units[cycleNode], parentId: null }
        break
      }
      seen.set(current, path.length)
      path.push(current)
      current = units[current].parentId
    }
  }
}

function sittingParentId(block: StudyBlock, units: Record<ID, WorkUnit>): ID | null {
  if (block.subtaskId && block.subtaskId !== block.id && units[block.subtaskId]) return block.subtaskId
  return block.assignmentId ?? null
}

function logFromSession(s: Session): TimeLog {
  return {
    id: s.id,
    start: s.start,
    end: s.end,
    minutes: s.minutes,
    source: s.source,
    sittingId: s.sittingId,
    auto: s.auto,
    createdAt: s.createdAt,
  }
}

function minutesOf(logs: TimeLog[], pred: (l: TimeLog) => boolean = () => true): number {
  return logs.reduce(
    (sum, l) => (pred(l) && Number.isFinite(l.minutes) && l.minutes >= 0 ? sum + l.minutes : sum),
    0,
  )
}

function hasScheduledDescendant(units: Record<ID, WorkUnit>, id: ID, visited = new Set<ID>()): boolean {
  if (visited.has(id)) return false
  visited.add(id)
  return Object.values(units).some(
    (c) => c.parentId === id && (!!c.schedule || hasScheduledDescendant(units, c.id, visited)),
  )
}

function shouldTopUp(unit: WorkUnit, snapshot: Record<ID, WorkUnit>): boolean {
  return !!unit.schedule && !hasScheduledDescendant(snapshot, unit.id)
}

function creditedForTopUp(unit: WorkUnit, units: Record<ID, WorkUnit>): number {
  let n = minutesOf(unit.logs)
  const descendants = (id: ID, visited = new Set<ID>()): WorkUnit[] => {
    if (visited.has(id)) return []
    visited.add(id)
    const children = Object.values(units).filter((candidate) => candidate.parentId === id)
    return children.flatMap((child) => [child, ...descendants(child.id, visited)])
  }
  for (const child of descendants(unit.id)) n += minutesOf(child.logs)

  if (unit.kind !== 'sitting') return n

  let pid = unit.parentId
  const seen = new Set<ID>([unit.id])
  while (pid && units[pid] && !seen.has(pid)) {
    seen.add(pid)
    n += minutesOf(units[pid].logs, (l) => !isAutoLog(l))
    pid = units[pid].parentId
  }
  return n
}

function attachSessions(units: Record<ID, WorkUnit>, sessions: Session[]): void {
  const validSessionIds = new Set(sessions.map((s) => s.id))
  const holders = new Map<ID, ID[]>()
  for (const u of Object.values(units)) {
    const nextLogs: TimeLog[] = []
    for (const l of u.logs) {
      if (!validSessionIds.has(l.id)) continue
      const list = holders.get(l.id)
      if (list) list.push(u.id)
      else holders.set(l.id, [u.id])
      nextLogs.push(l)
    }
    if (nextLogs.length !== u.logs.length) units[u.id] = { ...u, logs: nextLogs }
  }

  const targetOf = (s: Session): ID | null => {
    if (s.blockId && units[s.blockId]) return s.blockId
    const owned = holders.get(s.id)
    if (owned) {
      const live = owned.filter((id) => units[id])
      if (live.length === 1) return live[0]
    }
    if (s.assignmentId && units[s.assignmentId]) return s.assignmentId
    return liveOwner(owned)
  }

  function liveOwner(owned: ID[] | undefined): ID | null {
    if (!owned) return null
    const live = owned.filter((id) => units[id])
    return live[0] ?? null
  }

  const byUnit = new Map<ID, TimeLog[]>()
  const placed = new Set<ID>()

  for (const s of sessions) {
    const target = targetOf(s)
    if (!target || !units[target] || placed.has(s.id)) continue
    placed.add(s.id)
    const list = byUnit.get(target) ?? []
    list.push(logFromSession(s))
    byUnit.set(target, list)
  }

  for (const u of Object.values(units)) {
    const next = byUnit.get(u.id) ?? []
    units[u.id] = { ...u, logs: next }
  }
}

export function mergeProjectedSessions(
  projected: Session[],
  priorSessions: Session[],
  priorUnits: Record<ID, WorkUnit>,
): Session[] {
  const emitted = new Set(projected.map((s) => s.id))
  const priorLogIds = new Set(Object.values(priorUnits).flatMap((u) => u.logs.map((l) => l.id)))
  const extra = priorSessions.filter(
    (s) => !emitted.has(s.id) && (!priorLogIds.has(s.id) || !isAutoLog(s)),
  )
  if (!extra.length) return projected
  const seen = new Set(emitted)
  const out = [...projected]
  for (const s of extra) {
    if (seen.has(s.id)) continue
    seen.add(s.id)
    out.push(s)
  }
  return out
}

export function realDue(due: string | undefined, createdAt: string): string | undefined {
  return due && due !== createdAt ? due : undefined
}

export function rootDeliverableId(units: Record<ID, WorkUnit>, id: ID): ID | null {
  const start = units[id]
  if (!start) return null
  const root = getRoot(units, start)
  return root.kind === 'sitting' ? null : root.id
}

export function reconcileUnitClosures(
  units: Record<ID, WorkUnit>,
  prior: Record<ID, WorkUnit>,
  nowIso: string,
): Record<ID, WorkUnit> {
  const next: Record<ID, WorkUnit> = { ...units }
  for (const u of Object.values(units)) {
    const wasDone = prior[u.id]?.status === 'done'
    const isDone = u.status === 'done'
    if (isDone && !wasDone) {
      const logs = shouldTopUp(u, next) ? applyTopUp(u, nowIso, next) : [...u.logs]
      next[u.id] = {
        ...u,
        logs,
        completedAt: u.completedAt ?? nowIso,
        updatedAt: nowIso,
      }
    } else if (!isDone && wasDone) {
      next[u.id] = {
        ...u,
        logs: u.logs.filter((l) => !isAutoLog(l)),
        completedAt: undefined,
        updatedAt: nowIso,
      }
    }
  }
  return next
}

export function syncBlocksFromUnits(blocks: StudyBlock[], units: Record<ID, WorkUnit>): StudyBlock[] {
  let changed = false
  const next = blocks.map((b) => {
    const u = units[b.id]
    if (!u) return b
    const done = u.status === 'done'
    if (!!b.done === done) return b
    changed = true
    return { ...b, done }
  })
  return changed ? next : blocks
}

export function syncAssignmentsFromUnits(
  assignments: Assignment[],
  units: Record<ID, WorkUnit>,
): Assignment[] {
  return assignments.map((a) => {
    const u = units[a.id]
    if (!u) return a
    const status = u.status
    const subtasks = a.subtasks.map((st) => {
      const su = units[st.id]
      if (!su) return st
      const done = su.status === 'done'
      return {
        ...st,
        done,
        completedAt: done ? st.completedAt ?? su.completedAt : undefined,
        parentId: su.parentId && su.parentId !== a.id ? su.parentId : undefined,
      }
    })
    return {
      ...a,
      status,
      completedAt: status === 'done' ? a.completedAt ?? u.completedAt : undefined,
      subtasks,
    }
  })
}

export function sessionCreditsBlock(session: Session, block: StudyBlock): boolean {
  if (isAutoLog(session)) return false
  if (session.blockId === block.id) return true
  if (session.blockId) return false
  if (session.assignmentId === block.id) return true
  if (block.subtaskId && session.assignmentId === block.subtaskId) return true
  if (!session.assignmentId || session.assignmentId !== block.assignmentId) return false
  return block.subtaskId !== block.id
}

export function deriveCompositeStatus(childStatuses: WorkStatus[], ownStatus: WorkStatus = 'todo'): WorkStatus {
  if (childStatuses.length === 0) return ownStatus
  if (childStatuses.every((s) => s === 'done')) return 'done'
  if (childStatuses.some((s) => s === 'doing' || s === 'done')) return 'doing'
  if (ownStatus === 'doing') return 'doing'
  return 'todo'
}

export function applyCompositeStatus(units: Record<ID, WorkUnit>): Record<ID, WorkUnit> {
  const childrenByParent = new Map<ID, WorkUnit[]>()
  for (const child of Object.values(units)) {
    if (child.kind === 'sitting' || !child.parentId || !units[child.parentId]) continue
    const children = childrenByParent.get(child.parentId) ?? []
    children.push(child)
    childrenByParent.set(child.parentId, children)
  }

  const visiting = new Set<ID>()
  const visited = new Set<ID>()
  const visit = (id: ID): void => {
    if (visited.has(id) || visiting.has(id) || !units[id]) return
    visiting.add(id)
    for (const child of childrenByParent.get(id) ?? []) visit(child.id)
    visiting.delete(id)
    visited.add(id)

    const children = childrenByParent.get(id)
    if (!children?.length) return
    const unit = units[id]
    const nextStatus = deriveCompositeStatus(
      children.map((child) => units[child.id]?.status ?? child.status),
      unit.status,
    )
    if (unit.status !== nextStatus) units[id] = { ...unit, status: nextStatus }
  }

  for (const id of Object.keys(units)) visit(id)
  return units
}

export function stateToUnits(state: AppState): Record<ID, WorkUnit> {
  const units: Record<ID, WorkUnit> = cloneUnits(state.units)
  const now = new Date().toISOString()

  const validAssignmentIds = new Set(state.assignments.map((a) => a.id))
  const validSubtaskIds = new Set(state.assignments.flatMap((a) => a.subtasks.map((st) => st.id)))
  const validBlockIds = new Set(state.blocks.map((b) => b.id))
  const subtaskOwner = new Map<ID, ID>()
  for (const a of state.assignments) {
    for (const st of a.subtasks) subtaskOwner.set(st.id, a.id)
  }

  for (const a of state.assignments) {
    const existing = units[a.id]
    const rootBlock = state.blocks.find((b) => b.id === a.id)
    if (existing) {
      units[a.id] = {
        ...existing,
        parentId: null,
        courseId: a.courseId,
        title: a.title,
        kind: isTaskKind(a.kind) ? a.kind : existing.kind,
        due: existing.due === undefined && a.due === existing.createdAt ? undefined : a.due,
        weight: a.weight,
        grade: a.grade,
        status: a.status,
        estimateMin: a.estimateMin ?? existing.estimateMin,
        notes: a.notes,
        completedAt: a.completedAt,
        breakdownDismissed: a.breakdownDismissed,
        archived: a.archived,
        private: a.private,
        schedule: rootBlock ? slotFrom(rootBlock) : null,
        plan: rootBlock?.plan,
        updatedAt: now,
      }
    } else {
      units[a.id] = {
        id: a.id,
        parentId: null,
        courseId: a.courseId,
        title: a.title,
        kind: isTaskKind(a.kind) ? a.kind : 'assignment',
        due: a.due,
        weight: a.weight,
        grade: a.grade,
        status: a.status,
        estimateMin: a.estimateMin ?? 60,
        schedule: null,
        logs: [],
        notes: a.notes,
        completedAt: a.completedAt,
        createdAt: a.createdAt || now,
        updatedAt: now,
        private: a.private,
        breakdownDismissed: a.breakdownDismissed,
        archived: a.archived,
      }
    }

    for (const st of a.subtasks) {
      const existingStep = units[st.id]
      const selfBlock = state.blocks.find((b) => b.id === st.id)
      const selfSlot = selfBlock ? slotFrom(selfBlock) : null
      const validParent = (parentId: ID | undefined | null): parentId is ID =>
        !!parentId &&
        parentId !== st.id &&
        (parentId === a.id || subtaskOwner.get(parentId) === a.id)
      const parentId = validParent(st.parentId)
        ? st.parentId
        : validParent(existingStep?.parentId)
          ? existingStep.parentId
          : a.id

      if (existingStep) {
        const keepSitting = existingStep.kind === 'sitting'
        const kind = keepSitting ? 'sitting' : existingStep.kind || 'step'
        units[st.id] = {
          ...existingStep,
          parentId,
          courseId: a.courseId,
          title: st.title,
          kind,
          status: st.done ? 'done' : existingStep.status === 'done' ? 'todo' : existingStep.status,
          due: st.due,
          estimateMin: st.estimateMin ?? existingStep.estimateMin,
          schedule: keepSitting
            ? existingStep.schedule
            : selfSlot ?? (validBlockIds.has(st.id) ? existingStep.schedule : null),
          completedAt: st.completedAt,
          archived: a.archived,
          updatedAt: now,
        }
      } else {
        units[st.id] = {
          id: st.id,
          parentId,
          courseId: a.courseId,
          title: st.title,
          kind: 'step',
          due: st.due,
          status: st.done ? 'done' : 'todo',
          estimateMin: st.estimateMin ?? (selfBlock ? durationMinutes(selfBlock.start, selfBlock.end) || 45 : 45),
          schedule: selfSlot,
          logs: [],
          completedAt: st.completedAt,
          archived: a.archived,
          createdAt: a.createdAt || now,
          updatedAt: now,
        }
      }
    }
  }

  for (const b of state.blocks) {
    const slot = slotFrom(b)
    const dur = durationMinutes(b.start, b.end)
    const existing = units[b.id]
    if (existing) {
      const isSitting = existing.kind === 'sitting'
      let status = existing.status
      if (b.done) status = 'done'
      else if (existing.status === 'done') status = 'todo'
      units[b.id] = {
        ...existing,
        schedule: slot,
        plan: b.plan ?? existing.plan,
        title: isSitting ? b.title || existing.title : existing.title,
        courseId: isSitting ? b.courseId : existing.courseId,
        parentId: isSitting ? sittingParentId(b, units) : existing.parentId,
        status,
        estimateMin: isSitting ? dur || existing.estimateMin : existing.estimateMin,
        due: isSitting ? b.end : existing.due,
        updatedAt: now,
      }
    } else {
      const parentId = sittingParentId(b, units)
      units[b.id] = {
        id: b.id,
        parentId,
        courseId: b.courseId,
        title: b.title || 'Study session',
        kind: 'sitting',
        due: b.end,
        status: b.done ? 'done' : 'todo',
        estimateMin: dur,
        schedule: slot,
        plan: b.plan,
        logs: [],
        createdAt: b.createdAt || now,
        updatedAt: now,
      }
    }
  }

  breakParentCycles(units)

  let cleaned = true
  while (cleaned) {
    cleaned = false
    for (const u of Object.values(units)) {
      const invalid =
        (u.kind === 'sitting' && !validBlockIds.has(u.id)) ||
        (u.kind === 'step' && !validSubtaskIds.has(u.id)) ||
        (u.parentId === null && u.kind !== 'sitting' && !validAssignmentIds.has(u.id))
      if (invalid) {
        delete units[u.id]
        cleaned = true
      }
    }
    for (const u of Object.values(units)) {
      if (u.parentId && !units[u.parentId]) {
        units[u.id] = { ...u, parentId: null }
        cleaned = true
      }
    }
  }

  attachSessions(units, state.sessions)
  return applyCompositeStatus(units)
}

function getRoot(units: Record<ID, WorkUnit>, unit: WorkUnit, visited = new Set<ID>()): WorkUnit {
  if (visited.has(unit.id) || !unit.parentId || !units[unit.parentId]) return unit
  visited.add(unit.id)
  return getRoot(units, units[unit.parentId], visited)
}

export function unitsToRelational(units: Record<ID, WorkUnit>): {
  assignments: Assignment[]
  blocks: StudyBlock[]
  sessions: Session[]
} {
  const allUnits = Object.values(units)
  const rootUnits = allUnits.filter((u) => u.parentId === null && u.kind !== 'sitting')
  const assignments: Assignment[] = []
  const blocks: StudyBlock[] = []
  const sessions: Session[] = []

  const seenLogIds = new Set<ID>()
  for (const u of allUnits) {
    const rootParent = u.parentId ? getRoot(units, u) : u
    const assignmentId = rootParent && rootParent.kind !== 'sitting' ? rootParent.id : null
    const blockId = u.schedule ? u.id : null

    for (const log of u.logs) {
      if (seenLogIds.has(log.id)) continue
      seenLogIds.add(log.id)
      sessions.push({
        id: log.id,
        courseId: u.courseId,
        assignmentId,
        blockId,
        start: log.start,
        end: log.end,
        minutes: log.minutes,
        source: log.source,
        sittingId: log.sittingId,
        auto: log.auto,
        createdAt: log.createdAt,
      })
    }
  }

  for (const root of rootUnits) {
    const getChildrenSteps = (parentId: ID, visited = new Set<ID>()): WorkUnit[] => {
      if (visited.has(parentId)) return []
      visited.add(parentId)
      const direct = allUnits.filter((u) => u.parentId === parentId)
      return direct.flatMap((d) =>
        d.kind === 'sitting' ? getChildrenSteps(d.id, visited) : [d, ...getChildrenSteps(d.id, visited)],
      )
    }
    const childSteps = getChildrenSteps(root.id)
    const subtasks: Subtask[] = childSteps.map((st) => ({
      id: st.id,
      title: st.title,
      done: st.status === 'done',
      due: st.due,
      estimateMin: st.estimateMin,
      completedAt: st.completedAt,
      ...(st.parentId && st.parentId !== root.id ? { parentId: st.parentId } : {}),
    }))

    assignments.push({
      id: root.id,
      courseId: root.courseId,
      title: root.title,
      kind: isTaskKind(root.kind) ? root.kind : 'assignment',
      due: root.due ?? root.createdAt,
      weight: root.weight,
      status: root.status,
      estimateMin: root.estimateMin,
      subtasks,
      notes: root.notes,
      grade: root.grade,
      completedAt: root.completedAt,
      createdAt: root.createdAt,
      private: root.private,
      breakdownDismissed: root.breakdownDismissed,
      archived: root.archived,
    })
  }

  for (const u of allUnits) {
    if (!u.schedule) continue
    const rootParent = u.parentId ? getRoot(units, u) : u
    const isStep = u.kind === 'step'
    const assignmentId = rootParent && rootParent.kind !== 'sitting' ? rootParent.id : null
    const subtaskId = isStep
      ? u.id
      : u.kind === 'sitting' && u.parentId && units[u.parentId]?.kind === 'step'
        ? u.parentId
        : null

    blocks.push({
      id: u.id,
      courseId: u.courseId,
      assignmentId,
      subtaskId,
      title: u.title,
      start: u.schedule.start,
      end: u.schedule.end,
      done: u.status === 'done',
      plan: u.plan,
      locked: u.schedule.locked,
      createdAt: u.createdAt,
    })
  }

  return { assignments, blocks, sessions }
}

function applyTopUp(unit: WorkUnit, nowIso: string, units: Record<ID, WorkUnit>): TimeLog[] {
  if (!unit.schedule) return [...unit.logs]
  const loggedMin = creditedForTopUp(unit, units)
  const plannedMin = durationMinutes(unit.schedule.start, unit.schedule.end)
  const topUp = Math.round((plannedMin - loggedMin) * 10) / 10
  if (topUp < MIN_LOGGABLE_MIN) return [...unit.logs]
  return [
    ...unit.logs,
    {
      id: uid(),
      start: unit.schedule.start,
      end: unit.schedule.end,
      minutes: topUp,
      source: 'block',
      auto: true,
      createdAt: nowIso,
    },
  ]
}

export function transitionUnitStatus(
  currentUnits: Record<ID, WorkUnit>,
  id: ID,
  status: WorkStatus,
  nowIso = new Date().toISOString(),
): Record<ID, WorkUnit> {
  const target = currentUnits[id]
  if (!target) return currentUnits

  const next: Record<ID, WorkUnit> = { ...currentUnits }
  const isBecomingDone = status === 'done' && target.status !== 'done'
  const isReopening = status !== 'done' && target.status === 'done'

  let updatedLogs = [...target.logs]
  if (isBecomingDone && shouldTopUp(target, currentUnits)) {
    updatedLogs = applyTopUp(target, nowIso, currentUnits)
  } else if (isReopening) {
    updatedLogs = updatedLogs.filter((l) => !isAutoLog(l))
  }

  next[id] = {
    ...target,
    status,
    completedAt: status === 'done' ? target.completedAt ?? nowIso : undefined,
    logs: updatedLogs,
    updatedAt: nowIso,
  }

  const cascadeDown = (parentId: ID, visited = new Set<ID>()) => {
    if (visited.has(parentId)) return
    visited.add(parentId)
    Object.values(next)
      .filter((u) => u.parentId === parentId)
      .forEach((child) => {
        let childLogs = [...child.logs]
        if (isBecomingDone && shouldTopUp(child, next)) {
          childLogs = applyTopUp({ ...child, logs: childLogs }, nowIso, next)
        } else if (isReopening) {
          childLogs = childLogs.filter((l) => !isAutoLog(l))
        }

        next[child.id] = {
          ...child,
          status,
          completedAt: status === 'done' ? child.completedAt ?? nowIso : undefined,
          logs: childLogs,
          updatedAt: nowIso,
        }
        cascadeDown(child.id, visited)
      })
  }

  if (isBecomingDone || isReopening) {
    cascadeDown(id)
  }

  let currParentId = target.parentId
  const visitedParents = new Set<ID>()
  while (currParentId && next[currParentId] && !visitedParents.has(currParentId)) {
    visitedParents.add(currParentId)
    const parent = next[currParentId]
    const children = Object.values(next).filter((u) => u.parentId === currParentId && u.kind !== 'sitting')
    const compositeStatus = deriveCompositeStatus(
      children.map((c) => c.status),
      parent.status,
    )

    let parentLogs = [...parent.logs]
    if (compositeStatus === 'done' && parent.status !== 'done' && shouldTopUp(parent, next)) {
      parentLogs = applyTopUp({ ...parent, logs: parentLogs }, nowIso, next)
    } else if (compositeStatus !== 'done' && parent.status === 'done') {
      parentLogs = parentLogs.filter((l) => !isAutoLog(l))
    }

    next[currParentId] = {
      ...parent,
      status: compositeStatus,
      completedAt: compositeStatus === 'done' ? parent.completedAt ?? nowIso : undefined,
      logs: parentLogs,
      updatedAt: nowIso,
    }
    currParentId = parent.parentId
  }

  return next
}

export const WorkSelectors = {
  rootTasks: (units: Record<ID, WorkUnit>, courseId?: ID | null): WorkUnit[] =>
    Object.values(units).filter(
      (u) => u.parentId === null && u.kind !== 'sitting' && (!courseId || u.courseId === courseId),
    ),

  calendarBlocks: (units: Record<ID, WorkUnit>): WorkUnit[] =>
    Object.values(units).filter((u) => u.schedule !== null && u.schedule !== undefined),

  stepsOf: (units: Record<ID, WorkUnit>, parentId: ID): WorkUnit[] =>
    Object.values(units).filter((u) => u.parentId === parentId && u.kind === 'step'),

  totalLoggedMinutes: (units: Record<ID, WorkUnit>, unitId: ID): number => {
    const visited = new Set<ID>()
    const getDescendants = (id: ID): WorkUnit[] => {
      if (visited.has(id)) return []
      visited.add(id)
      const children = Object.values(units).filter((u) => u.parentId === id)
      return [units[id], ...children.flatMap((c) => getDescendants(c.id))]
    }
    const nodes = getDescendants(unitId).filter(Boolean)
    return nodes.reduce((sum, n) => sum + minutesOf(n.logs), 0)
  },
}
