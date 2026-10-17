import { useCallback, useEffect, useRef, useState } from 'react';

type WakeLockStatus =
  'inactive' | 'requesting' | 'active' | 'unsupported' | 'error';

/** Keep practice sessions awake, including pauses for reading or playing by hand. */
export function useScreenWakeLock(enabled: boolean) {
  const [status, setStatus] = useState<WakeLockStatus>('inactive');
  const retryRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!enabled) {
      setStatus('inactive');
      return;
    }
    if (
      !window.isSecureContext ||
      typeof navigator.wakeLock?.request !== 'function'
    ) {
      setStatus('unsupported');
      return;
    }

    let disposed = false;
    let foreground = true;
    let pending = false;
    let revision = 0;
    let retryAfter = 0;
    let lock: WakeLockSentinel | null = null;
    const isVisible = () =>
      !disposed && foreground && document.visibilityState === 'visible';
    const release = (sentinel: WakeLockSentinel) => {
      void sentinel.release().catch((error: unknown) => {
        console.warn('[WakeLock] Cannot release screen lock:', error);
      });
    };

    const acquire = async () => {
      if (!isVisible() || pending || lock || performance.now() < retryAfter)
        return;
      const requestRevision = revision;
      pending = true;
      setStatus('requesting');
      try {
        const sentinel = await navigator.wakeLock.request('screen');
        if (!isVisible() || requestRevision !== revision) {
          release(sentinel);
          return;
        }
        if (sentinel.released) {
          retryAfter = performance.now() + 2000;
          setStatus('error');
          return;
        }
        lock = sentinel;
        sentinel.addEventListener(
          'release',
          () => {
            if (lock !== sentinel) return;
            lock = null;
            retryAfter = performance.now() + 2000;
            if (!disposed) setStatus(isVisible() ? 'error' : 'inactive');
          },
          { once: true },
        );
        setStatus('active');
      } catch (error) {
        if (isVisible() && requestRevision === revision) {
          retryAfter = performance.now() + 2000;
          setStatus('error');
          console.warn('[WakeLock] Cannot keep screen awake:', error);
        }
      } finally {
        pending = false;
        // A background/foreground round trip may finish before the old request.
        if (requestRevision !== revision && isVisible()) void acquire();
      }
    };

    const suspend = () => {
      revision++;
      const sentinel = lock;
      lock = null;
      if (sentinel) release(sentinel);
      if (!disposed) setStatus('inactive');
    };
    const resume = () => {
      retryAfter = 0;
      void acquire();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') resume();
      else suspend();
    };
    const onPageHide = () => {
      foreground = false;
      suspend();
    };
    const onPageShow = () => {
      foreground = true;
      resume();
    };
    const onInteraction = () => {
      void acquire();
    };

    retryRef.current = resume;
    document.addEventListener('visibilitychange', onVisibilityChange);
    document.addEventListener('pointerdown', onInteraction, { passive: true });
    document.addEventListener('keydown', onInteraction);
    window.addEventListener('focus', resume);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('pagehide', onPageHide);
    void acquire();

    return () => {
      disposed = true;
      suspend();
      retryRef.current = () => {};
      document.removeEventListener('visibilitychange', onVisibilityChange);
      document.removeEventListener('pointerdown', onInteraction);
      document.removeEventListener('keydown', onInteraction);
      window.removeEventListener('focus', resume);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [enabled]);

  const retry = useCallback(() => retryRef.current(), []);
  return { status, retry };
}
