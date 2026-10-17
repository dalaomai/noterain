import { useEffect, useState } from 'react';
import { CheckCircle2, Download, RefreshCw, X } from 'lucide-react';
import { useI18n } from '../../hooks/useI18n';
import { useOfflinePackStore } from '../../stores/offlinePackStore';
import { usePwaStore } from '../../stores/pwaStore';
import { useMidiStore } from '../../stores/midiStore';
import styles from './PwaStatus.module.css';

export function PwaStatus() {
  const pwa = usePwaStore();
  const pack = useOfflinePackStore();
  const isPlaying = useMidiStore((state) => state.playback.isPlaying);
  const { t } = useI18n();
  const [readyDismissed, setReadyDismissed] = useState(false);
  useEffect(() => {
    setReadyDismissed(false);
    if (pwa.installPhase !== 'ready') return;
    const timer = window.setTimeout(() => setReadyDismissed(true), 6000);
    return () => clearTimeout(timer);
  }, [pwa.installPhase]);

  const showInstall =
    pwa.installPhase !== 'idle' &&
    (pwa.installPhase !== 'ready' || !readyDismissed);
  const showUpdate = pwa.updateReady && !pwa.updateDismissed;
  if (!showInstall && !showUpdate) return null;
  return (
    <div className={styles.notifications} aria-label={t('pwaStatus')}>
      {showInstall && (
        <section className={styles.notice} aria-label={t('offlineInstall')}>
          <div className={styles.heading} role="status">
            {pwa.installPhase === 'ready' ? (
              <CheckCircle2 size={16} />
            ) : (
              <Download size={16} />
            )}
            <span>
              {t(
                pwa.installPhase === 'ready'
                  ? 'offlineInstallReady'
                  : pwa.installPhase === 'error'
                    ? 'offlineInstallIncomplete'
                    : 'offlineInstallPreparing',
              )}
            </span>
          </div>
          {pwa.installPhase === 'preparing' && (
            <>
              <span className={styles.detail}>
                {t(
                  pwa.coreReady
                    ? 'offlineInstallSamples'
                    : 'offlineInstallApplication',
                  { count: pack.cached, total: pack.total },
                )}
              </span>
              <progress
                aria-label={t('offlineInstallProgress')}
                max={pack.total}
                value={pack.cached}
              />
            </>
          )}
          {pwa.installPhase === 'error' && (
            <>
              <span className={styles.detail}>
                {t('offlineInstallRetryDescription', {
                  count: pack.cached,
                  total: pack.total,
                })}
              </span>
              <button
                type="button"
                onClick={() => {
                  void pwa.retryInstall();
                }}
              >
                {t('retryOfflineInstall')}
              </button>
            </>
          )}
        </section>
      )}
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
