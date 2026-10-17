import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useMidiStore } from '../../stores/midiStore';
import { useI18n } from '../../hooks/useI18n';
import {
  FEEDBACK_DURATION_MS,
  VELOCITY_TOLERANCE,
  followNoteKey,
  pendingGroup,
  type FollowResult,
} from '../../lib/followMode';
import {
  getNoteNameFromNumber,
  isBlackKey,
  type MidiNote,
} from '../../types/midi';
import styles from './FollowFeedback.module.css';

interface Cue {
  note: MidiNote;
  kind: 'waiting' | 'correct' | 'wrong' | 'done';
  result?: FollowResult;
}

interface Anchor {
  x: number;
  y: number;
  timingY: number;
  compact?: boolean;
}

/** All three renderers supply anchors; they share the same DOM feedback. */
export function FollowFeedback({
  minNote,
  maxNote,
}: {
  minNote: number;
  maxNote: number;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const waitMode = useMidiStore((s) => s.playback.waitMode);
  const isPlaying = useMidiStore((s) => s.playback.isPlaying);
  const currentTime = useMidiStore((s) => s.playback.currentTime);
  const notes = useMidiStore((s) => s.waitModeSortedNotes);
  const satisfied = useMidiStore((s) => s.waitModeSatisfiedIndices);
  const pending = useMidiStore((s) => s.waitModePendingIndex);
  const results = useMidiStore((s) => s.followResults);
  const settings = useMidiStore((s) => s.settings);
  const { t } = useI18n();
  const [detail, setDetail] = useState<FollowResult | null>(null);
  const [pulse, setPulse] = useState<number | null>(null);
  const [, refresh] = useState(0);
  const seenResult = useRef(0);
  const lastResult = results[results.length - 1];
  const enabled =
    waitMode &&
    (settings.followPitchFeedback ||
      settings.followTimingFeedback ||
      settings.followVelocityFeedback);

  // Results disappear after one beat-sized glimpse. Their data remains available
  // on paused notes; re-enabling a hint never replays an earlier hit animation.
  useEffect(() => {
    const fresh = lastResult && seenResult.current !== lastResult.id;
    seenResult.current = lastResult?.id ?? 0;
    setPulse(fresh && isPlaying ? lastResult.id : null);
    const timeout = window.setTimeout(
      () => {
        setPulse(null);
        refresh((n) => n + 1);
      },
      Math.max(
        0,
        FEEDBACK_DURATION_MS -
          (performance.now() - (lastResult?.timestamp ?? 0)),
      ) + 10,
    );
    return () => window.clearTimeout(timeout);
  }, [
    lastResult,
    isPlaying,
    settings.followPitchFeedback,
    settings.followTimingFeedback,
    settings.followVelocityFeedback,
  ]);

  const describe = (result: FollowResult): string[] => {
    const parts: string[] = [];
    if (settings.followPitchFeedback)
      parts.push(
        result.kind === 'wrong'
          ? t('followWrongDetail', {
              actual: getNoteNameFromNumber(result.inputPitch),
              expected: getNoteNameFromNumber(result.note.noteNumber),
            })
          : t('followCorrectDetail', {
              note: getNoteNameFromNumber(result.note.noteNumber),
            }),
      );
    if (result.kind === 'correct') {
      if (settings.followTimingFeedback)
        parts.push(
          result.timing === 'waited'
            ? t('followWaitedDetail')
            : t(
                result.timing === 'early'
                  ? 'followEarlyDetail'
                  : result.timing === 'late'
                    ? 'followLateDetail'
                    : 'followOnTimeDetail',
                { ms: Math.abs(result.offsetMs ?? 0) },
              ),
        );
      if (settings.followVelocityFeedback)
        parts.push(
          result.velocity === null
            ? t('followFixedVelocityDetail')
            : result.referenceVelocity === null
              ? t('followNoReferenceDetail')
              : t('followVelocityDetail', {
                  actual: result.velocity,
                  reference: result.referenceVelocity,
                }),
        );
    }
    return parts;
  };

  const cues: Cue[] = [];
  if (enabled) {
    const state = useMidiStore.getState();
    let group = pendingGroup(notes, pending);
    const recent =
      lastResult &&
      performance.now() - lastResult.timestamp < FEEDBACK_DURATION_MS;
    const pendingDue =
      group.length && notes[group[0]].startTime <= currentTime + 0.025;
    if (recent && !pendingDue)
      group = pendingGroup(notes, notes.indexOf(lastResult.note));
    else if (
      group.length &&
      ((notes[group[0]].startTime - state.playback.currentTime) /
        state.playback.speed) *
        1000 >
        settings.waitModeGracePeriod
    )
      group = [];
    const chord = group.length > 1;
    for (const index of group) {
      const note = notes[index];
      const result = results.find((r) => r.note === note);
      const recentResult =
        result && performance.now() - result.timestamp < FEEDBACK_DURATION_MS;
      if (satisfied.has(index)) {
        if (chord && (!recentResult || result !== lastResult))
          cues.push({ note, kind: 'done', result });
        else if (recentResult) cues.push({ note, kind: 'correct', result });
      } else
        cues.push({
          note,
          kind: recentResult && result.kind === 'wrong' ? 'wrong' : 'waiting',
          result: recentResult ? result : undefined,
        });
    }
  }
  const cuesRef = useRef(cues);
  cuesRef.current = cues;

  // Read the engraved glyphs after layout. This also follows scroll, responsive
  // re-engraving, fullscreen and the existing keyboard's changing height.
  useEffect(() => {
    const root = rootRef.current,
      main = root?.parentElement;
    if (!root || !main || !enabled) return;
    let frame = 0;
    const cache = new Map<string, SVGGraphicsElement>();
    const anchor = (note: MidiNote): Anchor | null => {
      const base = main.getBoundingClientRect();
      const view = main.querySelector<HTMLElement>('[data-follow-view]');
      if (!view) return null;
      const bounds = view.getBoundingClientRect();
      root.style.height = `${bounds.bottom - base.top}px`;
      if (view.dataset.followView === 'falling') {
        if (note.noteNumber < minNote || note.noteNumber > maxNote) return null;
        let whites = 0,
          before = 0;
        for (let p = minNote; p <= maxNote; p++)
          if (!isBlackKey(p)) {
            whites++;
            if (p < note.noteNumber) before++;
          }
        const black = isBlackKey(note.noteNumber);
        const x =
          bounds.left -
          base.left +
          ((before + (black ? 0 : 0.5)) / whites) * bounds.width;
        const time = useMidiStore.getState().playback.currentTime;
        const y =
          bounds.bottom -
          base.top -
          (Math.max(0, note.startTime - time) * bounds.height) / 3 -
          12;
        return { x, y, timingY: y - 45 };
      }
      const key = followNoteKey(note);
      let head = cache.get(key);
      if (!head?.isConnected || !view.contains(head)) {
        head =
          view.querySelector<SVGGraphicsElement>(
            `[data-follow-note~="${key}"]`,
          ) ?? undefined;
        if (!head) return null;
        cache.set(key, head);
      }
      const rect = head.getBoundingClientRect();
      let x = rect.left + rect.width / 2,
        y = rect.top + rect.height / 2;
      if (head.dataset.followX && head.dataset.followY) {
        const matrix = head.getScreenCTM();
        if (!matrix) return null;
        const point = new DOMPoint(
          Number(head.dataset.followX),
          Number(head.dataset.followY),
        ).matrixTransform(matrix);
        x = point.x;
        y = point.y;
      }
      if (
        y < bounds.top ||
        y > bounds.bottom ||
        x < bounds.left ||
        x > bounds.right
      )
        return null;
      const noteRect = head
        .closest('.note,.vf-stavenote')
        ?.getBoundingClientRect();
      let timingY = Math.max(bounds.top + 12, (noteRect?.top ?? y - 24) - 15);
      const system = head.closest('.system') ?? head.closest('svg');
      const obstacles = [
        ...(system?.querySelectorAll<SVGGraphicsElement>(
          '.beam,.tempo,.dynam,.harm,.syl,.dir,.vf-beam',
        ) ?? []),
      ].map((element) => element.getBoundingClientRect());
      const collides = (top: number) =>
        obstacles.some(
          (r) =>
            r.width > 0 &&
            r.left < x + 20 &&
            r.right > x - 20 &&
            r.top < top + 11 &&
            r.bottom > top,
        );
      let attempts = 0;
      while (collides(timingY) && timingY > bounds.top + 24 && attempts++ < 3)
        timingY -= 13;
      const compact = collides(timingY);
      return {
        x: x - base.left,
        y: y - base.top,
        timingY:
          (compact ? Math.max(bounds.top + 8, y - 20) : timingY) - base.top,
        compact,
      };
    };
    const position = () => {
      for (const mark of root.querySelectorAll<HTMLElement>('[data-cue-key]')) {
        const cue = cuesRef.current.find(
          (c) => followNoteKey(c.note) === mark.dataset.cueKey,
        );
        const point = cue && anchor(cue.note);
        mark.hidden = !point;
        if (point) {
          mark.dataset.timingCompact = String(Boolean(point.compact));
          mark.style.left = `${point.x}px`;
          mark.style.top = `${point.y}px`;
          mark.style.setProperty(
            '--timing-top',
            `${point.timingY - point.y}px`,
          );
        }
      }
      const popup = popupRef.current;
      if (popup && detail) {
        const point = anchor(detail.note);
        popup.hidden = !point;
        if (point) {
          popup.style.left = `${Math.max(8, Math.min(main.clientWidth - popup.offsetWidth - 8, point.x + 24))}px`;
          popup.style.top = `${Math.max(8, Math.min(root.clientHeight - popup.offsetHeight - 8, point.timingY - 10))}px`;
        }
      }
      frame = requestAnimationFrame(position);
    };
    frame = requestAnimationFrame(position);
    return () => cancelAnimationFrame(frame);
  }, [enabled, minNote, maxNote, detail]);

  useEffect(() => {
    const main = rootRef.current?.parentElement;
    if (!main || !enabled) return;
    const click = (event: MouseEvent) => {
      const state = useMidiStore.getState();
      if (state.playback.isPlaying) return;
      const target = event.target as Element;
      const head =
        target.closest<SVGElement>('[data-follow-note]') ??
        target
          .closest('.note,.vf-stavenote')
          ?.querySelector<SVGElement>('[data-follow-note]');
      let result = head
        ? state.followResults.find((r) =>
            head.dataset.followNote?.split(' ').includes(followNoteKey(r.note)),
          )
        : undefined;
      const falling = target.closest('[data-follow-view="falling"]');
      if (!head && falling) {
        const bounds = falling.getBoundingClientRect();
        let whites = 0;
        for (let p = minNote; p <= maxNote; p++) if (!isBlackKey(p)) whites++;
        result = [...state.followResults].reverse().find((r) => {
          let before = 0;
          for (let p = minNote; p < r.note.noteNumber; p++)
            if (!isBlackKey(p)) before++;
          const x =
            bounds.left +
            ((before + (isBlackKey(r.note.noteNumber) ? 0 : 0.5)) / whites) *
              bounds.width;
          const bottom =
            bounds.bottom -
            ((r.note.startTime - state.playback.currentTime) / 3) *
              bounds.height;
          const top = bottom - (r.note.duration / 3) * bounds.height;
          return (
            Math.abs(event.clientX - x) < bounds.width / whites / 2 &&
            event.clientY >= top &&
            event.clientY <= Math.min(bounds.bottom, bottom)
          );
        });
      }
      if (
        result &&
        (state.settings.followPitchFeedback ||
          (result.kind === 'correct' &&
            (state.settings.followTimingFeedback ||
              state.settings.followVelocityFeedback)))
      ) {
        event.preventDefault();
        event.stopPropagation();
        setDetail(result);
      } else if (!popupRef.current?.contains(target)) setDetail(null);
    };
    main.addEventListener('click', click, true);
    return () => main.removeEventListener('click', click, true);
  }, [enabled, minNote, maxNote]);

  useEffect(() => {
    if (isPlaying || !enabled || !results.includes(detail!)) setDetail(null);
  }, [isPlaying, enabled, results, detail]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDetail(null);
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, []);

  const detailParts = detail && enabled ? describe(detail) : [];
  const announcement =
    enabled && lastResult ? describe(lastResult).join('；') : '';
  return (
    <>
      <div
        ref={rootRef}
        className={styles.layer}
        data-testid="follow-feedback"
        aria-hidden="true"
      >
        {cues.map((cue) => (
          <div
            key={followNoteKey(cue.note)}
            className={styles.mark}
            data-cue-key={followNoteKey(cue.note)}
            data-cue-kind={cue.kind}
            style={
              {
                '--actual-radius': `${cue.result?.velocity && cue.result.referenceVelocity ? Math.max(8, Math.min(18, (cue.result.velocity / cue.result.referenceVelocity) * 12)) : 12}px`,
                '--force-start':
                  cue.result?.velocity && cue.result.referenceVelocity
                    ? 12 /
                      Math.max(
                        8,
                        Math.min(
                          18,
                          (cue.result.velocity / cue.result.referenceVelocity) *
                            12,
                        ),
                      )
                    : 1,
              } as CSSProperties
            }
          >
            {settings.followPitchFeedback && (
              <span
                className={`${styles.signal} ${cue.kind === 'wrong' ? styles.wrong : cue.kind === 'waiting' ? styles.wait : styles.good}`}
                data-feedback="pitch"
              >
                {cue.kind === 'waiting' ? (
                  <i className={`${styles.ring} ${styles.breathe}`} />
                ) : cue.kind === 'wrong' ? (
                  <>
                    <i className={styles.ring} />
                    <span className={styles.cross}>×</span>
                  </>
                ) : cue.kind === 'done' ? (
                  <i className={styles.dot} />
                ) : (
                  <>
                    <i className={`${styles.ring} ${styles.pitchRing}`} />
                    {pulse === cue.result?.id && (
                      <>
                        <i className={`${styles.ring} ${styles.hit}`} />
                        {Array.from({ length: 5 }, (_, i) => (
                          <i
                            key={i}
                            className={styles.spark}
                            style={
                              {
                                '--dx': `${Math.cos((i / 5) * Math.PI * 2) * 22}px`,
                                '--dy': `${Math.sin((i / 5) * Math.PI * 2) * 22}px`,
                              } as CSSProperties
                            }
                          />
                        ))}
                      </>
                    )}
                  </>
                )}
              </span>
            )}
            {cue.kind === 'correct' && cue.result && (
              <>
                {settings.followTimingFeedback && (
                  <span
                    className={`${styles.signal} ${cue.result.timing === 'waited' ? styles.muted : cue.result.timing === 'on-time' ? styles.good : styles.adjust}`}
                    data-feedback="timing"
                  >
                    <span
                      className={`${styles.timing} ${cue.result.timing === 'waited' ? styles.waited : ''} ${pulse === cue.result.id ? (cue.result.timing === 'early' ? styles.early : cue.result.timing === 'late' ? styles.late : '') : ''}`}
                      style={
                        {
                          '--time-offset': `${Math.max(-16, Math.min(16, (cue.result.offsetMs ?? 0) / 10))}px`,
                        } as CSSProperties
                      }
                    >
                      {cue.result.timing === 'waited' ? (
                        <span className={styles.direction}>Ⅱ</span>
                      ) : (
                        <>
                          <i className={styles.range} />
                          <i className={styles.zero} />
                          <i className={styles.needle} />
                          {cue.result.timing !== 'on-time' && (
                            <span className={styles.direction}>
                              {cue.result.timing === 'early' ? '‹' : '›'}
                            </span>
                          )}
                        </>
                      )}
                    </span>
                  </span>
                )}
                {settings.followVelocityFeedback && (
                  <span
                    className={`${styles.signal} ${cue.result.velocity === null || cue.result.referenceVelocity === null ? styles.muted : Math.abs(cue.result.velocity - cue.result.referenceVelocity) > VELOCITY_TOLERANCE ? styles.adjust : styles.good}`}
                    data-feedback="velocity"
                  >
                    <i className={`${styles.ring} ${styles.reference}`} />
                    {cue.result.velocity !== null &&
                      cue.result.referenceVelocity !== null && (
                        <>
                          <i
                            className={`${styles.ring} ${styles.force} ${pulse === cue.result.id ? styles.forceIn : ''}`}
                          />
                          {Math.abs(
                            cue.result.velocity - cue.result.referenceVelocity,
                          ) > VELOCITY_TOLERANCE && (
                            <span className={styles.forceDirection}>
                              {cue.result.velocity <
                              cue.result.referenceVelocity
                                ? '↑'
                                : '↓'}
                            </span>
                          )}
                        </>
                      )}
                  </span>
                )}
              </>
            )}
          </div>
        ))}
      </div>
      {detail && detailParts.length > 0 && (
        <div
          ref={popupRef}
          className={styles.popup}
          role="dialog"
          aria-label={t('followNoteDetail')}
          data-testid="follow-note-detail"
        >
          <button
            onClick={() => setDetail(null)}
            aria-label={t('closeFollowDetail')}
          >
            ×
          </button>
          <strong>{getNoteNameFromNumber(detail.note.noteNumber)}</strong>
          {detailParts.map((part) => (
            <div key={part}>{part}</div>
          ))}
        </div>
      )}
      <div
        className={styles.srOnly}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {announcement}
      </div>
    </>
  );
}
