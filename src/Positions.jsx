import { useEffect, useRef, useState } from 'react';
import { Input, Button, Checkbox } from './ui/controls.jsx';
import { api } from './api.js';
import { permissionOptions } from '../shared/permissions.js';
import { LoadingStatus } from './Loading.jsx';
import './users.css';

export function EffectivePermissions({ permissions = [], legacy = false }) {
  return <div className="effective-permissions">
    {legacy && <p className="info-box">沿用旧员工权限：保留历史操作限制，以下模块不代表拥有该模块的全部操作。管理员可在岗位配置中明确切换为标准模块权限。</p>}
    <p className="muted">物料、库存、历史单据及扫码查询默认可查看，修改自己的密码始终开放。</p>
    {permissions.length ? <ul>{permissionOptions.filter(option => permissions.includes(option.key)).map(option => <li key={option.key}><strong>{option.label}</strong>{!legacy && <small>{option.description}</small>}</li>)}</ul> : <p>只读岗位，无额外业务操作权限。</p>}
  </div>;
}
export function PositionManager({ Modal, onChanged }) {
  const [positions, setPositions] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [editor, setEditor] = useState(null);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const load = async () => { const rows = await api('/positions'); setPositions(rows); setLoaded(true); return rows; };
  useEffect(() => { load().catch(e => setError(e.message)); }, []);
  const run = async (action, message) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); setNotice(''); setConflict(false);
    try { await action(); await load(); await onChanged?.(); setNotice(message); }
    catch (e) { setError(e.message); setConflict(e.status === 409); }
    finally { lock.current = false; setBusy(false); }
  };
  const open = position => { setError(''); setConflict(false); setEditor(position ? { ...position, permissions: [...position.permissions], convert_legacy: false } : { name: '', description: '', permissions: [], member_count: 0 }); };
  const refresh = () => run(async () => {
    const rows = await load();
    if (editor?.id) {
      const latest = rows.find(row => row.id === editor.id);
      if (!latest) throw new Error('该岗位已被删除，请关闭编辑并重新选择岗位。');
      setEditor(current => ({ ...current, version: latest.version, member_count: latest.member_count, legacy_permissions: latest.legacy_permissions }));
    }
  }, '已刷新最新版本，编辑内容已保留。请核对后重新保存。');
  const save = () => {
    if (!editor.name.trim()) { setError('请填写岗位名称。'); return; }
    void run(async () => {
      await api(editor.id ? `/positions/${editor.id}` : '/positions', { method: editor.id ? 'PUT' : 'POST', body: {
        name: editor.name, description: editor.description, permissions: editor.permissions,
        ...(editor.id ? { version: editor.version } : {}), ...(editor.convert_legacy ? { convert_legacy: true } : {}),
      } });
      setEditor(null);
    }, '岗位已保存，关联员工权限立即生效');
  };
  return <section aria-label="岗位配置" className="position-manager">
    <div className="settings-section-heading"><h3>岗位配置</h3><p>每名员工选择一个岗位。调整岗位权限会同时影响该岗位的全部员工，包含已停用账号。</p></div>
    <Button type="primary" htmlType="button" className="btn btn-primary" disabled={busy} onClick={() => open(null)}>新增岗位</Button>
    {busy && <p><LoadingStatus>正在更新岗位…</LoadingStatus></p>}
    {!editor && error && <p className="form-error" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {!loaded && !error && <p><LoadingStatus>正在加载岗位…</LoadingStatus></p>}
    {loaded && !positions.length && <p className="muted">暂无岗位，请先新增岗位，再为员工分配。</p>}
    {!!positions.length && <div className="user-list position-list"><table className="data-table position-table"><thead><tr><th>岗位</th><th>权限</th><th>关联员工</th><th>操作</th></tr></thead><tbody>
      {positions.map(position => <tr key={position.id} className="position-row"><td><strong>{position.name}</strong>{position.description && <small className="position-description">{position.description}</small>}</td>
        <td>{position.legacy_permissions && <strong className="position-legacy">旧权限兼容</strong>}<span>{position.permissions.length ? permissionOptions.filter(option => position.permissions.includes(option.key)).map(option => option.label).join('、') : '只读'}</span></td>
        <td>{position.member_count} 人</td><td><div className="position-actions"><Button htmlType="button" className="btn btn-secondary" disabled={busy} onClick={() => open(position)}>编辑</Button><Button htmlType="button" className="btn btn-secondary" disabled={busy || position.member_count > 0} title={position.member_count ? '请先调整所有员工的岗位（含已停用账号）' : undefined} onClick={() => {
          if (window.confirm(`删除岗位“${position.name}”？`)) void run(() => api(`/positions/${position.id}`, { method: 'DELETE', body: { version: position.version } }), '岗位已删除');
        }}>删除</Button></div>{position.member_count > 0 && <small className="position-delete-hint">有员工关联，暂不可删除</small>}</td></tr>)}
    </tbody></table></div>}
    {!editor && conflict && <Button htmlType="button" className="btn" disabled={busy} onClick={refresh}>刷新岗位列表</Button>}
    {editor && <Modal title={editor.id ? `编辑岗位：${positions.find(row => row.id === editor.id)?.name || editor.name}` : '新增岗位'} className="permission-dialog" onClose={() => { if (!busy) { setEditor(null); setError(''); setConflict(false); } }}>
      <div className="form-body"><div className="account-fields"><label>岗位名称<Input maxLength={60} value={editor.name} disabled={busy} onChange={e => setEditor(current => ({ ...current, name: e.target.value }))} /></label><label>岗位说明<Input.TextArea maxLength={200} rows={3} value={editor.description} disabled={busy} onChange={e => setEditor(current => ({ ...current, description: e.target.value }))} /></label></div>
      <p className="info-box">保存将同步影响 {editor.member_count} 名员工，包含已停用账号。</p>
      {editor.legacy_permissions && <div className="position-legacy-notice"><p>此岗位沿用旧员工权限。仅修改名称或说明会保留原有操作限制。切换为标准模块权限后，同岗员工将获得所选模块的全部操作，可能扩大权限。</p><Checkbox checked={!!editor.convert_legacy} disabled={busy} onChange={e => {
        if (!e.target.checked || window.confirm(`确认将此岗位的 ${editor.member_count} 名员工切换为标准模块权限？这可能扩大原有操作范围，保存后生效。`)) setEditor(current => ({ ...current, convert_legacy: e.target.checked }));
      }}>我确认切换为标准模块权限</Checkbox></div>}
      <div className="permission-options">{permissionOptions.map(option => <Checkbox key={option.key} checked={editor.permissions.includes(option.key)} disabled={busy || (editor.legacy_permissions && !editor.convert_legacy)} onChange={e => setEditor(current => ({ ...current, permissions: e.target.checked ? [...current.permissions, option.key] : current.permissions.filter(key => key !== option.key) }))}><span><strong>{option.label}</strong><small>{option.description}</small></span></Checkbox>)}</div>
      {!editor.permissions.length && <p className="muted">不勾选业务模块时，该岗位为只读岗位。</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {conflict && <Button htmlType="button" className="btn" disabled={busy} onClick={refresh}>刷新版本并保留输入</Button>}
      <div className="permission-dialog-actions"><Button htmlType="button" className="btn btn-secondary" disabled={busy} onClick={() => { setEditor(null); setError(''); setConflict(false); }}>取消</Button><Button type="primary" htmlType="button" className="btn btn-primary" disabled={busy} onClick={save}>保存岗位</Button></div>
      </div>
    </Modal>}
  </section>;
}
