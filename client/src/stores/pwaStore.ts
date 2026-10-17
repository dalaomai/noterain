import { create } from 'zustand';
import { registerSW } from 'virtual:pwa-register';
import { useMidiStore } from './midiStore';
import { useOfflinePackStore } from './offlinePackStore';

const PENDING_INSTALL = 'noterain-offline-install-required';
type InstallPhase = 'idle' | 'preparing' | 'ready' | 'error';
interface PwaState {
  installed: boolean;
  installPhase: InstallPhase;
  coreReady: boolean;
  updateReady: boolean;
  updateDismissed: boolean;
  isApplying: boolean;
  updateError: boolean;
  retryInstall: () => Promise<void>;
  applyUpdate: () => Promise<void>;
  dismissUpdate: () => void;
}

let registration: ServiceWorkerRegistration | undefined;
let updateSW: (() => Promise<void>) | undefined;
let installation: Promise<void> | null = null;
let initialized = false;
let applyRequested = false;
let reloading = false;

function pendingInstall(value?: boolean): boolean {
  try {
    if (value !== undefined) {
      if (value) localStorage.setItem(PENDING_INSTALL, '1');
      else localStorage.removeItem(PENDING_INSTALL);
    }
    return localStorage.getItem(PENDING_INSTALL) === '1';
  } catch {
    return false;
  }
}

function standalone() {
  return (
    window.matchMedia(
      '(display-mode: standalone), (display-mode: minimal-ui), (display-mode: window-controls-overlay)',
    ).matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  );
}

async function ensureCoreAssets() {
  if (!window.isSecureContext || !('serviceWorker' in navigator))
    throw new Error('Offline installation is unavailable');
  await new Promise<void>((resolve, reject) => {
    const channel = new MessageChannel();
    let finished = false;
    const finish = (error?: Error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      window.removeEventListener('offline', onOffline);
      channel.port1.close();
      if (error) reject(error);
      else resolve();
    };
    const onOffline = () => finish(new Error('Network disconnected'));
    const timeout = window.setTimeout(
      () => finish(new Error('Application caching timed out')),
      60000,
    );
    window.addEventListener('offline', onOffline, { once: true });
    channel.port1.onmessage = (event) =>
      finish(
        event.data?.ok
          ? undefined
          : new Error(event.data?.error ?? 'Application caching failed'),
      );
    void navigator.serviceWorker.ready
      .then((ready) => {
        if (finished) return;
        const worker = ready.waiting ?? ready.active;
        if (!worker) finish(new Error('No offline worker'));
        else
          worker.postMessage({ type: 'ENSURE_OFFLINE_ASSETS' }, [
            channel.port2,
          ]);
      })
      .catch((error: unknown) => finish(new Error(String(error))));
  });
}

function safeReload() {
  if (!applyRequested || useMidiStore.getState().playback.isPlaying) {
    applyRequested = false;
    usePwaStore.setState({
      updateReady: true,
      updateDismissed: false,
      isApplying: false,
    });
    return;
  }
  if (!reloading) {
    reloading = true;
    window.location.reload();
  }
}

export const usePwaStore = create<PwaState>((set, get) => ({
  installed: standalone() || pendingInstall(),
  installPhase: 'idle',
  coreReady: false,
  updateReady: false,
  updateDismissed: false,
  isApplying: false,
  updateError: false,
  dismissUpdate: () => set({ updateDismissed: true }),
  retryInstall: () => {
    if (installation) return installation;
    pendingInstall(true);
    set({ installed: true, installPhase: 'preparing', coreReady: false });
    installation = (async () => {
      try {
        await Promise.all([
          ensureCoreAssets().then(() => {
            set({ coreReady: true });
          }),
          useOfflinePackStore.getState().startDownload(),
        ]);
        await useOfflinePackStore.getState().refresh();
        const pack = useOfflinePackStore.getState();
        if (pack.cached !== pack.total || pack.error)
          throw new Error('Piano samples are incomplete');
        pendingInstall(false);
        set({ installPhase: 'ready' });
      } catch (error) {
        console.warn('[PWA] Offline installation is incomplete:', error);
        set({ installPhase: 'error' });
      }
    })().finally(() => {
      installation = null;
    });
    return installation;
  },
  applyUpdate: async () => {
    if (
      !get().updateReady ||
      get().isApplying ||
      get().installPhase === 'preparing' ||
      useMidiStore.getState().playback.isPlaying
    )
      return;
    applyRequested = true;
    set({ isApplying: true, updateError: false });
    try {
      if (registration?.waiting) await updateSW?.();
      else safeReload();
    } catch (error) {
      applyRequested = false;
      set({ isApplying: false, updateError: true });
      console.warn('[PWA] Cannot apply update:', error);
    }
  },
}));

/** One registration and one installation task, independent of React remounts. */
export function initializePwa() {
  if (initialized) return;
  initialized = true;
  let checking = false;
  let lastCheck = 0;
  let controlled = Boolean(navigator.serviceWorker?.controller);
  const showUpdate = () =>
    usePwaStore.setState({ updateReady: true, updateDismissed: false });
  const checkUpdate = async () => {
    if (
      !registration ||
      checking ||
      registration.installing ||
      !navigator.onLine ||
      document.visibilityState !== 'visible' ||
      Date.now() - lastCheck < 60000
    )
      return;
    checking = true;
    lastCheck = Date.now();
    try {
      await registration.update();
    } catch (error) {
      console.info('[PWA] Update check deferred:', error);
    } finally {
      checking = false;
    }
  };
  updateSW = registerSW({
    immediate: true,
    onNeedRefresh: showUpdate,
    onNeedReload: safeReload,
    onRegisteredSW: (_url, ready) => {
      registration = ready;
      void checkUpdate();
    },
    onRegisterError: (error: unknown) => {
      console.warn('[PWA] Registration failed:', error);
    },
  });
  const ensureInstalled = () => {
    if (
      usePwaStore.getState().installed &&
      usePwaStore.getState().installPhase !== 'preparing'
    )
      void usePwaStore.getState().retryInstall();
  };
  const onInstalled = () => {
    void usePwaStore.getState().retryInstall();
  };
  const onResume = () => {
    if (document.visibilityState !== 'visible') return;
    void checkUpdate();
    if (usePwaStore.getState().installPhase !== 'ready') ensureInstalled();
  };
  const onOnline = () => {
    lastCheck = 0;
    onResume();
  };
  const displayMode = window.matchMedia(
    '(display-mode: standalone), (display-mode: minimal-ui), (display-mode: window-controls-overlay)',
  );
  const onDisplayMode = () => {
    if (standalone()) onInstalled();
  };
  const onControllerChange = () => {
    if (controlled) safeReload();
    controlled = true;
  };
  window.addEventListener('appinstalled', onInstalled);
  window.addEventListener('online', onOnline);
  window.addEventListener('pageshow', onResume);
  document.addEventListener('visibilitychange', onResume);
  displayMode.addEventListener('change', onDisplayMode);
  navigator.serviceWorker?.addEventListener(
    'controllerchange',
    onControllerChange,
  );
  const interval = window.setInterval(
    () => {
      void checkUpdate();
    },
    60 * 60 * 1000,
  );
  ensureInstalled();
  import.meta.hot?.dispose(() => {
    clearInterval(interval);
    window.removeEventListener('appinstalled', onInstalled);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('pageshow', onResume);
    document.removeEventListener('visibilitychange', onResume);
    displayMode.removeEventListener('change', onDisplayMode);
    navigator.serviceWorker?.removeEventListener(
      'controllerchange',
      onControllerChange,
    );
  });
}
