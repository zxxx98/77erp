import { t, getFormatLocale } from '../i18n/index.js';

export function PostProcessingFinishNotice({ state }) {
  if (!state.blocked) return null;
  return <div className="bom-hint">
    {state.waitingForOutput && <p>{t('production.outputIncomplete')}</p>}
    {state.gaps.length > 0 && <ul>{state.gaps.map(gap => <li key={gap.path}>{t('production.postProcessingGap', {
      name: gap.name, count: gap.remaining.toLocaleString(getFormatLocale()),
    })}</li>)}</ul>}
  </div>;
}
