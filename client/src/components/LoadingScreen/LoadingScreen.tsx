import styles from './LoadingScreen.module.css';
import { useI18n } from '../../hooks/useI18n';

type LoadingPhase = 'loading' | 'downloading' | 'decoding' | 'done';

interface LoadingScreenProps {
  phase: LoadingPhase;
  downloadProgress: number;
  decodeProgress: number;
  totalSamples: number;
  totalLayers: number;
}

export function LoadingScreen({
  phase,
  downloadProgress,
  decodeProgress,
  totalSamples,
  totalLayers,
}: LoadingScreenProps) {
  const { t } = useI18n();
  const isLoadingSamples = phase === 'loading' || phase === 'downloading';
  const isDownloading = phase === 'downloading';
  const progress = isLoadingSamples ? downloadProgress : decodeProgress;
  const total = isLoadingSamples ? totalSamples : totalLayers;
  const percentage = Math.round((progress / total) * 100);

  return (
    <div className={styles.overlay}>
      <div className={styles.container}>
        <div className={styles.title}>
          {isLoadingSamples
            ? t(isDownloading ? 'downloadingPianoSamples' : 'loadingPianoSamples')
            : t('decodingPianoSamples')}
        </div>
        <div className={styles.progressBar}>
          <div
            className={styles.progressFill}
            style={{ width: `${percentage}%` }}
          />
        </div>
        <div className={styles.progressText}>
          {isLoadingSamples
            ? t('samplesProgress', { progress, total })
            : t('velocityLayersProgress', { progress, total })}
        </div>
      </div>
    </div>
  );
}
