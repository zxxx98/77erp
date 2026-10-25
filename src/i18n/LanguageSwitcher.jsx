import { Dropdown } from 'antd';
import { Check, ChevronDown } from 'lucide-react';
import { useLocale, useLanguageSyncError } from './react.jsx';
import './language-switcher.css';

const languages = [
  { key: 'zh-CN', name: '简体中文', short: '中文', flag: 'cn' },
  { key: 'en', name: 'English', short: 'EN', flag: 'us' },
  { key: 'vi', name: 'Tiếng Việt', short: 'VI', flag: 'vn' },
];

export function LanguageSwitcher({ compact = false }) {
  const { locale, setLocale, t } = useLocale();
  const error = useLanguageSyncError();
  const current = languages.find(language => language.key === locale) || languages[0];
  const flag = language => <img src={`/flags/${language.flag}.svg`} width="24" height="16" alt="" aria-hidden="true" />;
  return <div className={`language-switcher${compact ? ' language-switcher-compact' : ''}`}>
    <Dropdown trigger={['click']} placement="bottomRight" menu={{
      selectable: true, selectedKeys: [locale],
      onClick: ({ key }) => { void setLocale(key); },
      items: languages.map(language => ({ key: language.key, label: <span className="language-option" lang={language.key}>
        {flag(language)}<span>{language.name}</span>{language.key === locale && <Check size={16} aria-hidden="true" />}
      </span> })),
    }}>
      <button type="button" className="language-trigger" aria-label={`${t('language.change')}: ${current.name}`} title={t('language.change')}>
        {flag(current)}<span className="language-name" lang={locale}>{current.name}</span><span className="language-short" lang={locale}>{current.short}</span><ChevronDown size={14} aria-hidden="true" />
      </button>
    </Dropdown>
    {error && <span className="language-sync-error" role="status">{t(error)}</span>}
  </div>;
}
