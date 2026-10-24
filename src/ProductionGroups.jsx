import { useEffect, useState } from 'react';
import { api } from './api.js';
import { Input, Button } from './ui/controls.jsx';
import './users.css';

export function ProductionGroupManager({ onChanged }) {
  const [groups, setGroups] = useState([]), [editor, setEditor] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const load = async () => setGroups(await api('/production-groups'));
  useEffect(() => { load().catch(e => setError(e.message)); }, []);
  const run = async action => {
    if (busy) return;
    setBusy(true); setError('');
    try { await action(); await load(); await onChanged?.(); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  return <section aria-label="生产小组配置" className="position-manager settings-list-layout">
    <div className="settings-section-heading"><h3>生产小组配置</h3><p>每名员工可选择一个小组。小组本身不授予权限；生产登记人员仅查看派给本组的生产单。</p></div>
    <Button htmlType="button" disabled={busy} onClick={() => setEditor({ name: '', description: '' })}>新增生产小组</Button>
    {error && <p role="alert" className="form-error">{error}</p>}
    {editor && <div className="account-fields"><label>小组名称<Input maxLength={60} value={editor.name} disabled={busy} onChange={e => setEditor({ ...editor, name: e.target.value })} /></label><label>小组说明<Input.TextArea maxLength={200} value={editor.description} disabled={busy} onChange={e => setEditor({ ...editor, description: e.target.value })} /></label><div className="position-actions"><Button htmlType="button" disabled={busy || !editor.name.trim()} onClick={() => run(async () => { await api(editor.id ? `/production-groups/${editor.id}` : '/production-groups', { method: editor.id ? 'PUT' : 'POST', body: editor }); setEditor(null); })}>保存小组</Button><Button htmlType="button" disabled={busy} onClick={() => setEditor(null)}>取消</Button></div></div>}
    <div className="user-list"><table className="data-table"><thead><tr><th>小组</th><th>说明</th><th>操作</th></tr></thead><tbody>{groups.map(group => <tr key={group.id}><td>{group.name}</td><td>{group.description || '—'}</td><td><div className="position-actions"><Button htmlType="button" disabled={busy} onClick={() => { setEditor({ ...group }); setError(''); }}>编辑</Button><Button htmlType="button" disabled={busy} onClick={() => { if (window.confirm(`删除生产小组“${group.name}”？有员工或生产单关联时不可删除。`)) run(() => api(`/production-groups/${group.id}`, { method: 'DELETE', body: { version: group.version } })); }}>删除</Button></div></td></tr>)}</tbody></table></div>
    {!groups.length && <p className="muted">暂无生产小组。</p>}
  </section>;
}
