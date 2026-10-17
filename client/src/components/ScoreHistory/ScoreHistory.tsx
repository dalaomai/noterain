import { useEffect, useRef, useState } from 'react';
import { Clock3, LoaderCircle, Trash2, X } from 'lucide-react';
import { useI18n } from '../../hooks/useI18n';
import { useMidiFile } from '../../hooks/useMidiFile';
import { useScoreHistoryStore } from '../../stores/scoreHistoryStore';
import type { ScoreHistoryEntry } from '../../types/midi';
import { loadScoreHistoryFile } from '../../utils/midiDb';
import styles from './ScoreHistory.module.css';

interface ScoreHistoryProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ScoreHistory({ isOpen, onClose }: ScoreHistoryProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [importError, setImportError] = useState(false);
  const { entries, isLoading, error, refresh, remove, touch } =
    useScoreHistoryStore();
  const { files, setCurrentFile, loadFile } = useMidiFile();
  const { locale, t } = useI18n();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (isOpen) {
      setImportError(false);
      if (dialog && !dialog.open) {
        dialog.showModal();
        const list = dialog.querySelector('ul');
        if (list) list.scrollTop = 0;
      }
      void refresh();
    } else if (dialog?.open) {
      dialog.close();
    }
  }, [isOpen, refresh]);

  const openEntry = async (entry: ScoreHistoryEntry) => {
    if (loadingId) return;
    setLoadingId(entry.id);
    setImportError(false);
    try {
      const loaded = files.find((file) => file.historyId === entry.id);
      if (loaded) {
        setCurrentFile(loaded.id);
        await touch(entry.id);
      } else {
        await loadFile(await loadScoreHistoryFile(entry.id));
      }
      onClose();
    } catch (error) {
      console.warn('[ScoreHistory] Cannot import saved score:', error);
      setImportError(true);
      void refresh();
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby="score-history-title"
      aria-describedby="score-history-description"
      onCancel={onClose}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={styles.content}>
        <header className={styles.header}>
          <h2 id="score-history-title">
            <Clock3 size={19} /> {t('scoreHistory')}
          </h2>
          <button
            type="button"
            className={styles.iconButton}
            aria-label={t('closeHistory')}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>
        <p id="score-history-description" className={styles.description}>
          {t('scoreHistoryDescription')}
        </p>
        {(error || importError) && (
          <p className={styles.error} role="alert">
            {t(
              importError
                ? 'historyImportError'
                : error === 'save'
                  ? 'historySaveError'
                  : 'historyStorageError',
            )}
          </p>
        )}
        {isLoading && entries.length === 0 ? (
          <p className={styles.empty} role="status">
            {t('historyLoading')}
          </p>
        ) : entries.length === 0 ? (
          <p className={styles.empty}>{t('historyEmpty')}</p>
        ) : (
          <ul className={styles.list}>
            {entries.map((entry) => (
              <li key={entry.id} className={styles.entry}>
                <button
                  type="button"
                  className={styles.loadButton}
                  data-history-id={entry.id}
                  title={t('loadHistoryScore', {
                    name: entry.title || entry.fileName,
                  })}
                  disabled={loadingId !== null}
                  onClick={() => {
                    void openEntry(entry);
                  }}
                >
                  <span className={styles.name}>
                    {entry.title || entry.fileName}
                  </span>
                  {entry.title && entry.title !== entry.fileName && (
                    <span className={styles.fileName}>{entry.fileName}</span>
                  )}
                  <span className={styles.details}>
                    {entry.sourceFormat === 'musicxml' ? 'MusicXML' : 'MIDI'}
                    {' · '}
                    {new Date(entry.lastImportedAt).toLocaleString(
                      locale === 'zh' ? 'zh-CN' : 'en',
                      {
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      },
                    )}
                  </span>
                </button>
                {loadingId === entry.id && (
                  <LoaderCircle
                    className={styles.spinner}
                    size={18}
                    aria-label={t('historyLoading')}
                  />
                )}
                <button
                  type="button"
                  className={styles.iconButton}
                  title={t('removeHistoryScore', {
                    name: entry.title || entry.fileName,
                  })}
                  aria-label={t('removeHistoryScore', {
                    name: entry.title || entry.fileName,
                  })}
                  disabled={loadingId !== null}
                  onClick={() => {
                    void remove(entry.id);
                  }}
                >
                  <Trash2 size={17} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </dialog>
  );
}
