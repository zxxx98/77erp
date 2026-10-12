import React, { useState } from 'react';
import { Text } from 'react-native';
import { api } from './native';
import { Button, Field, ScreenModal, s, useFormError, useSubmitLock } from './ui';

export function PasswordEditor({ onClose, onChanged }: { onClose: () => void; onChanged: () => Promise<void> }) {
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const { error, errorRevision, setError } = useFormError();
  const lock = useSubmitLock();
  const save = async () => {
    if (!lock.enter()) return;
    setBusy(true); setError('');
    try {
      if (password !== confirmation) throw new Error('两次输入的密码不一致。');
      await api('/auth/password', 'POST', { current_password: current, password });
      await onChanged();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); lock.leave(); }
  };
  return <ScreenModal title="修改密码" onClose={onClose} busy={busy} error={error} errorRevision={errorRevision}
    footer={<Button title="确认修改密码" busy={busy} onPress={() => void save()} />}>
    <Text style={s.caption}>修改后所有设备需要重新登录。</Text>
    <Field label="当前密码" value={current} onChangeText={setCurrent} secureTextEntry autoComplete="current-password" maxLength={128} editable={!busy} />
    <Field label="新密码" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" maxLength={128} editable={!busy} />
    <Field label="确认新密码" value={confirmation} onChangeText={setConfirmation} secureTextEntry autoComplete="new-password" maxLength={128} editable={!busy} />
  </ScreenModal>;
}
