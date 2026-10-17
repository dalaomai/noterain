import { useCallback, useEffect, useRef, useState } from 'react';

type LockableOrientation = ScreenOrientation & {
  lock?: (orientation: 'landscape') => Promise<void>;
};

export function useFullscreen() {
  const isSupported = Boolean(
    document.fullscreenEnabled && document.documentElement.requestFullscreen,
  );
  const [isFullscreen, setIsFullscreen] = useState(
    Boolean(document.fullscreenElement),
  );
  const [isChanging, setIsChanging] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [needsLandscape, setNeedsLandscape] = useState(false);
  const orientationLockRef = useRef(false);
  const orientationSessionRef = useRef(0);
  const orientationTimerRef = useRef<number | null>(null);
  const transitionRef = useRef(false);
  const transitionIdRef = useRef(0);
  const transitionTimerRef = useRef<number | null>(null);

  const finishTransition = useCallback(() => {
    if (transitionTimerRef.current !== null) {
      window.clearTimeout(transitionTimerRef.current);
      transitionTimerRef.current = null;
    }
    transitionRef.current = false;
    setIsChanging(false);
  }, []);

  const cancelTransition = useCallback(() => {
    transitionIdRef.current++;
    transitionRef.current = false;
    if (transitionTimerRef.current !== null) {
      window.clearTimeout(transitionTimerRef.current);
      transitionTimerRef.current = null;
    }
  }, []);

  const unlockOrientation = useCallback(() => {
    orientationSessionRef.current++;
    if (orientationTimerRef.current !== null) {
      window.clearTimeout(orientationTimerRef.current);
      orientationTimerRef.current = null;
    }
    if (!orientationLockRef.current) return;
    orientationLockRef.current = false;
    try {
      screen.orientation?.unlock();
    } catch {
      // Some browsers expose orientation methods without implementing them.
    }
  }, []);

  const lockLandscape = useCallback(() => {
    if (orientationLockRef.current || !document.fullscreenElement) return;
    orientationLockRef.current = true;
    const session = ++orientationSessionRef.current;
    const orientation = screen.orientation as LockableOrientation | undefined;

    const onFailure = () => {
      if (session !== orientationSessionRef.current) return;
      orientationSessionRef.current++;
      if (orientationTimerRef.current !== null) {
        window.clearTimeout(orientationTimerRef.current);
        orientationTimerRef.current = null;
      }
      try {
        orientation?.unlock();
      } catch {
        // Fullscreen itself remains usable if direction locking is unavailable.
      }
      setNeedsLandscape(
        Boolean(
          document.fullscreenElement &&
          window.matchMedia('(orientation: portrait)').matches,
        ),
      );
    };

    if (!orientation?.lock) {
      onFailure();
      return;
    }

    // Direction locking must never keep the fullscreen/exit button disabled.
    orientationTimerRef.current = window.setTimeout(onFailure, 3000);
    try {
      void orientation
        .lock('landscape')
        .then(() => {
          if (session !== orientationSessionRef.current) {
            if (!document.fullscreenElement) {
              try {
                orientation.unlock();
              } catch {
                /* Already unlocked. */
              }
            }
            return;
          }
          if (orientationTimerRef.current !== null) {
            window.clearTimeout(orientationTimerRef.current);
            orientationTimerRef.current = null;
          }
        })
        .catch(onFailure);
    } catch {
      onFailure();
    }
  }, []);

  const syncFullscreen = useCallback(() => {
    const active = Boolean(document.fullscreenElement);
    setIsFullscreen(active);
    finishTransition();
    setHasError(false);
    if (active) {
      lockLandscape();
    } else {
      unlockOrientation();
      setNeedsLandscape(false);
    }
  }, [finishTransition, lockLandscape, unlockOrientation]);

  useEffect(() => {
    const onFullscreenError = () => {
      finishTransition();
      setHasError(true);
    };
    const landscape = window.matchMedia('(orientation: landscape)');
    const onOrientationChange = () => {
      if (landscape.matches) setNeedsLandscape(false);
    };
    document.addEventListener('fullscreenchange', syncFullscreen);
    document.addEventListener('fullscreenerror', onFullscreenError);
    landscape.addEventListener('change', onOrientationChange);
    return () => {
      document.removeEventListener('fullscreenchange', syncFullscreen);
      document.removeEventListener('fullscreenerror', onFullscreenError);
      landscape.removeEventListener('change', onOrientationChange);
      cancelTransition();
      unlockOrientation();
    };
  }, [cancelTransition, finishTransition, syncFullscreen, unlockOrientation]);

  const toggleFullscreen = useCallback(async () => {
    if (!isSupported || transitionRef.current) return;
    const id = ++transitionIdRef.current;
    const exiting = Boolean(document.fullscreenElement);
    transitionRef.current = true;
    setIsChanging(true);
    setHasError(false);
    setNeedsLandscape(false);
    transitionTimerRef.current = window.setTimeout(() => {
      if (id !== transitionIdRef.current) return;
      finishTransition();
      if (Boolean(document.fullscreenElement) === !exiting) {
        syncFullscreen();
      } else {
        setHasError(true);
      }
    }, 5000);

    try {
      if (exiting) {
        await document.exitFullscreen();
      } else {
        // Request synchronously in the tap handler, without optional API arguments.
        await document.documentElement.requestFullscreen();
      }
      if (id !== transitionIdRef.current) return;
      syncFullscreen();
      if (Boolean(document.fullscreenElement) !== !exiting) setHasError(true);
    } catch {
      if (id === transitionIdRef.current) setHasError(true);
    } finally {
      if (id === transitionIdRef.current) finishTransition();
    }
  }, [isSupported, finishTransition, syncFullscreen]);

  return {
    isSupported,
    isFullscreen,
    isChanging,
    hasError,
    needsLandscape,
    toggleFullscreen,
  };
}
