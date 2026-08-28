import { useMemo, useState } from 'react'
import { Archive, ArchiveRestore, Trash2 } from 'lucide-react'
import type { ColorSlot, Course } from '../../lib/types'
import { useStore } from '../../lib/store'
import { knownBuildings } from '../../lib/meetings'
import { courseColor } from '../../lib/theme'
import { Button, ConfirmDialog, Field, Input, Sheet, cx, useToast } from '../ui'
import { ClassTimesEditor } from './ClassTimesEditor'

const SLOTS: ColorSlot[] = [1, 2, 3, 4, 5, 6, 7, 8]

export function CourseSheet({
  course,
  onClose,
}: {

  course: Course | null
  onClose: () => void
}) {
  const store = useStore()
  const courses = useStore((s) => s.courses)
  const { toast } = useToast()
  const [confirmDelete, setConfirmDelete] = useState(false)

  const [draft, setDraft] = useState<Omit<Course, 'id' | 'createdAt'>>(() => ({
    code: course?.code ?? '',
    title: course?.title ?? '',
    color:
      course?.color ??
      (SLOTS.find((s) => !courses.some((c) => c.color === s)) ?? ((courses.length % 8) + 1)) as ColorSlot,
    professor: course?.professor ?? '',
    room: course?.room ?? '',
    currentGrade: course?.currentGrade,
    targetGrade: course?.targetGrade ?? 85,
    meetings: course?.meetings ?? [],
  }))

  const set = <K extends keyof typeof draft>(k: K, v: (typeof draft)[K]) => setDraft((d) => ({ ...d, [k]: v }))

  const valid = draft.code.trim().length >= 2

  const buildings = useMemo(() => knownBuildings(courses), [courses])

  const save = () => {
    if (!valid) return
    if (course) {
      store.updateCourse(course.id, draft)
      toast('Course updated')
    } else {
      const c = store.addCourse({ ...draft, code: draft.code })
      toast(`${c.code} added`, { action: { label: 'Undo', run: () => store.undo() } })
    }
    onClose()
  }

  return (
    <>
      <Sheet
        open
        onClose={onClose}
        title={course ? `Edit ${course.code}` : 'Add a course'}
        description={course ? undefined : 'Start with the course code. You can add the other details later.'}
        size="lg"
        footer={
          <div className="flex items-center gap-2">
            {course && (
              <Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)} aria-label="Delete course">
                <Trash2 size={14} />
              </Button>
            )}
            {course && (
              <Button
                size="sm"
                onClick={() => {
                  const next = !course.archived
                  store.setCourseArchived(course.id, next)
                  toast(next ? `${course.code} archived` : `${course.code} restored`, {
                    action: { label: 'Undo', run: () => store.undo() },
                  })
                  onClose()
                }}
              >
                {course.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
                {course.archived ? 'Restore' : 'Archive'}
              </Button>
            )}
            <div className="flex-1" />
            <Button size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={save} disabled={!valid}>
              {course ? 'Save' : 'Add course'}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Course code" className="col-span-2 sm:col-span-1">
              <Input
                data-autofocus
                value={draft.code}
                onChange={(e) => set('code', e.target.value)}
                placeholder="COMP 250"
                autoCapitalize="characters"
                spellCheck={false}
                onKeyDown={(e) => e.key === 'Enter' && valid && save()}
              />
            </Field>
            <Field label="Title (optional)" className="col-span-2 sm:col-span-1">
              <Input
                value={draft.title ?? ''}
                onChange={(e) => set('title', e.target.value)}
                placeholder="Intro to Computer Science"
              />
            </Field>
          </div>

          <Field group label="Colour">
            <div className="flex items-start gap-1.5 flex-wrap">
              {SLOTS.map((s) => {
                const owner = courses.find((c) => c.color === s && c.id !== course?.id)
                const selected = draft.color === s
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => set('color', s)}
                    aria-label={owner ? `Colour ${s}, already used by ${owner.code}` : `Colour ${s}, free`}
                    aria-pressed={selected}
                    title={owner ? `Already used by ${owner.code}` : undefined}
                    className="w-[52px] flex flex-col items-center gap-1 group/sw"
                  >
                    <span
                      className={cx(
                        'h-8 w-8 rounded-full transition-all duration-150',
                        'group-hover/sw:scale-110 group-active/sw:scale-95',
                        selected && 'ring-2 ring-ink ring-offset-2 ring-offset-surface',
                      )}
                      style={{ background: courseColor(s), opacity: owner && !selected ? 0.4 : 1 }}
                    />

                    <span

                      aria-hidden
                      className={cx(
                        'h-[11px] text-[9.5px] leading-[11px] font-medium tracking-tight w-full text-center truncate',
                        owner ? 'text-ink-3' : 'text-transparent',
                      )}
                    >
                      {owner ? owner.code.split(' ')[0] : '—'}
                    </span>
                  </button>
                )
              })}
            </div>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Professor" className="col-span-2 sm:col-span-1">
              <Input
                value={draft.professor ?? ''}
                onChange={(e) => set('professor', e.target.value)}
                placeholder="Prof. Alberini"
              />
            </Field>

            <Field
              label="Usual room"
              className="col-span-2 sm:col-span-1"
              hint="Used for any class time you leave blank."
            >
              <Input value={draft.room ?? ''} onChange={(e) => set('room', e.target.value)} placeholder="Leacock 132" />
            </Field>
            <Field label="Current grade (%)" hint="Optional. Nudge can also calculate this from marked tasks.">
              <Input
                type="number"
                min={0}
                max={100}
                value={draft.currentGrade ?? ''}
                placeholder="—"
                onChange={(e) => set('currentGrade', e.target.value === '' ? undefined : Number(e.target.value))}
              />
            </Field>
            <Field label="Target grade (%)">
              <Input
                type="number"
                min={0}
                max={100}
                value={draft.targetGrade ?? ''}
                onChange={(e) => set('targetGrade', e.target.value === '' ? undefined : Number(e.target.value))}
              />
            </Field>
          </div>

          <p className="rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-[12px] leading-relaxed text-ink-2">
            Schedule exams from Plan → Customize planner. That keeps the exact date and time in one place.
          </p>

          <ClassTimesEditor
            meetings={draft.meetings}
            onChange={(meetings) => set('meetings', meetings)}
            buildings={buildings}
            defaultRoom={draft.room?.trim() || undefined}
          />
        </div>
      </Sheet>

      {course && (
        <ConfirmDialog
          open={confirmDelete}
          onClose={() => setConfirmDelete(false)}
          onConfirm={() => {
            store.removeCourse(course.id)
            onClose()
            toast(`${course.code} deleted`, { action: { label: 'Undo', run: () => store.undo() } })
          }}
          title={`Delete ${course.code}?`}
          body="Its tasks and study blocks go too. You can undo this straight away."
        />
      )}
    </>
  )
}
