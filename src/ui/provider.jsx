import { App, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import enUS from 'antd/locale/en_US';
import viVN from 'antd/locale/vi_VN';
import { ConfigProvider as MobileConfigProvider } from 'antd-mobile';
import mobileZhCN from 'antd-mobile/es/locales/zh-CN';
import mobileEnUS from 'antd-mobile/es/locales/en-US';
import mobileViVN from 'antd-mobile/es/locales/vi-VN';
import { useLocale } from '../i18n/react.jsx';
import { mobileDevice } from '../device.js';
import './ui.css';

// Desktop, mobile Web and installed PWA share the same design tokens.
export function UiProvider({ children }) {
  const { locale } = useLocale();
  return <ConfigProvider locale={{ 'zh-CN': zhCN, en: enUS, vi: viVN }[locale]} button={{ autoInsertSpace: false }} theme={{
    token: {
      colorPrimary: '#2563eb', colorSuccess: '#16a383', colorWarning: '#e59a2f',
      colorError: '#e45b64', colorText: '#17243c', borderRadius: 8,
      fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',
      fontSize: 14, controlHeight: mobileDevice ? 44 : 36,
      zIndexPopupBase: 1200,
    },
    components: { Select: { optionHeight: mobileDevice ? 44 : 36 } },
  }}><MobileConfigProvider locale={{ 'zh-CN': mobileZhCN, en: mobileEnUS, vi: mobileViVN }[locale]}><App>{children}</App></MobileConfigProvider></ConfigProvider>;
}
