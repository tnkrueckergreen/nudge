import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Plus, Sparkles, X, Zap } from 'lucide-react'
import type { TaskKind } from '../../lib/types'
import { useStore } from '../../lib/store'
import { KIND_LABEL, carriesWeight, defaultEffort, defaultWeight } from '../../lib/priority'
import { parseQuickAdd } from '../../lib/parse'
import { fmtDuration } from '../../lib/date'
import { Button, CourseDot, Field, Input, Segmented, Select, Sheet, Textarea, cx, useToast } from '../ui'
import { QuickAddPane } from './QuickAddPane'
import { fmtDay } from '../../lib/date'
import { normalizeCode } from '../../lib/store'

const KINDS = Object.keys(KIND_LABEL) as TaskKind[]
const ESTIMATES = [15, 30, 45, 60, 90, 120, 180, 240, 300, 420, 600, 900]

const pad = (n: number) => `${n}`.padStart(2, '0')
const dateValue = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

interface Draft {
  title: string
  courseId: string
  date: string
  time: string
  kind: TaskKind
  weight: string
  estimateMin: string
  notes: string
  steps: string[]
  addToToday: boolean
}

const emptyDraft = (now: Date, courseId: string): Draft => ({
  title: '',
  courseId,
  date: dateValue(now),
  time: '23:59',
  kind: 'assignment',
  weight: '',
  estimateMin: '',
  notes: '',
  steps: [],
  addToToday: false,
})

export function NewTaskSheet({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const store = useStore()
  const courses = useStore((s) => s.courses).filter((c) => !c.archived)
  const { toast } = useToast()
  const mode = useStore((s) => s.settings.addMode)
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(new Date(), ''))
  const [stepText, setStepText] = useState('')
  const [applied, setApplied] = useState(false)

  const touched = useRef({ course: false, due: false })
  const [newCourseCode, setNewCourseCode] = useState<string | null>(null)

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }))

  useEffect(() => {
    if (mode !== 'quick') return
    const raw = draft.title.trim()
    if (raw.length < 3) return
    const p = parseQuickAdd(raw, courses)
    setDraft((d) => {
      const next = { ...d }
      if (!touched.current.course && p.courseId) next.courseId = p.courseId
      if (!touched.current.due && p.dueExplicit) {
        next.date = dateValue(p.due)
        next.time = `${pad(p.due.getHours())}:${pad(p.due.getMinutes())}`
      }
      if (p.kind !== 'assignment') next.kind = p.kind
      if (p.weight != null) next.weight = String(p.weight)
      return next
    })
    setNewCourseCode(!p.courseId && p.courseCode ? normalizeCode(p.courseCode) : null)

  }, [draft.title, mode])

  const detected = useMemo(() => {
    if (applied || draft.title.trim().length < 4) return null
    const p = parseQuickAdd(draft.title, courses)
    const bits: string[] = []
    if (p.courseId) bits.push(courses.find((c) => c.id === p.courseId)?.code ?? '')
    if (p.dueExplicit) bits.push(p.due.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }))
    if (p.weight != null) bits.push(`${p.weight}%`)
    if (p.estimateMin != null) bits.push(fmtDuration(p.estimateMin))
    return bits.length && p.title !== draft.title ? { p, bits } : null
  }, [draft.title, courses, applied])

  const valid = draft.title.trim().length > 0 && !!draft.date

  const cleanTitle = useMemo(() => {
    const raw = draft.title.trim()
    if (mode !== 'quick' || raw.length < 3) return raw
    return parseQuickAdd(raw, courses).title
  }, [draft.title, mode, courses])

  const submit = (andAnother: boolean) => {
    if (!valid) return
    const due = new Date(`${draft.date}T${draft.time || '23:59'}`)
    const kind = draft.kind
    const weight = draft.weight === '' ? undefined : Number(draft.weight)
    let courseId = draft.courseId
    if (!courseId && newCourseCode) courseId = store.addCourse({ code: newCourseCode }).id
    const a = store.addAssignment({
      title: (mode === 'quick' ? cleanTitle : draft.title).trim(),
      courseId: courseId || null,
      kind,
      due: due.toISOString(),
      weight,
      estimateMin: draft.estimateMin === '' ? defaultEffort({ kind, weight }) : Number(draft.estimateMin),
      notes: draft.notes.trim() || undefined,
    })
    for (const title of draft.steps) store.addSubtask(a.id, { title })
    if (draft.addToToday) store.addToToday(a.id)

    if (andAnother) {

      setDraft({ ...emptyDraft(new Date(), courseId), date: draft.date, addToToday: draft.addToToday })
      setApplied(false)
      setNewCourseCode(null)
      toast(`${a.title} added`)
    } else {
      onClose()
      toast(`${a.title} added`, { action: { label: 'Open', run: () => onCreated(a.id) } })
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={
        <span className="flex items-center gap-2.5">
          New task
          <Segmented
            size="sm"
            ariaLabel="How much of the form to show"
            value={mode}
            onChange={(v) => store.updateSettings({ addMode: v })}
            options={[
              { value: 'quick', label: 'Quick', title: 'Name, course, due date' },
              { value: 'detailed', label: 'Detailed', title: 'Every field' },
            ]}
          />
        </span>
      }
      size="lg"
      footer={
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={onClose}>
            Cancel
          </Button>
          <div className="flex-1" />
          <Button size="sm" onClick={() => submit(true)} disabled={!valid} title="Add and keep the form open (⇧↵)">
            Add another
          </Button>
          <Button size="sm" variant="primary" onClick={() => submit(false)} disabled={!valid}>
            {mode === 'quick' ? <Zap size={14} /> : <Check size={14} />}
            Add task
          </Button>
        </div>
      }
    >
      {mode === 'quick' ? (
        <QuickAddPane
          value={{ title: draft.title, courseId: draft.courseId, date: draft.date, newCourseCode }}
          courses={courses}
          now={Date.now()}
          cleanTitle={cleanTitle}
          dueLabel={fmtDay(new Date(`${draft.date}T${draft.time || '23:59'}`))}
          onChange={(patch) => {
            if ('courseId' in patch || 'newCourseCode' in patch) touched.current.course = true
            if ('date' in patch) touched.current.due = true
            if (patch.newCourseCode !== undefined) setNewCourseCode(patch.newCourseCode)
            setDraft((d) => ({
              ...d,
              ...(patch.title !== undefined ? { title: patch.title } : {}),
              ...(patch.courseId !== undefined ? { courseId: patch.courseId } : {}),
              ...(patch.date !== undefined ? { date: patch.date } : {}),
            }))
          }}
          onSubmit={() => submit(false)}
          onSubmitAndRepeat={() => submit(true)}
        />
      ) : (
      <div className="flex flex-col gap-4">
        <Field label="Task name">
          <Input
            data-autofocus
            value={draft.title}
            onChange={(e) => set('title', e.target.value)}
            placeholder="Assignment 3: graphs"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && valid) {
                e.preventDefault()
                submit(false)
              }
            }}
          />
        </Field>

        {detected && (
          <button
            type="button"
            onClick={() => {
              const { p } = detected
              setDraft((d) => ({
                ...d,
                title: p.title,
                courseId: p.courseId ?? d.courseId,
                date: p.dueExplicit ? dateValue(p.due) : d.date,
                time: p.dueExplicit ? `${pad(p.due.getHours())}:${pad(p.due.getMinutes())}` : d.time,
                kind: p.kind,
                weight: p.weight != null ? String(p.weight) : d.weight,
                estimateMin: p.estimateMin != null ? String(p.estimateMin) : d.estimateMin,
              }))
              setApplied(true)
            }}
            className="-mt-2 flex items-center gap-2 px-3 py-2 rounded-xl bg-tint hover:bg-tint-2 transition-colors text-left"
          >
            <Sparkles size={14} className="shrink-0 text-ink-3" />
            <span className="text-[12.5px] text-ink-2 flex-1 leading-snug">
              Read that as <span className="text-ink font-medium">{detected.bits.join(' · ')}</span>
            </span>
            <span className="text-[12.5px] font-semibold text-ink shrink-0">Use it</span>
          </button>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Course" className="col-span-2 sm:col-span-1">
            <Select value={draft.courseId} onChange={(e) => set('courseId', e.target.value)}>
              <option value="">No course</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code}
                  {c.title ? `: ${c.title}` : ''}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Type" className="col-span-2 sm:col-span-1">
            <Select
              value={draft.kind}
              onChange={(e) => {
                const kind = e.target.value as TaskKind
                setDraft((d) => ({
                  ...d,
                  kind,

                  weight: !carriesWeight(kind) ? '' : d.weight === '' ? String(defaultWeight(kind)) : d.weight,
                }))
              }}
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Due date" className="col-span-1">
            <Input type="date" value={draft.date} onChange={(e) => set('date', e.target.value)} />
          </Field>
          <Field label="Due time" className="col-span-1">
            <Input type="time" value={draft.time} onChange={(e) => set('time', e.target.value)} />
          </Field>

          <Field label="Worth (% of grade)" className="col-span-1" hint="Optional">
            <Input
              type="number"
              min={0}
              max={100}
              step={0.5}
              value={draft.weight}
              placeholder="—"
              onChange={(e) => set('weight', e.target.value)}
            />
          </Field>
          <Field label="How long will it take?" className="col-span-1" hint="Optional">
            <Select value={draft.estimateMin} onChange={(e) => set('estimateMin', e.target.value)}>
              <option value="">Estimate for me</option>
              {ESTIMATES.map((m) => (
                <option key={m} value={m}>
                  {fmtDuration(m, { long: true })}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Notes" hint="Add the prompt, required sources, submission link, or anything else you need.">
          <Textarea
            value={draft.notes}
            onChange={(e) => set('notes', e.target.value)}
            placeholder="Optional"
            className="min-h-20"
          />
        </Field>

        <div>
          <p className="text-[12.5px] font-medium text-ink-2 mb-1.5">Steps (optional)</p>
          {draft.steps.length > 0 && (
            <ul className="flex flex-col gap-1 mb-1.5">
              {draft.steps.map((st, i) => (
                <li key={i} className="flex items-center gap-2 text-[13px] text-ink-2">
                  <span className="h-[15px] w-[15px] rounded-[4px] border-[1.5px] border-line-2 shrink-0" aria-hidden />
                  <span className="flex-1">{st}</span>
                  <button
                    type="button"
                    aria-label={`Remove step ${st}`}
                    onClick={() => set('steps', draft.steps.filter((_, j) => j !== i))}
                    className="text-ink-3 hover:text-ink transition-colors p-0.5"
                  >
                    <X size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center gap-1.5">
            <Input
              value={stepText}
              onChange={(e) => setStepText(e.target.value)}
              placeholder="Break it into steps…"
              aria-label="Add a step"
              className="h-9 text-[13px]"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  if (!stepText.trim()) return
                  set('steps', [...draft.steps, stepText.trim()])
                  setStepText('')
                }
              }}
            />
            <Button
              size="sm"
              variant="quiet"
              disabled={!stepText.trim()}
              onClick={() => {
                set('steps', [...draft.steps, stepText.trim()])
                setStepText('')
              }}
              aria-label="Add step"
            >
              <Plus size={15} />
            </Button>
          </div>
        </div>

        <label className="flex items-center gap-2.5 cursor-pointer select-none">
          <button
            type="button"
            role="checkbox"
            aria-checked={draft.addToToday}
            onClick={() => set('addToToday', !draft.addToToday)}
            className={cx(
              'h-[18px] w-[18px] rounded-[5px] border-[1.5px] grid place-items-center transition-all shrink-0',
              draft.addToToday
                ? 'bg-invert-bg border-invert-bg text-invert-ink'
                : 'border-line-2 text-transparent hover:border-ink',
            )}
          >
            <Check size={12} strokeWidth={3} />
          </button>
          <span className="text-[13.5px] text-ink-2">Add to Today</span>
          {draft.courseId && (
            <CourseDot course={courses.find((c) => c.id === draft.courseId)} size={14} className="ml-auto" />
          )}
        </label>
      </div>
      )}
    </Sheet>
  )
}
