import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { i18n, getLocale, changeLanguage, subscribeLanguageSync, getLanguageSyncError } from './index.js';

export function useLocale() {
  const { t } = useTranslation('translation', { i18n });
  const locale = getLocale();
  return { locale, setLocale: changeLanguage, t };
}

export function useLanguageSyncError() {
  return useSyncExternalStore(subscribeLanguageSync, getLanguageSyncError, getLanguageSyncError);
}
