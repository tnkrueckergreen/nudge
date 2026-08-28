/* oxlint-disable react/only-export-components -- focus UI and its timer hook share one feature boundary. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Coffee, Minimize2, Pause, Play, Square } from 'lucide-react'
import type { Course, TimerState } from '../../lib/types'
import { takeTimerRecovery, useStore } from '../../lib/store'
import type { Recovery } from '../../lib/timer'
import { CHIME_WINDOW_MS, HEARTBEAT_MS, boundaryAt, liveOf, readHeartbeat, writeHeartbeat } from '../../lib/timer'
import { FOCUS_DONE, START_ENCOURAGEMENT, pick } from '../../lib/copy'
import { fmtDuration } from '../../lib/date'
import { colorOf } from '../../lib/theme'
import { SegmentBar, totalOf } from '../schedule/SessionPlan'
import { Button, CourseDot, IconButton, cx, useToast } from '../ui'

const SUSPEND_GAP_MS = 2 * 60_000

function chime(kind: 'done' | 'break') {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new Ctx()
    const notes = kind === 'done' ? [660, 880] : [520, 392]
    notes.forEach((f, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = f
      gain.gain.setValueAtTime(0.0001, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.16, ctx.currentTime + 0.02 + i * 0.16)
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.55 + i * 0.16)
      osc.connect(gain).connect(ctx.destination)
      osc.start(ctx.currentTime + i * 0.16)
      osc.stop(ctx.currentTime + 0.7 + i * 0.16)
    })
    setTimeout(() => ctx.close(), 1600)
  } catch {

  }
}

function useTick(active: boolean) {
  const [n, force] = useState(0)
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => force((x) => x + 1), 500)
    return () => clearInterval(id)
  }, [active])
  return active ? n : 0
}

const mmss = (sec: number) => {
  const s = Math.max(0, Math.round(sec))
  return `${Math.floor(s / 60)}:${`${s % 60}`.padStart(2, '0')}`
}

const span = (min: number) => (min > 0 && min < 1 ? '<1m' : fmtDuration(min))

export function useTimerEngine() {
  const timer = useStore((s) => s.timer)
  const sound = useStore((s) => s.settings.sound)
  const { toast } = useToast()
  const running = timer?.runningSince != null
  const tick = useTick(running)
  const firedFor = useRef<string | null>(null)

  const announce = useCallback(
    (r: Recovery | null) => {
      if (!r) return
      const away = Math.round(r.awaySec / 60)
      if (r.kind === 'banked') {
        toast(`Resumed an unfinished session. ${span(r.minutes)} logged.`, { tone: 'good' })
        return
      }
      if (r.kind !== 'paused') return
      const t = r.timer
      toast(
        away >= 1 ? `Paused for ${fmtDuration(away)}. That time was not counted.` : 'Paused while you were away.',
        away >= 1 && t
          ? {
              duration: 8000,
              action: {
                label: 'Count it',

                run: () =>
                  useStore.getState().logSession({
                    minutes: away,
                    assignmentId: t.assignmentId,
                    courseId: t.courseId,
                    blockId: t.blockId,
                    source: 'manual',
                    start: new Date(Date.now() - r.awaySec * 1000).toISOString(),
                  }),
              },
            }
          : undefined,
      )
    },
    [toast],
  )

  useEffect(() => {
    announce(takeTimerRecovery())
  }, [announce])

  useEffect(() => {
    if (!running) return
    const beat = () => {
      const prev = readHeartbeat()
      const now = Date.now()

      if (prev && now - prev > SUSPEND_GAP_MS) announce(useStore.getState().reconcileTimer())
      writeHeartbeat(now)
    }
    beat()
    const id = setInterval(beat, HEARTBEAT_MS)

    const onLeave = () => {
      useStore.getState().settleTimer()
      writeHeartbeat()
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') beat()
      else onLeave()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('pagehide', onLeave)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('pagehide', onLeave)
      onLeave()
    }
  }, [running, announce])

  useEffect(() => {
    void tick
    if (!timer || timer.runningSince == null || !timer.phaseTotalSec) return
    if (liveOf(timer).remainingSec > 0) return
    const key = `${timer.id}:${timer.phase}:${timer.rounds}`
    if (firedFor.current === key) return
    firedFor.current = key

    const at = boundaryAt(timer)

    const fresh = at != null && Date.now() - at < CHIME_WINDOW_MS
    const wasWork = timer.phase === 'work'
    if (fresh && sound) chime(wasWork ? 'done' : 'break')
    useStore.getState().completeTimerPhase()
    if (fresh && wasWork) toast(pick(FOCUS_DONE, key), { tone: 'good' })
  }, [tick, timer, sound, toast])
}

function useTimerView() {
  const timer = useStore((s) => s.timer)
  const assignments = useStore((s) => s.assignments)
  const courses = useStore((s) => s.courses)
  const banked = useStore((s) => s.sessions)
  useTick(timer?.runningSince != null)

  const assignment = timer?.assignmentId ? assignments.find((a) => a.id === timer.assignmentId) : undefined
  const course = timer?.courseId ? courses.find((c) => c.id === timer.courseId) : undefined
  if (!timer) return null

  const live = liveOf(timer)

  const totalMin = timer.assignmentId
    ? banked.reduce((s, x) => (x.assignmentId === timer.assignmentId ? s + x.minutes : s), 0) + live.workedSec / 60
    : live.workedSec / 60

  return { timer, live, assignment, course, totalMin }
}

const phaseColor = (t: TimerState, course?: Course) =>
  t.phase === 'break' ? 'var(--c-good)' : t.phase === 'ready' ? 'var(--c-line-2)' : colorOf(course)

const statusWord = (t: TimerState) =>
  t.phase === 'break' ? 'break' : t.phase === 'ready' ? 'ready' : t.runningSince == null ? 'paused' : 'focusing'

export function FocusChip({ onExpand, variant }: { onExpand: () => void; variant: 'rail' | 'header' }) {
  const store = useStore()
  const view = useTimerView()
  if (!view) return null
  const { timer, live, assignment, course } = view

  const paused = timer.runningSince == null
  const label = timer.phase === 'break' ? 'Back soon' : (assignment?.title ?? course?.code ?? timer.label ?? 'Focus')
  const clock = timer.phase === 'ready' ? 'Ready' : mmss(live.remainingSec)
  const rail = variant === 'rail'

  return (
    <div
      className={cx(
        'flex items-center gap-2 rounded-xl border border-line bg-surface-2 min-w-0',
        rail ? 'a-rise mx-2 mb-1 p-1.5' : 'h-9 pl-1.5 pr-1 flex-1',
      )}
    >
      <button
        type="button"
        onClick={onExpand}
        aria-label={`Open focus mode: ${statusWord(timer)}, ${clock}`}
        className="flex items-center gap-2 min-w-0 flex-1 text-left rounded-lg"
      >
        <Ring pct={live.pct} size={rail ? 28 : 24} stroke={rail ? 3 : 2.5} color={phaseColor(timer, course)}>
          {timer.phase === 'break' ? <Coffee size={11} className="text-ink-2" /> : null}
        </Ring>
        <span className="min-w-0">
          <span className="flex items-baseline gap-1.5">
            <span className={cx('font-semibold text-ink tnum leading-none', rail ? 'text-[13.5px]' : 'text-[13px]')}>
              {clock}
            </span>
            <span className="text-[10.5px] text-ink-3 leading-tight">{statusWord(timer)}</span>
          </span>
          <span className="block text-[11px] text-ink-2 truncate leading-tight">{label}</span>
        </span>
      </button>
      {timer.phase !== 'ready' && (
        <IconButton
          label={paused ? 'Resume' : 'Pause'}
          size="xs"
          onClick={paused ? store.resumeTimer : store.pauseTimer}
          className="shrink-0"
        >
          {paused ? <Play size={13} /> : <Pause size={13} />}
        </IconButton>
      )}
    </div>
  )
}

export function FocusOverlay({ onMinimise }: { onMinimise: () => void }) {
  const store = useStore()
  const { toast } = useToast()
  const view = useTimerView()

  const encouragement = useMemo(() => pick(START_ENCOURAGEMENT, view?.timer.id ?? ''), [view?.timer.id])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onMinimise()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onMinimise])

  if (!view) return null
  const { timer, live, assignment, course, totalMin } = view
  const paused = timer.runningSince == null
  const isWork = timer.phase === 'work'
  const isBreak = timer.phase === 'break'

  const end = (finish = false) => {
    const name = assignment?.title
    const res = store.endSitting({ finish })
    onMinimise()
    if (!res) return
    if (finish) {
      toast(
        res.minutes >= 1
          ? `${name ? `${name} d` : 'D'}one. ${span(res.minutes)} logged, ${span(res.totalMin)} total.`
          : 'Done.',
        { tone: 'good', action: { label: 'Undo', run: () => store.undo() } },
      )
    } else if (res.minutes >= 1) {
      toast(
        assignment
          ? `${span(res.minutes)} logged · ${span(res.totalMin)} on ${name} so far.`
          : `${span(res.minutes)} logged. That still counts.`,
        { tone: 'good' },
      )
    } else {
      toast('Too short to log, but you started.')
    }
  }

  const planDone = !!timer.plan && timer.phase === 'ready' && (timer.planIndex ?? 0) >= timer.plan.length - 1
  const heading = isBreak
    ? 'Break'
    : timer.phase === 'ready'
      ? planDone
        ? 'Sitting done'
        : timer.rounds === 1 && timer.justStart
          ? 'Ten minutes. Kept.'
          : `Round ${timer.rounds} done`
      : (assignment?.title ?? course?.code ?? timer.label ?? 'Focus')

  const seg = timer.plan?.[timer.planIndex ?? 0]
  const nextSeg = timer.plan?.[(timer.planIndex ?? 0) + 1]

  const playedMin = timer.plan
    ? (planDone
        ? totalOf(timer.plan)
        : timer.plan.slice(0, timer.planIndex ?? 0).reduce((n, x) => n + x.minutes, 0) +
          Math.min(seg?.minutes ?? 0, live.phaseSec / 60))
    : undefined

  const blurb = planDone
    ? 'All parts are complete. Stop the clock to log the session.'
    : seg
    ? nextSeg

      ? `${seg.label}. Then ${nextSeg.minutes} min: ${nextSeg.label}.`
      : `${seg.label}. Last stretch of this sitting.`
    : isBreak
      ? 'Water, window, walk. Come back in a minute.'
      : timer.phase === 'ready'
        ? 'Nothing is being counted until you start again.'
        : timer.justStart
          ? encouragement
          :
            (timer.label ?? 'One thing, this window, until the timer stops.')

  return createPortal(
    <div className="fixed inset-0 z-[70] bg-bg flex flex-col a-fade">

      <header className="relative z-10 shrink-0 flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2 min-w-0">
          {course && <CourseDot course={course} size={15} />}
          <span className="text-[13px] font-medium text-ink-2 truncate">
            {isBreak ? 'Break' : (course?.code ?? 'Focus')}
          </span>
        </div>
        <IconButton label="Minimise" onClick={onMinimise} title="Minimise (Esc)">
          <Minimize2 size={17} />
        </IconButton>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col items-center justify-center px-6 pb-12">
        <Ring pct={live.pct} size={248} stroke={9} color={phaseColor(timer, course)}>
          <div className="text-center">
            <div className="text-[54px] font-semibold leading-none text-ink tracking-tight tnum">
              {timer.phase === 'ready' ? '—' : mmss(live.remainingSec)}
            </div>
            <div className="mt-1.5 text-[12.5px] font-medium uppercase tracking-[0.1em] text-ink-3">

              {timer.plan
                ? planDone
                  ? 'Sitting complete'
                  : `Stretch ${(timer.planIndex ?? 0) + 1} of ${timer.plan.length}`
                : isBreak
                  ? 'Break'
                  : timer.phase === 'ready'
                    ? 'Paused between rounds'
                    : timer.justStart
                      ? 'Just start'
                      : `Round ${timer.rounds + 1}`}
            </div>
          </div>
        </Ring>

        <h2 className="mt-8 text-[19px] font-semibold text-ink text-center max-w-[24ch] leading-snug">{heading}</h2>
        <p className="mt-2 text-[13.5px] text-ink-2 text-center max-w-[34ch] leading-relaxed">{blurb}</p>

        <dl className="mt-7 flex items-stretch divide-x divide-line rounded-xl border border-line bg-surface-2">
          <div className="px-5 py-2.5 text-center">
            <dt className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-3">This session</dt>
            <dd className="mt-0.5 text-[17px] font-semibold text-ink tnum">{span(live.workedSec / 60)}</dd>
          </div>
          <div className="px-5 py-2.5 text-center">
            <dt className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-3">
              {assignment ? 'Total on this task' : 'Total today'}
            </dt>
            <dd className="mt-0.5 text-[17px] font-semibold text-ink tnum">{span(totalMin)}</dd>
          </div>
        </dl>

        {timer.plan && timer.plan.length > 1 && (
          <div className="mt-7 w-full max-w-[320px]">
            <SegmentBar segments={timer.plan} playedMin={playedMin} />

            <div className="mt-2 flex items-baseline justify-between gap-3 text-[11.5px] tnum">
              <span className="text-ink-3">{span(totalOf(timer.plan))} sitting</span>
              <span className="text-ink-2">
                {planDone ? 'all of it done' : `${span(totalOf(timer.plan) - (playedMin ?? 0))} to go`}
              </span>
            </div>
          </div>
        )}

        {timer.phase === 'ready' && live.overSec > 90 && (
          <p className="mt-3 text-[12.5px] text-ink-3">
            Waiting {fmtDuration(live.overSec / 60)}. That time was not counted.
          </p>
        )}

        <div className="mt-8 flex items-center gap-2.5">
          {isWork && (
            <Button size="lg" variant="secondary" onClick={paused ? store.resumeTimer : store.pauseTimer} className="w-[122px]">
              {paused ? <Play size={17} /> : <Pause size={17} />}
              {paused ? 'Resume' : 'Pause'}
            </Button>
          )}
          {isWork ? (
            <Button size="lg" variant="primary" onClick={() => end()}>
              <Square size={14} />
              Stop
            </Button>
          ) : (
            <>

              {planDone ? (
                <>
                  <Button size="lg" variant="secondary" onClick={store.startNextRound} className="w-[132px]">
                    <Play size={16} />
                    One more
                  </Button>
                  <Button size="lg" variant="primary" onClick={() => end()}>
                    <Check size={15} />
                    Log it and stop
                  </Button>
                </>
              ) : (
                <>
                  <Button size="lg" variant="secondary" onClick={() => end()} className="w-[122px]">
                    <Square size={14} />
                    Stop
                  </Button>
                  <Button size="lg" variant="primary" onClick={store.startNextRound}>
                    <Play size={16} />
                    {isBreak ? 'Back to it' : `Round ${timer.rounds + 1}`}
                  </Button>
                </>
              )}
            </>
          )}
        </div>

        {assignment && (
          <button
            onClick={() => end(true)}
            className="mt-5 inline-flex items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink transition-colors"
          >
            <Check size={14} />
            Finish this assignment
          </button>
        )}
      </div>
    </div>,
    document.body,
  )
}

export function Ring({
  pct,
  size,
  stroke,
  color,
  children,
}: {
  pct: number
  size: number
  stroke: number
  color: string
  children?: React.ReactNode
}) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  return (
    <div className="relative shrink-0 grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--c-sunken)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - Math.max(0, Math.min(1, pct)))}
          style={{ transition: 'stroke-dashoffset .5s linear' }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">{children}</div>
    </div>
  )
}
