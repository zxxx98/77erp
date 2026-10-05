import React, { useState } from 'react';
import { Alert, Text } from 'react-native';
import { Category, categoryBranch, flattenCategories } from './model';
import { api } from './native';
import { Button, Card, Chips, Field, ScreenModal, s, useFormError, useSubmitLock } from './ui';

export function CategoryEditor({ categories, onClose, onChanged }: {
  categories: Category[];
  onClose: () => void;
  onChanged: () => Promise<unknown>;
}) {
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [parent, setParent] = useState('');
  const [busy, setBusy] = useState(false);
  const { error, errorRevision, setError } = useFormError();
  const lock = useSubmitLock();
  const options = flattenCategories(categories);
  const excluded = categoryBranch(categories, Number(id));
  const select = (value: string) => {
    if (busy) return;
    const c = categories.find(c => String(c.id) === value);
    setId(value); setName(c?.name || ''); setParent(c?.parent_id ? String(c.parent_id) : ''); setError('');
  };
  const run = async (action: () => Promise<unknown>) => {
    if (!lock.enter()) return;
    setBusy(true); setError('');
    try { await action(); await onChanged(); setId(''); setName(''); setParent(''); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); lock.leave(); }
  };
  const save = () => void run(async () => {
    if (!name.trim() || name.length > 100) throw new Error('请填写 1–100 字的分类名称。');
    return api(id ? `/categories/${id}` : '/categories', id ? 'PUT' : 'POST', { name: name.trim(), parent_id: parent ? Number(parent) : null });
  });
  return <ScreenModal title="管理商品分类" onClose={onClose} busy={busy} error={error} errorRevision={errorRevision}
    dirty={!!name.trim() && (!id || categories.find(c => String(c.id) === id)?.name !== name || String(categories.find(c => String(c.id) === id)?.parent_id || '') !== parent)}
    footer={<Button title="保存分类" busy={busy} onPress={save} />}>
    <Card>
      <Text style={s.label}>编辑分类</Text>
      <Chips value={id} onChange={select} options={[{ id: '', label: '新增分类' }, ...options.map(c => ({ id: String(c.id), label: c.path }))]} />
      <Field label="分类名称" value={name} onChangeText={setName} maxLength={100} editable={!busy} placeholder="例如：杯具" />
      <Text style={s.label}>上级分类</Text>
      <Chips value={parent} onChange={value => { if (!busy) setParent(value); }} options={[{id: '', label: '无（一级分类）'}, ...options.filter(c => !excluded.has(c.id)).map(c => ({id: String(c.id), label: c.path}))]} />
      <Text style={s.caption}>选择上级分类即可建立子分类。父分类的筛选包含下级商品。</Text>
      {!!id && <Button title="删除分类" kind="danger" disabled={busy} onPress={() => Alert.alert('删除分类', '删除前需移走该分类的下级分类及商品。', [
        { text: '取消', style: 'cancel' }, { text: '删除', style: 'destructive', onPress: () => void run(() => api(`/categories/${id}/delete`, 'POST', {})) },
      ])} />}
    </Card>
  </ScreenModal>;
}
