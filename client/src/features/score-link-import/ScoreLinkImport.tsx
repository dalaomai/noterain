import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, ExternalLink, Link, LoaderCircle, RefreshCw, X } from 'lucide-react';
import { useI18n } from '../../hooks/useI18n';
import { detectCompanionVersion, importScoreLink } from './core/api';
import type { CollectedScore } from './core/types';
import styles from './ScoreLinkImport.module.css';

interface ScoreLinkImportProps {
  isOpen: boolean;
  onClose: () => void;
  onImported: (score: CollectedScore) => Promise<void>;
}

const REQUIRED_COMPANION_VERSION = '0.5.6';
type CompanionStatus = 'checking' | 'ready' | 'outdated' | 'missing';

function isVersionAtLeast(actual: string, required: string): boolean {
  const left = actual.split('.').map(Number);
  const right = required.split('.').map(Number);
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return true;
}

function importErrorMessage(code: string, t: ReturnType<typeof useI18n>['t']): string {
  if (code === 'COMPANION_NOT_DETECTED') return t('scoreLinkSetupDescription');
  if (code === 'SOURCE_NOT_ACCESSIBLE') return t('scoreLinkNotAccessible');
  if (code === 'SCORE_PAGE_TIMEOUT') return t('scoreLinkPageTimeout');
  if (code === 'MIDI_AUTH_UNAVAILABLE') return t('scoreLinkSignatureError');
  if (/^MIDI_(?:API_|FALLBACK_)?HTTP_/.test(code) || code === 'MIDI_URL_UNAVAILABLE' || code.startsWith('MIDI_DOWNLOAD_')) {
    return t('scoreLinkMidiError');
  }
  if (/^(?:SVG_|INVALID_SVG_)/.test(code)) return t('scoreLinkSvgError');
  if (/^(?:BRIDGE_|NETWORK_)/.test(code)) return t('scoreLinkBridgeError');
  return t('scoreLinkImportError');
}

export function ScoreLinkImport({ isOpen, onClose, onImported }: ScoreLinkImportProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [url, setUrl] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [companionStatus, setCompanionStatus] = useState<CompanionStatus>('checking');
  const [companionVersion, setCompanionVersion] = useState<string | null>(null);
  const { t } = useI18n();
  const isAndroid = /Android/i.test(navigator.userAgent);
  const companionInstallUrl = new URL(
    `/score-link-companion.user.js?v=${REQUIRED_COMPANION_VERSION}`,
    window.location.origin,
  ).toString();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (isOpen && dialog && !dialog.open) dialog.showModal();
    else if (!isOpen && dialog?.open) dialog.close();
  }, [isOpen]);

  const refreshCompanionVersion = async () => {
    setCompanionStatus('checking');
    const version = await detectCompanionVersion();
    setCompanionVersion(version);
    setCompanionStatus(
      version === null ? 'missing' : isVersionAtLeast(version, REQUIRED_COMPANION_VERSION) ? 'ready' : 'outdated',
    );
  };

  useEffect(() => {
    if (isOpen) void refreshCompanionVersion();
  }, [isOpen]);

  useEffect(() => () => {
    abortRef.current?.abort();
  }, []);

  const close = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsImporting(false);
    setError(null);
    onClose();
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setIsImporting(true);
    const sourceTab = window.open('about:blank', '_blank');
    if (!sourceTab) {
      setIsImporting(false);
      setError(t('scoreLinkPopupBlocked'));
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      console.info('[ScoreLinkImport]', 'submit', {
        sourceHost: new URL(url.trim()).hostname,
      });
      const score = await importScoreLink(
        url.trim(),
        sourceTab,
        controller.signal,
      );
      await onImported(score);
      setUrl('');
      onClose();
    } catch (caught) {
      sourceTab.close();
      if (caught instanceof DOMException && caught.name === 'AbortError') return;
      const code = caught instanceof Error ? caught.message : 'IMPORT_FAILED';
      console.error('[ScoreLinkImport]', 'ui-error', { error: code, stack: caught instanceof Error ? caught.stack : undefined });
      setError(importErrorMessage(code, t));
    } finally {
      abortRef.current = null;
      setIsImporting(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby="score-link-import-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <form className={styles.content} onSubmit={(event) => void submit(event)}>
        <header className={styles.header}>
          <h2 id="score-link-import-title"><Link size={19} /> {t('importScoreLink')}</h2>
          <button type="button" className={styles.iconButton} aria-label={t('closeScoreLinkImport')} onClick={close}>
            <X size={18} />
          </button>
        </header>
        <p className={styles.description}>{t('scoreLinkImportDescription')}</p>
        <div className={styles.companionStatus} data-status={companionStatus} role="status">
          {companionStatus === 'checking' ? (
            <LoaderCircle className={styles.spinner} size={17} />
          ) : companionStatus === 'ready' ? (
            <CheckCircle2 size={17} />
          ) : (
            <RefreshCw size={17} />
          )}
          <span>{t(
            companionStatus === 'checking'
              ? 'checkingScoreLinkCompanion'
              : companionStatus === 'ready'
                ? 'scoreLinkCompanionVersionReady'
                : companionStatus === 'outdated'
                  ? 'scoreLinkCompanionVersionOutdated'
                  : 'scoreLinkCompanionVersionMissing',
            { version: companionVersion ?? '?', required: REQUIRED_COMPANION_VERSION },
          )}</span>
          <button
            type="button"
            className={styles.versionRefresh}
            disabled={companionStatus === 'checking'}
            onClick={() => void refreshCompanionVersion()}
            aria-label={t('recheckScoreLinkCompanion')}
            title={t('recheckScoreLinkCompanion')}
          >
            <RefreshCw size={15} />
          </button>
        </div>
        {(companionStatus === 'missing' || companionStatus === 'outdated') && (
          <section className={styles.installGuide}>
            <h3>{t(isAndroid ? 'scoreLinkAndroidSetupTitle' : 'scoreLinkSetupTitle')}</h3>
            <p>{t(isAndroid ? 'scoreLinkAndroidSetupDescription' : 'scoreLinkSetupDescription')}</p>
            <div className={styles.installActions}>
              <a className={styles.secondaryLink} href={isAndroid ? 'https://www.tampermonkey.net/?browser=firefox.android' : 'https://www.tampermonkey.net/'} target="_blank" rel="noreferrer">
                <ExternalLink size={16} /> {t('installTampermonkey')}
              </a>
              <a className={styles.primaryLink} href={companionInstallUrl} target="_blank" rel="noreferrer">
                <ExternalLink size={16} /> {t('installScoreLinkCompanion')}
              </a>
            </div>
            <p className={styles.installNote}>{t('scoreLinkInstallRedirectNote')}</p>
          </section>
        )}
        <label className={styles.field}>
          <span>{t('scoreLinkLabel')}</span>
          <input
            type="url"
            inputMode="url"
            value={url}
            placeholder="https://musescore.com/user/.../scores/..."
            required
            disabled={isImporting}
            onChange={(event) => setUrl(event.target.value)}
          />
        </label>
        {error && <p className={styles.error} role="alert">{error}</p>}
        <footer className={styles.actions}>
          <button type="button" className={styles.secondaryButton} onClick={close}>{t('cancel')}</button>
          <button type="submit" className={styles.primaryButton} disabled={isImporting || !url.trim()}>
            {isImporting && <LoaderCircle className={styles.spinner} size={17} />}
            {t(isImporting ? 'scoreLinkImporting' : 'importScoreLink')}
          </button>
        </footer>
      </form>
    </dialog>
  );
}