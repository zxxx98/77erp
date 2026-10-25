import { t as translate, getFormatLocale } from './i18n/index.js';
import { useLocale } from './i18n/react.jsx';
import { useId } from 'react';
import { Switch } from 'antd';
import { usePreferences } from './preferences.jsx';
import './user-preferences.css';
import { LanguageSwitcher } from './i18n/LanguageSwitcher.jsx';

const options = () => [
  ['closeModalOnBackdrop', translate("system.click.on.an.empty.space.to.close.the.pop.up.window"), translate("system.desktop.click.the.mask.area.outside.the.pop.up.window.to")],
  ['closeDrawerOnBackdrop', translate("system.click.on.an.empty.space.to.close.the.drawer"), translate("system.suitable.for.desktop.side.drawers.bom.details.drawers.and.mobile.bottom")],
];

export function UserPreferences({ disabled = false, showTitle = true }) {
  useLocale();
  const { preferences, updatePreference, storageError } = usePreferences();
  const id = useId();
  return <section className="user-preferences" aria-label={translate("system.preferences")}>
    <div className="preference-row"><div><strong>{translate('language.label')}</strong><p>{translate('language.accountPreference')}</p></div><LanguageSwitcher /></div>
    <div className="settings-section-heading">{showTitle && <h3>{translate("system.preferences")}</h3>}<p>{translate("system.it.will.only.take.effect.in.this.browser.for.the.current")}</p></div>
    <div className="preference-options">
      {options().map(([key, title, description]) => <div className="preference-row" key={key}>
        <div><label htmlFor={`${id}-${key}`}>{title}</label><p id={`${id}-${key}-hint`}>{description}</p></div>
        <Switch id={`${id}-${key}`} aria-label={title} aria-describedby={`${id}-${key}-hint`} checked={preferences[key]} disabled={disabled} onChange={value => updatePreference(key, value)} />
      </div>)}
    </div>
    <p className="preference-hint">{translate("system.the.default.is.off.after.opening.the.existing.closing.check.of")}</p>
    {storageError && <p role="alert" className="form-error">{storageError}</p>}
  </section>;
}
