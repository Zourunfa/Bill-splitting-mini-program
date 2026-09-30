import { Button, Input, Text, View } from '@tarojs/components';
import Taro, { useShareAppMessage } from '@tarojs/taro';
import { useState } from 'react';
import { Amount, Avatar, Page, SectionTitle, TripHeader, TripMissing, confirm } from '../../components/ui';
import { isDemo, notifyError, useTrip } from '../../store';
import { getBalances } from '../../../shared/ledger';
import { TripName } from '../../components/trip-name';

export default function MembersPage() {
  const { trip, user, run, addDemoMember, switchUser } = useTrip();
  const [name, setName] = useState(''), [busy, setBusy] = useState(false);
  useShareAppMessage(() => ({ title: `一起记账吧 · ${trip?.name || '旅行AA账本'}`, path: `/pages/trips/index?invite=${encodeURIComponent(trip?.inviteCode || '')}` }));
  if (!trip) return <TripMissing />;
  const balances = getBalances(trip), owner = trip.creatorId === user.id;
  async function add() {
    if (!trip || busy) return;
    setBusy(true);
    try { await addDemoMember(trip.id, name); setName(''); } catch (e) { notifyError(e); } finally { setBusy(false); }
  }
  return <Page trip={trip} active='members'><TripHeader trip={trip} title='一起出发的我们' subtitle='账本共享，开销分明，旅途轻松一点' />
    <TripName trip={trip} />
    <View className='invite-card'><Text className='section-title'>把朋友拉进来</Text><Text className='muted'>分享到微信群，朋友加入后就能一起记账。</Text><View className='invite-code'><Text className='small muted'>邀请码</Text><Text selectable>{trip.inviteCode}</Text></View><View className='action-pair'>{!isDemo && <Button className='button-primary' openType='share' disabled={trip.status === 'closed'}>分享邀请</Button>}<Button className='button-secondary' onClick={() => { void Taro.setClipboardData({ data: trip.inviteCode }).catch(notifyError); }}>复制邀请码</Button></View>{isDemo && <Text className='hint'>演示模式不共享设备数据。可在下方添加旅伴、切换身份体验。</Text>}</View>
    <SectionTitle title={`${trip.members.filter(m => m.active).length} 位旅伴`} />
    <View className='card'>{trip.members.map(m => {
      const balance = balances.find(b => b.memberId === m.id)!;
      return <View className='member-row' key={m.id}><Avatar member={m} /><View className='member-info'><View><Text className='member-name'>{m.name}</Text>{m.id === user.id && <Text className='mini-tag'>我</Text>}{m.id === trip.creatorId && <Text className='mini-tag'>创建者</Text>}{!m.active && <Text className='mini-tag'>已退出</Text>}</View><Text className='muted small'>承担 ¥{(balance.share / 100).toFixed(2)} · 垫付 ¥{(balance.paid / 100).toFixed(2)}</Text></View><View className='member-actions'><Text className={`small ${balance.balance ? 'green' : 'muted'}`}>{balance.balance > 0 ? '待收' : balance.balance < 0 ? '待付' : '已平'}</Text>{balance.balance !== 0 && <Amount value={Math.abs(balance.balance)} />}{isDemo && m.active && m.id !== user.id && <Text className='text-link small' onClick={async () => {
        try { await switchUser({ id: m.id, name: m.name }); } catch (e) { notifyError(e); }
      }}>切换身份</Text>}{owner && m.active && m.id !== user.id && trip.status === 'active' && <Text className='muted small' onClick={async () => {
        if (busy || !await confirm('移除成员', `${m.name}需先结清，移除后历史账目仍保留。`)) return;
        setBusy(true);
        try { await run(trip.id, { type: 'deactivateMember', memberId: m.id }); } catch (e) { notifyError(e); } finally { setBusy(false); }
      }}>移除</Text>}</View></View>;
    })}</View>
    {isDemo && owner && trip.status === 'active' && <View className='card form-card'><Text className='field-label'>添加演示旅伴</Text><View className='inline-form'><Input className='field-input' value={name} maxlength={20} placeholder='旅伴昵称' onInput={e => setName(e.detail.value)} /><Button className='button-primary' loading={busy} disabled={busy} onClick={() => void add()}>添加</Button></View><Text className='hint'>新成员不会分摊加入前的费用。</Text></View>}
    <SectionTitle title='最近的账本动态' subtitle='修改有记录，大家心里有数' />
    <View className='card activity-card'>{trip.audit.length ? [...trip.audit].reverse().slice(0, 12).map((entry, index) => <View className='activity-row' key={`${entry.at}_${index}`}><View className='activity-dot' /><View><Text>{trip.members.find(m => m.id === entry.actorId)?.name} · {entry.action}</Text><Text className='small muted'>{new Date(entry.at).toLocaleString('zh-CN')}</Text></View></View>) : <Text className='muted'>旅途刚刚开始，还没有动态。</Text>}</View>
  </Page>;
}
