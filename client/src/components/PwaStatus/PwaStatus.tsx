import { RefreshCw, X } from 'lucide-react';
import { useI18n } from '../../hooks/useI18n';
import { usePwaStore } from '../../stores/pwaStore';
import { useMidiStore } from '../../stores/midiStore';
import styles from './PwaStatus.module.css';

export function PwaStatus() {
  const pwa = usePwaStore();
  const isPlaying = useMidiStore((state) => state.playback.isPlaying);
  const { t } = useI18n();
  const showUpdate = pwa.updateReady && !pwa.updateDismissed;
  if (!showUpdate) return null;
  return (
    <div className={styles.notifications} aria-label={t('pwaStatus')}>
      {showUpdate && (
        <section className={styles.notice} aria-label={t('pwaUpdate')}>
          <div className={styles.heading}>
            <RefreshCw size={16} />
            <span role="status">{t('pwaUpdateReady')}</span>
            <button
              type="button"
              className={styles.close}
              aria-label={t('dismissPwaUpdate')}
              onClick={pwa.dismissUpdate}
            >
              <X size={16} />
            </button>
          </div>
          {pwa.updateError && (
            <span role="alert" className={styles.detail}>
              {t('pwaUpdateError')}
            </span>
          )}
          <button
            type="button"
            disabled={
              isPlaying || pwa.isApplying || pwa.installPhase === 'preparing'
            }
            onClick={() => {
              void pwa.applyUpdate();
            }}
          >
            {t(
              isPlaying
                ? 'pwaPauseToUpdate'
                : pwa.isApplying
                  ? 'pwaUpdating'
                  : pwa.installPhase === 'preparing'
                    ? 'pwaWaitForInstall'
                    : 'applyPwaUpdate',
            )}
          </button>
        </section>
      )}
    </div>
  );
}
