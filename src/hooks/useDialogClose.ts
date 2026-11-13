import { useCallback, useEffect, useRef, useState } from 'react';

const EXIT_DURATION = 200;

function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function useDialogClose(onClose: () => void) {
  const [closing, setClosing] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const close = useCallback(() => {
    if (timerRef.current) return;
    if (prefersReducedMotion()) {
      onClose();
      return;
    }
    setClosing(true);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      onClose();
    }, EXIT_DURATION);
  }, [onClose]);

  return { closing, close };
}