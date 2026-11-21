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
      colorPrimary: '#1d4ed8',
      colorSuccess: '#15803d',
      colorWarning: '#b45309',
      colorError: '#b91c1c',
      colorText: '#111827',
      colorTextSecondary: '#4b5563',
      colorTextTertiary: '#667085',
      colorBorder: '#d0d5dd',
      colorBorderSecondary: '#e4e7ec',
      colorBgLayout: '#f5f6f8',
      colorBgContainer: '#ffffff',
      borderRadius: 6,
      borderRadiusSM: 4,
      borderRadiusLG: 8,
      fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',
      fontSize: 13,
      controlHeight: mobileDevice ? 44 : 34,
      boxShadowSecondary: '0 4px 12px rgba(16, 24, 40, 0.08)',
      zIndexPopupBase: 1200,
    },
    components: {
      Select: { optionHeight: mobileDevice ? 44 : 34 },
      Button: { primaryShadow: 'none', defaultShadow: 'none', dangerShadow: 'none' },
      Tag: { borderRadiusSM: 4 },
    },
  }}><MobileConfigProvider locale={{ 'zh-CN': mobileZhCN, en: mobileEnUS, vi: mobileViVN }[locale]}><App>{children}</App></MobileConfigProvider></ConfigProvider>;
}
