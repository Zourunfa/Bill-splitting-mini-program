import { Button, Text, View } from '@tarojs/components';
import { useState } from 'react';
import { Amount, Avatar, Empty, Page, SectionTitle, TripHeader, TripMissing, confirm } from '../../components/ui';
import { isDemo, notifyError, useTrip } from '../../store';
import { requestId } from '../../services/ledger';
import { getBalances, suggestTransfers } from '../../../shared/ledger';
import type { Command } from '../../../shared/types';

export default function SettlementPage() {
  const { trip, user, run, reload } = useTrip();
  const [busy, setBusy] = useState(false);
  if (!trip) return <TripMissing />;
  const balances = getBalances(trip), transfers = suggestTransfers(trip);
  const pending = trip.settlements.filter(s => s.status === 'pending');
  const cleared = balances.every(b => b.balance === 0) && pending.length === 0;
  const owner = trip.creatorId === user.id;
  const member = (id: string) => trip.members.find(m => m.id === id);
  async function action(command: Command, title: string, content: string) {
    if (!trip || busy || !await confirm(title, content)) return;
    setBusy(true);
    try { await run(trip.id, command); } catch (e) { notifyError(e); void reload(); } finally { setBusy(false); }
  }
  return <Page trip={trip} active='settlement'><TripHeader trip={trip} title='算清楚，继续做好朋友' subtitle='根据共同开销，整理出需要转账的金额' />
    <View className={`settlement-status ${cleared ? 'cleared' : ''}`}><View className='status-symbol'>{cleared ? '✓' : '⇄'}</View><View><Text className='section-title'>{cleared ? '大家都结清了' : pending.length ? `${pending.length} 笔转账等待确认` : `还需要 ${transfers.length} 笔转账`}</Text><Text className='muted small'>{cleared ? '旅途有回忆，账目无牵挂。' : '微信手动转账，收到钱后再确认到账。'}</Text></View></View>
    <SectionTitle title='每个人的账' subtitle='已确认的转账已经计入余额' />
    <View className='card'>{balances.map(b => <View className='balance-row' key={b.memberId}><Avatar member={member(b.memberId)} small /><View className='member-info'><Text className='member-name'>{member(b.memberId)?.name}{b.memberId === user.id ? '（我）' : ''}</Text><Text className='small muted'>垫付 ¥{(b.paid / 100).toFixed(2)} · 承担 ¥{(b.share / 100).toFixed(2)}</Text></View><View className='expense-right'><Text className='small muted'>{b.balance > 0 ? '待收' : b.balance < 0 ? '待付' : '已结清'}</Text><Amount value={Math.abs(b.balance)} className={b.balance ? 'green' : ''} /></View></View>)}</View>
    {pending.length > 0 && <><SectionTitle title='等待到账确认' subtitle='待确认的金额不会重复生成转账建议' />{pending.map(s => <View className='transfer-card pending-transfer' key={s.id}><View className='transfer-top'><Text>{member(s.fromId)?.name} <Text className='transfer-arrow'>→</Text> {member(s.toId)?.name}</Text><Amount value={s.amount} /></View><Text className='small muted'>付款人已标记转账，请收款人核对微信记录。</Text><View className='action-pair'>{s.toId === user.id && <Button className='button-primary' disabled={busy} onClick={() => void action({ type: 'confirmTransfer', settlementId: s.id }, '确认收到钱了？', '请先核对微信转账记录，确认后才会更新双方余额。')}>确认到账</Button>}{(s.fromId === user.id || s.toId === user.id) && <Button className='button-secondary' disabled={busy} onClick={() => void action({ type: 'cancelTransfer', settlementId: s.id }, '取消转账标记？', '仅取消账本里的标记，取消后会恢复转账建议。')}>取消标记</Button>}</View></View>)}</>}
    <SectionTitle title='这样转，大家就清了' subtitle='根据当前余额生成建议，待确认转账已预留' />
    {transfers.length ? transfers.map((s, index) => <View className='transfer-card' key={`${s.fromId}_${s.toId}`}><View className='transfer-top'><View><Text className='transfer-number'>{String(index + 1).padStart(2, '0')}</Text><Text>{member(s.fromId)?.name} <Text className='transfer-arrow'>→</Text> {member(s.toId)?.name}</Text></View><Amount value={s.amount} className='green' /></View>{s.fromId === user.id ? <Button className='button-primary' disabled={busy} onClick={() => void action({ type: 'recordTransfer', requestId: requestId(), toId: s.toId, amount: s.amount }, '已经在微信转账了吗？', '请先在微信里转账。标记后，收款人还需确认到账。')}>我已转账，通知对方确认</Button> : <Text className='small muted'>等待付款人完成转账并标记</Text>}</View>) : <Empty title={cleared ? '没有需要转的账啦' : '等待朋友确认到账'} detail={cleared ? '这段旅程，留下的只有好回忆' : '确认或取消已有标记后，再查看最新建议'} />}
    {trip.settlements.some(s => s.status === 'confirmed') && <><SectionTitle title='已到账的转账' /><View className='card'>{trip.settlements.filter(s => s.status === 'confirmed').map(s => <View className='confirmed-row' key={s.id}><Text>{member(s.fromId)?.name} → {member(s.toId)?.name}</Text><Amount value={s.amount} /><Text className='mini-tag'>已到账</Text></View>)}</View></>}
    {owner && <Button className='button-secondary' disabled={busy || (trip.status === 'active' && !cleared)} onClick={() => void action({ type: trip.status === 'active' ? 'close' : 'reopen' }, trip.status === 'active' ? '关闭这次旅行账本？' : '重新打开账本？', trip.status === 'active' ? '关闭后保留全部账目，需要补记时可以重新打开。' : '重新打开后可以补记或修改，余额会重新计算。')}>{trip.status === 'active' ? '全部结清，关闭账本' : '重新打开账本'}</Button>}
    <Text className='footer-note'>转账标记只记录账目，不会自动扣款。</Text>
  </Page>;
}
