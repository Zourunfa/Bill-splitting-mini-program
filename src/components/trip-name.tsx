import { Button, Input, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useState } from 'react';
import type { Trip } from '../../shared/types';
import { notifyError, useLedger } from '../store';
import { Avatar } from './ui';

export function TripName({ trip }: { trip: Trip }) {
  const { user, run } = useLedger();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(''), [busy, setBusy] = useState(false);
  const member = trip.members.find(m => m.id === user.id && m.active);
  if (!member || trip.status !== 'active') return null;
  const needsName = member.name === '旅友';
  async function save() {
    if (busy || !name.trim()) return;
    setBusy(true);
    try {
      await run(trip.id, { type: 'renameSelf', name: name.trim() });
      setEditing(false);
      void Taro.showToast({ title: '本旅行的名字已更新', icon: 'success' });
    } catch (e) { notifyError(e); } finally { setBusy(false); }
  }
  return <>
    <View className='trip-name-card'>
      <View className='row-between'><Avatar member={member} small /><View className='trip-name-info'><Text className='small muted'>我在本旅行的名字</Text><Text className='trip-name-value'>{member.name}</Text></View><Button className='button-secondary trip-name-edit' onClick={() => { setName(needsName ? '' : member.name); setEditing(true); }}>{needsName ? '填写名字' : '修改名字'}</Button></View>
      {needsName && <Text className='hint'>填个朋友认识的名字，记账和分摊时更好认。</Text>}
    </View>
    {editing && <View className='modal-mask'><View className='modal-sheet'>
      <View className='row-between'><Text className='section-title'>我在本旅行的名字</Text><Text className='close-button' onClick={() => !busy && setEditing(false)}>×</Text></View>
      <View className='form-field'><Text className='field-label'>名字 / 群内昵称</Text><Input className='field-input' value={name} maxlength={20} placeholder='填写朋友认识的名字' onInput={e => setName(e.detail.value)} /><Text className='hint'>只修改「{trip.name}」中的名字。历史账单会同步显示新名字，金额和分摊不变。</Text></View>
      <View className='action-pair'><Button className='button-secondary' disabled={busy} onClick={() => setEditing(false)}>取消</Button><Button className='button-primary' loading={busy} disabled={busy || !name.trim()} onClick={() => void save()}>保存名字</Button></View>
    </View></View>}
  </>;
}
