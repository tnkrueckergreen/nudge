import { useMemo, useState, type CSSProperties } from 'react'
import { BookOpen, Check, CircleHelp, CornerDownLeft, RotateCcw, Trash2 } from 'lucide-react'
import type { FocusNote } from '../../lib/types'
import { useStore } from '../../lib/store'
import { fmtDay } from '../../lib/date'
import { Button, Panel, SectionTitle, Select, Sheet, Textarea, cx, useToast } from '../ui'

function contextLabel(note: FocusNote, courses: ReturnType<typeof useStore.getState>['courses'], assignments: ReturnType<typeof useStore.getState>['assignments']) {
  const task = note.assignmentId ? assignments.find((item) => item.id === note.assignmentId) : null
  if (task) return task.title
  const course = note.courseId ? courses.find((item) => item.id === note.courseId) : null
  return course?.code
}

function NoteForm({
  onSave,
  compact = false,
}: {
  onSave: (text: string, courseId: string, assignmentId: string) => void
  compact?: boolean
}) {
  const courses = useStore((s) => s.courses).filter((course) => !course.archived)
  const assignments = useStore((s) => s.assignments).filter((assignment) => !assignment.archived && assignment.status !== 'done')
  const [text, setText] = useState('')
  const [courseId, setCourseId] = useState('')
  const [assignmentId, setAssignmentId] = useState('')
  const [showContext, setShowContext] = useState(false)

  const matchingAssignments = useMemo(
    () => assignments.filter((assignment) => !courseId || assignment.courseId === courseId),
    [assignments, courseId],
  )

  const save = () => {
    const value = text.trim()
    if (!value) return
    onSave(value, courseId, assignmentId)
    setText('')
    setCourseId('')
    setAssignmentId('')
    if (compact) setShowContext(false)
  }

  return (
    <div className={cx('flex flex-col', compact ? 'gap-2' : 'gap-3')}>
      <div className="relative">
        <Textarea
          data-autofocus={!compact ? true : undefined}
          value={text}
          onChange={(event) => setText(event.target.value.slice(0, 500))}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              save()
            }
          }}
          placeholder="I’m stuck on…"
          aria-label="What do you need to focus on?"
          rows={compact ? 2 : 4}
          className={cx('pr-12 resize-none', compact ? 'min-h-[58px] text-[13px]' : 'text-[15px]')}
        />
        <button
          type="button"
          onClick={save}
          disabled={!text.trim()}
          aria-label="Save focus note"
          title="Save focus note"
          className="absolute right-2 bottom-2 h-8 w-8 rounded-lg grid place-items-center bg-invert-bg text-invert-ink disabled:opacity-25 transition-opacity"
        >
          <CornerDownLeft size={15} />
        </button>
      </div>

      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setShowContext((value) => !value)}
          className="text-[11.5px] text-ink-3 hover:text-ink-2 transition-colors"
          aria-expanded={showContext}
        >
          {showContext ? 'Hide context' : 'Add course or task'}
        </button>
        <span className="text-[11px] text-ink-3">
          Enter to save · Shift + Enter for a new line
        </span>
      </div>

      {showContext && (
        <div className="grid grid-cols-2 gap-2">
          <Select
            aria-label="Link focus note to a course"
            value={courseId}
            onChange={(event) => {
              setCourseId(event.target.value)
              setAssignmentId('')
            }}
          >
            <option value="">Any course</option>
            {courses.map((course) => <option key={course.id} value={course.id}>{course.code}</option>)}
          </Select>
          <Select
            aria-label="Link focus note to a task"
            value={assignmentId}
            onChange={(event) => {
              const next = event.target.value
              setAssignmentId(next)
              const task = assignments.find((item) => item.id === next)
              if (task?.courseId) setCourseId(task.courseId)
            }}
          >
            <option value="">Any task</option>
            {matchingAssignments.map((assignment) => <option key={assignment.id} value={assignment.id}>{assignment.title}</option>)}
          </Select>
        </div>
      )}
    </div>
  )
}

function NoteRow({ note, reviewed = false }: { note: FocusNote; reviewed?: boolean }) {
  const store = useStore()
  const courses = useStore((s) => s.courses)
  const assignments = useStore((s) => s.assignments)
  const label = contextLabel(note, courses, assignments)

  return (
    <li className={cx('group flex items-start gap-2.5 py-2.5 border-t border-line first:border-t-0', reviewed && 'opacity-60')}>
      <span className={cx('mt-0.5 h-5 w-5 rounded-full grid place-items-center shrink-0', reviewed ? 'bg-[var(--c-good)] text-white' : 'bg-tint text-ink-3')}>
        {reviewed ? <Check size={12} strokeWidth={3} /> : <CircleHelp size={13} />}
      </span>
      <div className="min-w-0 flex-1">
        <p className={cx('text-[13px] leading-snug text-ink', reviewed && 'line-through decoration-ink-3')}>{note.text}</p>
        <div className="flex items-center gap-1.5 mt-1 text-[11px] text-ink-3">
          <span>{fmtDay(new Date(note.createdAt))}</span>
          {label && <><span aria-hidden>·</span><span className="truncate">{label}</span></>}
        </div>
      </div>
      <div className="flex items-center gap-0.5 shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
        <button
          type="button"
          onClick={() => store.markFocusNoteReviewed(note.id, !reviewed)}
          aria-label={reviewed ? 'Reopen focus note' : 'Mark focus note reviewed'}
          title={reviewed ? 'Reopen' : 'Mark reviewed'}
          className="h-7 w-7 grid place-items-center rounded-lg text-ink-3 hover:bg-tint hover:text-ink"
        >
          {reviewed ? <RotateCcw size={13} /> : <Check size={14} />}
        </button>
        <button
          type="button"
          onClick={() => store.removeFocusNote(note.id)}
          aria-label="Delete focus note"
          title="Delete"
          className="h-7 w-7 grid place-items-center rounded-lg text-ink-3 hover:bg-tint hover:text-[var(--c-critical-ink)]"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </li>
  )
}

export function FocusNotes({ onOpenCapture, className, style }: { onOpenCapture?: () => void; className?: string; style?: CSSProperties }) {
  const store = useStore()
  const notes = useStore((s) => s.focusNotes)
  const { toast } = useToast()
  const active = notes.filter((note) => !note.reviewedAt)
  const reviewed = notes.filter((note) => note.reviewedAt)

  const save = (text: string, courseId: string, assignmentId: string) => {
    store.addFocusNote({ text, courseId: courseId || null, assignmentId: assignmentId || null })
    toast('Focus note saved')
  }

  return (
    <Panel as="section" style={style} className={cx('px-3.5 py-3.5', className)}>
      <SectionTitle
        right={
          <span className="inline-flex items-center gap-1 text-[11px] text-ink-3">
            <BookOpen size={12} />
            {active.length} open
          </span>
        }
      >
        Focus notes
      </SectionTitle>
      <p className="text-[12px] text-ink-3 leading-snug mb-3">Capture the thing that feels fuzzy. Nudge will bring it into future study sessions.</p>
      <NoteForm compact onSave={save} />

      {active.length > 0 && (
        <ul className="mt-3">
          {active.slice(0, 5).map((note) => <NoteRow key={note.id} note={note} />)}
        </ul>
      )}
      {active.length > 5 && (
        <p className="text-[11.5px] text-ink-3 mt-2">+ {active.length - 5} more open notes</p>
      )}
      {reviewed.length > 0 && (
        <details className="mt-2 border-t border-line pt-2.5">
          <summary className="cursor-pointer text-[11.5px] text-ink-3 hover:text-ink-2">Reviewed notes ({reviewed.length})</summary>
          <ul className="mt-1">
            {reviewed.map((note) => <NoteRow key={note.id} note={note} reviewed />)}
          </ul>
        </details>
      )}
      {onOpenCapture && (
        <button type="button" onClick={onOpenCapture} className="mt-3 text-[12px] font-medium text-ink-2 hover:text-ink transition-colors">
          Open a larger capture window
        </button>
      )}
    </Panel>
  )
}

export function FocusNoteSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const store = useStore()
  const { toast } = useToast()

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Capture a focus note"
      description="Write down the concept you want to come back to. Keep it rough."
      size="sm"
      footer={
        <div className="flex justify-end">
          <Button onClick={onClose}>Close</Button>
        </div>
      }
    >
      <NoteForm
        onSave={(text, courseId, assignmentId) => {
          store.addFocusNote({ text, courseId: courseId || null, assignmentId: assignmentId || null })
          toast('Focus note saved')
          onClose()
        }}
      />
    </Sheet>
  )
}