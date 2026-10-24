import { Button as AntButton } from '../ui/controls.jsx';

export function ModeSwitch({ mode, onChange, disabled }) {
  return <div className="mode-switch" role="group" aria-label="业务模式">
    {[['warehouse', '仓储'], ['production', '生产']].map(([id, label]) => <AntButton type="text" key={id} htmlType="button" aria-pressed={mode === id} disabled={disabled} onClick={() => onChange(id)}>{label}</AntButton>)}
  </div>;
}
