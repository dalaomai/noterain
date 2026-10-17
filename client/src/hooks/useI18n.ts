import { useCallback, useEffect, useState } from 'react';
import {
  dictionaries,
  detectLocale,
  saveLocale,
  type Locale,
  type TranslationKeys,
} from '../i18n';

/** Simple translation function type */
export type TranslateFn = (
  key: TranslationKeys,
  params?: Record<string, string | number>,
) => string;

/** Format a template string like "Volume: {percent}%" */
function format(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

/** Global locale listeners (so all hook instances stay in sync) */
const listeners = new Set<(locale: Locale) => void>();
let currentLocale: Locale = detectLocale();

function setGlobalLocale(locale: Locale) {
  currentLocale = locale;
  saveLocale(locale);
  document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
  listeners.forEach((listener) => listener(locale));
}

/**
 * i18n hook: returns the translate function and locale controls.
 * Locale is stored in localStorage and synced across all hook instances.
 */
export function useI18n(): {
  locale: Locale;
  t: TranslateFn;
  setLocale: (locale: Locale) => void;
} {
  const [locale, setLocaleState] = useState<Locale>(currentLocale);

  useEffect(() => {
    const listener = (next: Locale) => setLocaleState(next);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const t = useCallback<TranslateFn>(
    (key, params) => format(dictionaries[locale][key], params),
    [locale],
  );

  const setLocale = useCallback((next: Locale) => {
    setGlobalLocale(next);
  }, []);

  return { locale, t, setLocale };
}
