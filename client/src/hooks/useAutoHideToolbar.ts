import { useCallback, useEffect, useRef, useState } from 'react';
import type { FocusEvent, PointerEvent } from 'react';

export function useAutoHideToolbar(isFullscreen: boolean, isMenuOpen: boolean) {
  const [isVisible, setIsVisible] = useState(true);
  const timerRef = useRef<number | null>(null);
  const interactionRef = useRef({ hovering: false, pressing: false, focused: false });

  const cancelHide = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const scheduleHide = useCallback(() => {
    cancelHide();
    const { hovering, pressing, focused } = interactionRef.current;
    if (!isFullscreen || isMenuOpen || hovering || pressing || focused) return;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setIsVisible(false);
    }, 3000);
  }, [cancelHide, isFullscreen, isMenuOpen]);

  const reveal = useCallback(() => {
    setIsVisible(true);
    scheduleHide();
  }, [scheduleHide]);

  useEffect(() => {
    reveal();
    return cancelHide;
  }, [reveal, cancelHide]);

  useEffect(() => {
    const releasePointer = () => {
      if (!interactionRef.current.pressing) return;
      interactionRef.current.pressing = false;
      scheduleHide();
    };
    window.addEventListener('pointerup', releasePointer);
    window.addEventListener('pointercancel', releasePointer);
    return () => {
      window.removeEventListener('pointerup', releasePointer);
      window.removeEventListener('pointercancel', releasePointer);
    };
  }, [scheduleHide]);

  const onPointerEnter = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse') return;
    interactionRef.current.hovering = true;
    reveal();
  };

  const onPointerLeave = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse') return;
    interactionRef.current.hovering = false;
    scheduleHide();
  };

  const onPointerDownCapture = () => {
    interactionRef.current.pressing = true;
    reveal();
  };

  const onFocusCapture = (event: FocusEvent<HTMLDivElement>) => {
    // Pointer-focused sliders/selects should hide again once interaction ends.
    // Keyboard focus stays visible so Tab/arrow-key operation is not interrupted.
    interactionRef.current.focused = event.target.matches(':focus-visible');
    reveal();
  };

  const onBlurCapture = (event: FocusEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    interactionRef.current.focused = false;
    scheduleHide();
  };

  return {
    isCollapsed: isFullscreen && !isVisible && !isMenuOpen,
    reveal,
    headerEvents: {
      onPointerEnter,
      onPointerLeave,
      onPointerDownCapture,
      onFocusCapture,
      onBlurCapture,
    },
  };
}
