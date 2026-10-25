import { Select } from './Dropdown.jsx';
import { useLocale } from './i18n/react.jsx';

export function ExportLanguageSelect({ value, onChange, disabled = false }) {
  const { t } = useLocale();
  return <label className="export-language" style={{ display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, maxWidth: '100%', margin: '8px 0' }}>
    <span>{t('warehouse.export.language')}</span>
    <Select aria-label={t('warehouse.export.language')} value={value} onChange={onChange} disabled={disabled}>
      <option value="">{t('warehouse.export.currentLanguage')}</option>
      <option value="zh-CN">简体中文</option><option value="en">English</option><option value="vi">Tiếng Việt</option>
    </Select>
  </label>;
}
