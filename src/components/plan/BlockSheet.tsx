import { useMemo, useState } from 'react'
import { Check, Copy, Play, Trash2 } from 'lucide-react'
import type { Assignment, Course, StudyBlock } from '../../lib/types'
import { atMinutes, fmtDuration, fmtTime, minutesOfDay, startOfDay } from '../../lib/date'
import { stepOf } from '../../lib/steps'
import { Button, CourseDot, Field, Input, Select, Sheet, cx } from '../ui'
import { SegmentBar, SegmentRows } from '../schedule/SessionPlan'
import { useIsMobile } from '../../lib/hooks'

export interface BlockSheetProps {
  block: StudyBlock
  courses: Course[]
  assignments: Assignment[]
  onClose: () => void
  onPatch: (patch: Partial<StudyBlock>) => void
  onReschedule: (startMs: number, endMs: number) => void
  onDuplicate: () => void
  onDelete: () => void
  onToggleDone: () => void
  onFocus: () => void
}

const QUICK = [25, 45, 60, 90, 120]
const DURATIONS = [15, 25, 30, 45, 60, 75, 90, 120, 150, 180, 240]

const toDateInput = (iso: string) => {
  const d = new Date(iso)
  const pad = (n: number) => `${n}`.padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const toTimeInput = (iso: string) => {
  const d = new Date(iso)
  const pad = (n: number) => `${n}`.padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function BlockSheet(p: BlockSheetProps) {
  const { block, courses, assignments, onClose } = p
  const [confirmDelete, setConfirmDelete] = useState(false)
  const isMobile = useIsMobile()

  const startMs = +new Date(block.start)
  const endMs = +new Date(block.end)
  const minutes = Math.round((endMs - startMs) / 60_000)

  const openTasks = useMemo(() => {
    const byCourse = new Map<string, Assignment[]>()
    for (const a of assignments) {
      if (a.status === 'done' || a.archived) continue
      const k = a.courseId ?? '__none__'
      byCourse.set(k, [...(byCourse.get(k) ?? []), a])
    }
    return byCourse
  }, [assignments])

  const course = block.courseId ? courses.find((c) => c.id === block.courseId) : undefined
  const assignment = block.assignmentId ? assignments.find((a) => a.id === block.assignmentId) : undefined
  const step = stepOf(block, assignment)
  const stepNo = step && assignment ? assignment.subtasks.indexOf(step) + 1 : 0
  const title = block.title || step?.title || assignment?.title || course?.code || 'Study block'

  const setDuration = (mins: number) => p.onReschedule(startMs, startMs + mins * 60_000)

  const setDay = (value: string) => {
    if (!value) return
    const [y, m, d] = value.split('-').map(Number)
    const nextDay = new Date(y, m - 1, d)
    const next = +atMinutes(nextDay, minutesOfDay(startMs))
    p.onReschedule(next, next + minutes * 60_000)
  }

  const setStartTime = (value: string) => {
    if (!value) return
    const [h, mi] = value.split(':').map(Number)
    const next = +atMinutes(startOfDay(startMs), h * 60 + mi)
    p.onReschedule(next, next + minutes * 60_000)
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <CourseDot course={course} size={15} />
          <span className="truncate">{title}</span>
        </span>
      }
      description={
        <>
          {fmtTime(startMs)} – {fmtTime(endMs)} · {fmtDuration(minutes)}
          {step && assignment && (
            <>
              {' · '}
              <span className="text-ink-3">
                step {stepNo} of {assignment.subtasks.length}
              </span>{' '}
              of {assignment.title}
            </>
          )}
        </>
      }
      footer={
        confirmDelete ? (
          <div className="flex items-center gap-2">
            <span className="text-[13px] text-ink-2 flex-1">Delete this block?</span>
            <Button size="sm" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button size="sm" variant="danger" onClick={p.onDelete} data-autofocus>
              Delete
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="danger"
              onClick={() => setConfirmDelete(true)}
              aria-label="Delete block"
              className="px-2.5"
            >
              <Trash2 size={14} />
            </Button>
            <Button size="sm" onClick={p.onDuplicate}>
              <Copy size={13} />
              Duplicate
            </Button>
            <div className="flex-1" />
            {!block.done && (
              <Button size="sm" onClick={p.onFocus}>
                <Play size={13} />
                Focus
              </Button>
            )}
            <Button size="sm" variant={block.done ? 'quiet' : 'primary'} onClick={p.onToggleDone}>
              <Check size={14} />
              {block.done ? 'Done' : 'Mark done'}
            </Button>
          </div>
        )
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="What is this for?">
          <Select
            value={block.assignmentId ?? (block.courseId ? `c:${block.courseId}` : '')}
            onChange={(e) => {
              const v = e.target.value
              if (!v) p.onPatch({ assignmentId: null, courseId: null })
              else if (v.startsWith('c:')) p.onPatch({ assignmentId: null, courseId: v.slice(2) })
              else {
                const a = assignments.find((x) => x.id === v)
                p.onPatch({ assignmentId: v, courseId: a?.courseId ?? null })
              }
            }}
          >
            <option value="">General study</option>
            {courses
              .filter((c) => !c.archived)
              .map((c) => (
                <optgroup key={c.id} label={c.code}>
                  <option value={`c:${c.id}`}>{c.code}: general</option>
                  {(openTasks.get(c.id) ?? []).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.title}
                    </option>
                  ))}
                </optgroup>
              ))}
            {(openTasks.get('__none__') ?? []).length > 0 && (
              <optgroup label="No course">
                {(openTasks.get('__none__') ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.title}
                  </option>
                ))}
              </optgroup>
            )}
          </Select>
        </Field>

        {assignment && assignment.subtasks.length > 0 && (
          <Field label="Which step?" hint="Ticking this block off ticks the step off too.">
            <Select
              value={block.subtaskId ?? ''}
              onChange={(e) => p.onPatch({ subtaskId: e.target.value || null })}
            >
              <option value="">No particular step</option>
              {assignment.subtasks.map((s, i) => (
                <option key={s.id} value={s.id}>
                  {i + 1}. {s.title}
                  {s.done ? ' ✓' : ''}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Day">
            <Input type="date" value={toDateInput(block.start)} onChange={(e) => setDay(e.target.value)} />
          </Field>
          <Field label="Starts">
            <Input
              type="time"
              step={900}
              value={toTimeInput(block.start)}
              onChange={(e) => setStartTime(e.target.value)}
            />
          </Field>
        </div>

        <Field group label="Length">
          <div className="flex items-center gap-1.5 flex-wrap">
            {QUICK.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDuration(d)}
                aria-pressed={minutes === d}
                className={cx(
                  'h-9 px-3 rounded-[10px] text-[13px] font-medium tnum transition-colors',
                  minutes === d ? 'bg-invert-bg text-invert-ink' : 'bg-tint text-ink-2 hover:bg-tint-2',
                )}
              >
                {d < 60 ? `${d}m` : d % 60 === 0 ? `${d / 60}h` : `${Math.floor(d / 60)}h ${d % 60}m`}
              </button>
            ))}
            <Select
              aria-label="Other length"
              value={DURATIONS.includes(minutes) ? String(minutes) : 'custom'}
              onChange={(e) => e.target.value !== 'custom' && setDuration(Number(e.target.value))}
              className="h-9 w-[112px] text-[13px]"
            >
              {!DURATIONS.includes(minutes) && <option value="custom">{fmtDuration(minutes)}</option>}
              {DURATIONS.map((d) => (
                <option key={d} value={d}>
                  {fmtDuration(d, { long: true })}
                </option>
              ))}
            </Select>
          </div>
        </Field>

        {block.plan && block.plan.length > 0 && (
          <Field
            group
            label="The sitting"
            hint="Start this block and the timer follows these, in order."
          >
            <SegmentBar segments={block.plan} className="mb-2" />
            <SegmentRows segments={block.plan} />
            <button
              type="button"
              onClick={() => p.onPatch({ plan: undefined })}
              className="mt-2 text-[12px] text-ink-3 hover:text-ink transition-colors"
            >
              Clear the plan, keep the time
            </button>
          </Field>
        )}

        <Field label="Label (optional)" hint="Leave blank to show what this block is for.">
          <Input
            value={block.title ?? ''}
            onChange={(e) => p.onPatch({ title: e.target.value || undefined })}
            placeholder={step?.title ?? assignment?.title ?? course?.code ?? 'Study'}
          />
        </Field>

        <p className="text-[12px] text-ink-3 leading-relaxed border-t border-line pt-3">
          On the calendar, drag this block to move it and drag its top or bottom edge to resize.
          {!isMobile && (
            <>
              {' '}
              Hold <span className="text-ink-2">Alt</span> while dragging to leave a copy behind.
            </>
          )}
        </p>
      </div>
    </Sheet>
  )
}
