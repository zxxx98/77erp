import { t as translate, getFormatLocale } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';
import { Button as AntButton } from '../ui/controls.jsx';

export function ModeSwitch({ mode, onChange, disabled }) {
  useLocale();
  return <div className="mode-switch" role="group" aria-label={translate("system.business.model")}>
    {[['warehouse', translate("system.warehouse")], ['production', translate("system.production")]].map(([id, label]) => <AntButton type="text" key={id} htmlType="button" aria-pressed={mode === id} disabled={disabled} onClick={() => onChange(id)}>{label}</AntButton>)}
  </div>;
}
