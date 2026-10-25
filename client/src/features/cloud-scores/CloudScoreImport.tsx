import { useEffect, useState } from 'react';
import { LoadingScreen } from '../../components/LoadingScreen/LoadingScreen';
import { useI18n } from '../../hooks/useI18n';
import type { MidiFile } from '../../types/midi';
import {
  downloadCloudScore,
  searchCloudScores,
} from './cloudApi';
import type { CloudScoreFormat, CloudScoreSummary } from './cloudTypes';
import styles from './CloudScoreImport.module.css';

interface CloudScoreImportProps {
  onClose: () => void;
  onImport: (file: File) => Promise<MidiFile>;
}

export function CloudScoreImport({ onClose, onImport }: CloudScoreImportProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [format, setFormat] = useState<CloudScoreFormat | ''>('');
  const [items, setItems] = useState<CloudScoreSummary[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [importingId, setImportingId] = useState<string | null>(null);
  const importingScore = items.find((score) => score.id === importingId);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setState('loading');
      void searchCloudScores(query, format, controller.signal)
        .then((results) => {
          setItems(results);
          setState('ready');
        })
        .catch((error) => {
          if (error instanceof DOMException && error.name === 'AbortError') return;
          setState('error');
        });
    }, 250);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [format, query]);

  const importScore = async (score: CloudScoreSummary) => {
    setImportingId(score.id);
    try {
      await onImport(await downloadCloudScore(score));
      onClose();
    } catch {
      setState('error');
    } finally {
      setImportingId(null);
    }
  };

  return (
    <>
      <div className={styles.backdrop} role="presentation" onMouseDown={(event) => {
        if (event.target === event.currentTarget && !importingId) onClose();
      }}>
        <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="cloud-score-title">
        <header className={styles.header}>
          <h2 id="cloud-score-title">{t('cloudScores')}</h2>
          <button type="button" className={styles.close} onClick={onClose} aria-label={t('closeCloudScores')}>{t('closeCloudScores')}</button>
        </header>
        <div className={styles.filters}>
          <input
            className={styles.search}
            type="search"
            value={query}
            placeholder={t('cloudScoreSearchPlaceholder')}
            autoFocus
            onChange={(event) => setQuery(event.target.value)}
          />
          <select value={format} onChange={(event) => setFormat(event.target.value as CloudScoreFormat | '')}>
            <option value="">{t('cloudScoreAllFormats')}</option>
            <option value="midi">MIDI</option>
            <option value="musicxml">MusicXML</option>
            <option value="mxl">MXL</option>
            <option value="noterain">NoteRain</option>
          </select>
        </div>
        <div className={styles.results}>
          {state === 'loading' && <div className={styles.state}>{t('cloudScoreSearching')}</div>}
          {state === 'error' && <div className={styles.state}>{t('cloudScoreUnavailable')}</div>}
          {state === 'ready' && !items.length && <div className={styles.state}>{t('cloudScoreEmpty')}</div>}
          {state === 'ready' && items.map((score) => (
            <button
              type="button"
              key={score.id}
              className={styles.item}
              disabled={importingId !== null}
              onClick={() => void importScore(score)}
            >
              <strong>{score.title}</strong>
              <span>{score.format.toUpperCase()}</span>
              <span className={styles.meta}>{score.composer.join(' · ') || score.fileName}</span>
              <span className={styles.meta}>{Math.ceil(score.byteSize / 1024)} KB</span>
            </button>
          ))}
        </div>
        </section>
      </div>
      {importingScore && (
        <LoadingScreen
          phase="loading"
          downloadProgress={0}
          decodeProgress={0}
          totalSamples={0}
          totalLayers={0}
          scoreTitle={importingScore.title}
        />
      )}
    </>
  );
}