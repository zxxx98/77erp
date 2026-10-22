export function ModeSwitch({ mode, onChange, disabled }) {
  return <div className="mode-switch" role="group" aria-label="业务模式">
    {[['warehouse', '仓储'], ['production', '生产']].map(([id, label]) => <button key={id} type="button" aria-pressed={mode === id} disabled={disabled} onClick={() => onChange(id)}>{label}</button>)}
  </div>;
}
