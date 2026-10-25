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
      setStorageError('浏览器未能保存用户习惯。本次使用已生效，刷新后可能恢复；请检查浏览器存储权限或可用空间。');
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
