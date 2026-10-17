import { useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { GripVertical, Pause, Play } from 'lucide-react';
import { useI18n } from '../../hooks/useI18n';
import styles from './FloatingPlaybackRemote.module.css';

const POSITION_KEY = 'noterain-floating-remote-position';
interface Position {
  x: number;
  y: number;
}
interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
interface FloatingPlaybackRemoteProps {
  isPlaying: boolean;
  onTogglePlay: () => Promise<void>;
}

const clamp = (value: number) => Math.max(0, Math.min(1, value));

function readPosition(): Position {
  try {
    const saved = JSON.parse(localStorage.getItem(POSITION_KEY) ?? 'null');
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
      return { x: clamp(saved.x), y: clamp(saved.y) };
    }
  } catch {
    /* Use the lower right corner if storage is unavailable. */
  }
  return { x: 1, y: 1 };
}

export function FloatingPlaybackRemote({
  isPlaying,
  onTogglePlay,
}: FloatingPlaybackRemoteProps) {
  const { t } = useI18n();
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const [position, setPosition] = useState(readPosition);
  const positionRef = useRef(position);
  const panelRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  useLayoutEffect(() => {
    setHost(document.querySelector<HTMLDivElement>('.main-content'));
  }, []);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!host || !panel) return;
    const keyboard = host.querySelector<HTMLElement>('[class*=_keyboard_]');
    const toolbar = document.getElementById('playback-toolbar');
    const measure = () => {
      const rect = host.getBoundingClientRect();
      const toolbarBottom =
        toolbar && !toolbar.inert
          ? (toolbar.parentElement?.getBoundingClientRect().top ?? 0) +
            toolbar.offsetTop +
            toolbar.offsetHeight
          : rect.top;
      const top = Math.max(0, toolbarBottom - rect.top) + 8;
      const next = {
        left: 8,
        top,
        right: Math.max(8, host.clientWidth - panel.offsetWidth - 8),
        bottom: Math.max(
          top,
          (keyboard?.getBoundingClientRect().top ?? rect.bottom) -
            rect.top -
            panel.offsetHeight -
            8,
        ),
      };
      setBounds((previous) =>
        previous &&
        Object.keys(next).every(
          (key) => previous[key as keyof Bounds] === next[key as keyof Bounds],
        )
          ? previous
          : next,
      );
    };
    const resize = new ResizeObserver(measure);
    for (const element of [host, panel, keyboard, toolbar])
      if (element) resize.observe(element);
    const mutation = new MutationObserver(measure);
    if (toolbar)
      mutation.observe(toolbar, {
        attributes: true,
        attributeFilter: ['inert', 'aria-hidden'],
      });
    measure();
    return () => {
      resize.disconnect();
      mutation.disconnect();
    };
  }, [host]);

  const move = (left: number, top: number) => {
    if (!bounds) return;
    const next = {
      x:
        bounds.right > bounds.left
          ? clamp((left - bounds.left) / (bounds.right - bounds.left))
          : 0,
      y:
        bounds.bottom > bounds.top
          ? clamp((top - bounds.top) / (bounds.bottom - bounds.top))
          : 0,
    };
    positionRef.current = next;
    setPosition(next);
  };
  const savePosition = () => {
    try {
      localStorage.setItem(POSITION_KEY, JSON.stringify(positionRef.current));
    } catch {
      /* Dragging remains available without persistent storage. */
    }
  };
  const finishDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setIsDragging(false);
    savePosition();
  };

  if (!host) return null;
  return createPortal(
    <div
      ref={panelRef}
      className={`${styles.remote}${isDragging ? ` ${styles.dragging}` : ''}`}
      role="toolbar"
      aria-label={t('floatingRemote')}
      style={{
        visibility: bounds ? 'visible' : 'hidden',
        left: bounds
          ? bounds.left + position.x * (bounds.right - bounds.left)
          : 0,
        top: bounds
          ? bounds.top + position.y * (bounds.bottom - bounds.top)
          : 0,
      }}
    >
      <button
        type="button"
        className={styles.dragHandle}
        aria-label={t('moveFloatingRemote')}
        title={t('moveFloatingRemote')}
        onPointerDown={(event) => {
          if (!bounds || event.button !== 0 || !event.isPrimary) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            left: bounds.left + position.x * (bounds.right - bounds.left),
            top: bounds.top + position.y * (bounds.bottom - bounds.top),
          };
          setIsDragging(true);
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (drag?.pointerId === event.pointerId)
            move(
              drag.left + event.clientX - drag.x,
              drag.top + event.clientY - drag.y,
            );
        }}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onLostPointerCapture={finishDrag}
        onKeyDown={(event) => {
          if (!bounds) return;
          const offsets: Record<string, [number, number]> = {
            ArrowLeft: [-12, 0],
            ArrowRight: [12, 0],
            ArrowUp: [0, -12],
            ArrowDown: [0, 12],
          };
          const offset = offsets[event.key];
          if (!offset) return;
          event.preventDefault();
          move(
            bounds.left + position.x * (bounds.right - bounds.left) + offset[0],
            bounds.top + position.y * (bounds.bottom - bounds.top) + offset[1],
          );
          savePosition();
        }}
      >
        <GripVertical size={16} />
      </button>
      <button
        type="button"
        className={`${styles.button} ${styles.playButton}`}
        aria-label={t(isPlaying ? 'pausePlayback' : 'startPlayback')}
        title={t(isPlaying ? 'pausePlayback' : 'startPlayback')}
        onClick={onTogglePlay}
      >
        {isPlaying ? <Pause size={20} /> : <Play size={20} />}
      </button>
    </div>,
    host,
  );
}
