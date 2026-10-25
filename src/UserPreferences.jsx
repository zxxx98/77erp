import { useId } from 'react';
import { Switch } from 'antd';
import { usePreferences } from './preferences.jsx';
import './user-preferences.css';

const options = [
  ['closeModalOnBackdrop', '点击空白处关闭弹窗', '桌面端：点击弹窗外的遮罩区域即可关闭。'],
  ['closeDrawerOnBackdrop', '点击空白处关闭抽屉', '适用于桌面侧边抽屉、BOM 详情抽屉及移动端底部面板。'],
];

export function UserPreferences({ disabled = false, showTitle = true }) {
  const { preferences, updatePreference, storageError } = usePreferences();
  const id = useId();
  return <section className="user-preferences" aria-label="用户习惯">
    <div className="settings-section-heading">{showTitle && <h3>用户习惯</h3>}<p>仅对当前账号在此浏览器生效，修改后自动保存。其他设备需单独设置。</p></div>
    <div className="preference-options">
      {options.map(([key, title, description]) => <div className="preference-row" key={key}>
        <div><label htmlFor={`${id}-${key}`}>{title}</label><p id={`${id}-${key}-hint`}>{description}</p></div>
        <Switch id={`${id}-${key}`} aria-label={title} aria-describedby={`${id}-${key}-hint`} checked={preferences[key]} disabled={disabled} onChange={value => updatePreference(key, value)} />
      </div>)}
    </div>
    <p className="preference-hint">默认均为关闭。开启后会沿用各页面已有的关闭检查；需要保留未保存内容时，请先保存再关闭。</p>
    {storageError && <p role="alert" className="form-error">{storageError}</p>}
  </section>;
}
