import { App, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { mobileDevice } from '../device.js';
import './ui.css';

// Desktop, mobile Web and installed PWA share the same design tokens.
export function UiProvider({ children }) {
  return <ConfigProvider locale={zhCN} button={{ autoInsertSpace: false }} theme={{
    token: {
      colorPrimary: '#2563eb', colorSuccess: '#16a383', colorWarning: '#e59a2f',
      colorError: '#e45b64', colorText: '#17243c', borderRadius: 8,
      fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',
      fontSize: 14, controlHeight: mobileDevice ? 44 : 36,
      zIndexPopupBase: 1200,
    },
    components: { Select: { optionHeight: mobileDevice ? 44 : 36 } },
  }}><App>{children}</App></ConfigProvider>;
}
