import { useSyncExternalStore } from 'react';
import { List, Table } from 'lucide-react';
import { t as pt } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';
import './bom-table.css';

const STORAGE_KEY = 'erp:bom-layout-mode';
const VALID_MODES = new Set(['table', 'classic']);
const listeners = new Set();

function readMode() {
  if (typeof window === 'undefined') return 'table';
  try {
    const stored = window.localStorage?.getItem(STORAGE_KEY);
    return VALID_MODES.has(stored) ? stored : 'table';
  } catch {
    return 'table';
  }
}

let currentMode = readMode();

function notifyListeners() {
  for (const listener of listeners) listener();
}

export function setBomLayoutMode(nextMode) {
  if (!VALID_MODES.has(nextMode) || nextMode === currentMode) return;
  currentMode = nextMode;
  try {
    window.localStorage?.setItem(STORAGE_KEY, nextMode);
  } catch {
    // Ignore storage write failures (e.g. private browsing restrictions).
  }
  notifyListeners();
}

function subscribe(listener) {
  listeners.add(listener);
  const onStorage = event => {
    if (event.key !== STORAGE_KEY) return;
    currentMode = readMode();
    notifyListeners();
  };
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
  };
}

const getSnapshot = () => currentMode;
const getServerSnapshot = () => 'table';

/**
 * Persisted toggle between the spreadsheet/table BOM layout and the classic layout.
 */
export function useBomLayoutMode() {
  const mode = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return [mode, setBomLayoutMode];
}

export function BomViewModeSwitch({ compact = false }) {
  useLocale();
  const [mode, setMode] = useBomLayoutMode();
  return <div
    className={`segmented bom-view-switch${compact ? ' is-compact' : ''}`}
    role="group"
    aria-label={pt('production.bomLayoutSwitch')}
  >
    <button
      type="button"
      className={mode === 'table' ? 'active' : undefined}
      aria-pressed={mode === 'table'}
      onClick={() => setMode('table')}
    >
      <Table size={14} aria-hidden="true" />
      <span>{pt('production.bomLayoutTable')}</span>
    </button>
    <button
      type="button"
      className={mode === 'classic' ? 'active' : undefined}
      aria-pressed={mode === 'classic'}
      onClick={() => setMode('classic')}
    >
      <List size={14} aria-hidden="true" />
      <span>{pt('production.bomLayoutClassic')}</span>
    </button>
  </div>;
}
