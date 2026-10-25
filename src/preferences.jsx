import { t as translate, getFormatLocale } from './i18n/index.js';
import { useLocale } from './i18n/react.jsx';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

const defaults = Object.freeze({ closeModalOnBackdrop: false, closeDrawerOnBackdrop: false });
const PreferenceContext = createContext({ preferences: defaults, updatePreference: () => {}, storageError: '' });

function normalize(value) {
  return {
    closeModalOnBackdrop: value?.closeModalOnBackdrop === true,
    closeDrawerOnBackdrop: value?.closeDrawerOnBackdrop === true,
  };
}

function readPreferences(key) {
  try { return normalize(JSON.parse(localStorage.getItem(key))); }
  catch { return defaults; }
}

// The App is keyed by account, so switching users never reuses another user's state.
export function PreferenceProvider({ user, children }) {
  useLocale();
  const storageKey = `77erp:preferences:v1:${user.id ?? user.username}`;
  const [preferences, setPreferences] = useState(() => readPreferences(storageKey));
  const current = useRef(preferences);
  const [storageError, setStorageError] = useState('');
  const updatePreference = useCallback((name, value) => {
    if (!Object.hasOwn(defaults, name) || typeof value !== 'boolean') return;
    const next = { ...current.current, [name]: value };
    current.current = next;
    setPreferences(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      setStorageError('');
    } catch {
      setStorageError(translate("system.the.browser.failed.to.save.user.habits.this.use.has.taken"));
    }
  }, [storageKey]);
  useEffect(() => {
    const sync = event => {
      if (event.key !== null && event.key !== storageKey) return;
      const next = readPreferences(storageKey);
      current.current = next;
      setPreferences(next);
      setStorageError('');
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [storageKey]);
  const value = useMemo(() => ({ preferences, updatePreference, storageError }), [preferences, updatePreference, storageError]);
  return <PreferenceContext.Provider value={value}>{children}</PreferenceContext.Provider>;
}

export const usePreferences = () => useContext(PreferenceContext);
