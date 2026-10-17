import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { ChevronDown } from 'lucide-react';
import { useI18n } from '../../hooks/useI18n';
import type { MidiFile } from '../../types/midi';
import styles from './Controls.module.css';

interface ScoreSelectorProps {
  files: MidiFile[];
  currentFileId: string | null;
  onChange: (id: string | null) => void;
}

export function ScoreSelector({
  files,
  currentFileId,
  onChange,
}: ScoreSelectorProps) {
  const { t } = useI18n();
  const viewportRef = useRef<HTMLSpanElement>(null);
  const nameRef = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(0);
  const selected = files.find((file) => file.id === currentFileId);
  const name = selected?.title || selected?.name || t('selectFile');

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const text = nameRef.current;
    if (!viewport || !text) return;
    const measure = () =>
      setOverflow(Math.max(0, text.scrollWidth - viewport.clientWidth));
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    observer.observe(text);
    measure();
    return () => observer.disconnect();
  }, [name, currentFileId]);

  return (
    <div
      className={styles.scoreSelector}
      title={selected?.title ? `${selected.title} — ${selected.name}` : name}
    >
      <span
        ref={viewportRef}
        className={styles.scoreNameViewport}
        aria-hidden="true"
      >
        <span
          key={currentFileId}
          ref={nameRef}
          className={`${styles.scoreName}${overflow > 0 ? ` ${styles.scrollingName}` : ''}`}
          style={
            {
              '--name-offset': `-${overflow}px`,
              '--name-duration': `${Math.max(5, overflow / 24 + 3)}s`,
            } as CSSProperties
          }
        >
          {name}
        </span>
      </span>
      <ChevronDown size={14} aria-hidden="true" />
      {/* Retain the system picker and keyboard navigation, with a scrolling visual label. */}
      <select
        className={styles.scoreSelectInput}
        aria-label={t('selectFile')}
        value={currentFileId || ''}
        onChange={(event) => onChange(event.target.value || null)}
      >
        <option value="">{t('selectFile')}</option>
        {files.map((file) => (
          <option key={file.id} value={file.id}>
            {file.title || file.name}
          </option>
        ))}
      </select>
    </div>
  );
}
