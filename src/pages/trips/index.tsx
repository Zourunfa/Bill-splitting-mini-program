import { Button, Input, Picker, Text, View } from '@tarojs/components';
import Taro, { useDidShow, useRouter } from '@tarojs/taro';
import { useEffect, useRef, useState } from 'react';
import { Avatar, Empty, Page, SectionTitle, Tag, confirm } from '../../components/ui';
import { go, isDemo, notifyError, useLedger } from '../../store';
import { requestId } from '../../services/ledger';
import { money } from '../../../shared/ledger';
import { DEMO_USERS } from '../../../shared/demo';

export default function TripsPage() {
  const { trips, user, loading, create, join, reload, switchUser, resetDemo } = useLedger();
  const router = useRouter();
  const [panel, setPanel] = useState<'create' | 'join' | null>(router.params.invite ? 'join' : null);
  const [name, setName] = useState(''), [destination, setDestination] = useState('川西');
  const [nickname, setNickname] = useState('');
  const nicknameEdited = useRef(false);
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const [startDate, setStartDate] = useState(today), [endDate, setEndDate] = useState(today);
  const [code, setCode] = useState(router.params.invite || ''), [busy, setBusy] = useState(false);
  const createId = useRef(requestId());
  useEffect(() => { if (user.id && !nicknameEdited.current) setNickname(user.name === '旅友' ? '' : user.name); }, [user.id, user.name]);
  useDidShow(() => { if (!isDemo) void reload(); });
  const people = [...new Map([...DEMO_USERS, ...trips.flatMap(t => t.members.filter(m => m.active).map(m => ({ id: m.id, name: m.name })))].map(u => [u.id, u])).values()];
  async function submit() {
    if (busy || !nickname.trim()) return;
    setBusy(true);
    try {
      const trip = panel === 'create'
        ? await create({ name, destination, startDate, endDate }, nickname.trim(), createId.current)
        : await join(code.trim(), nickname.trim());
      createId.current = requestId(); setPanel(null); go('overview', trip.id);
    } catch (e) { notifyError(e); } finally { setBusy(false); }
  }
  return <Page>
    <View className='brand'><View className='brand-mark'>山</View><Text className='brand-name'>一起去</Text><Text className='brand-note'>旅行 AA 账本</Text></View>
    <View className='welcome'><Text className='eyebrow'>LESS MATH, MORE MEMORIES</Text><Text className='welcome-title'>好好玩，<Text className='green'>账我来算。</Text></Text><Text className='muted'>每一笔一起花的钱，都清清楚楚。</Text></View>
    <View className='trip-illustration'><View className='sun' /><View className='mountain mountain-back' /><View className='mountain mountain-front' /><View className='trail' /><Text className='illustration-caption'>和喜欢的人，去想去的地方</Text><Text className='illustration-coordinate'>30° N / WESTERN SICHUAN</Text></View>
    <View className='action-pair'><Button className='button-primary' onClick={() => { setPanel('create'); createId.current = requestId(); }}>＋ 创建旅行</Button><Button className='button-secondary' onClick={() => setPanel('join')}>加入朋友的旅行</Button></View>
    {isDemo && <View className='demo-controls'><View className='row-between'><Text className='small muted'>当前演示身份</Text><Picker mode='selector' range={people.map(u => u.name)} value={Math.max(0, people.findIndex(u => u.id === user.id))} onChange={e => { void switchUser(people[Number(e.detail.value)]).catch(notifyError); }}><Text className='text-link'>{user.name} ▾</Text></Picker></View><Text className='hint'>切换成付款人标记转账，再切换成收款人确认到账。</Text></View>}
    <SectionTitle title='我的旅行' subtitle={`${trips.length} 个共同的故事`} />
    {loading ? <Empty title='正在打开旅行…' /> : trips.length === 0 ? <Empty title='你的第一趟旅行，从这里开始' detail='创建账本，分享到微信群，大家就能一起记账了' /> : trips.map(trip => {
      const total = trip.expenses.filter(e => !e.deleted).reduce((sum, e) => sum + e.amount, 0);
      return <View className='trip-card' key={trip.id} onClick={() => go('overview', trip.id)}><View className='row-between'><Tag>{trip.status === 'closed' ? '已结清' : '旅途中'}</Tag><Text className='muted small'>{trip.startDate.slice(5).replace('-', '.')} — {trip.endDate.slice(5).replace('-', '.')}</Text></View><Text className='trip-card-title'>{trip.name}</Text><Text className='muted small'>{trip.destination}</Text><View className='trip-card-footer'><View className='avatar-stack'>{trip.members.filter(m => m.active).slice(0, 5).map(m => <Avatar member={m} small key={m.id} />)}<Text className='muted small'>{trip.members.filter(m => m.active).length} 人同行</Text></View><Text className='amount'>¥{money(total)} <Text className='small muted'>→</Text></Text></View></View>;
    })}
    <Text className='footer-note'>把时间留给风景，把账留给一起去。</Text>
    {isDemo && <Text className='reset-link' onClick={async () => { if (await confirm('重置演示账本', '将删除本机所有演示记账数据，恢复初始示例。')) void resetDemo().catch(notifyError); }}>重置演示数据</Text>}
    {panel && <View className='modal-mask'><View className='modal-sheet'><View className='row-between'><Text className='section-title'>{panel === 'create' ? '新的旅行，出发吧' : '加入朋友的旅行'}</Text><Text className='close-button' onClick={() => !busy && setPanel(null)}>×</Text></View>
      <View className='form-field'><Text className='field-label'>你在本旅行的名字（必填）</Text><Input className='field-input' value={nickname} maxlength={20} placeholder='填写朋友认识的名字' onInput={e => { nicknameEdited.current = true; setNickname(e.detail.value); }} /><Text className='hint'>可以填写群内昵称，加入后也能在旅行内修改。</Text></View>
      {panel === 'create' ? <>
        <View className='form-field'><Text className='field-label'>旅行名称</Text><Input className='field-input' value={name} maxlength={30} placeholder='比如：川西七日，去看秋天' onInput={e => setName(e.detail.value)} /></View>
        <View className='form-field'><Text className='field-label'>目的地</Text><Input className='field-input' value={destination} maxlength={30} placeholder='这次去哪儿' onInput={e => setDestination(e.detail.value)} /></View>
        <View className='date-pair'><View className='form-field'><Text className='field-label'>出发日期</Text><Picker mode='date' value={startDate} onChange={e => setStartDate(e.detail.value)}><View className='field-input picker-value'>{startDate} ▾</View></Picker></View><View className='form-field'><Text className='field-label'>结束日期</Text><Picker mode='date' value={endDate} onChange={e => setEndDate(e.detail.value)}><View className='field-input picker-value'>{endDate} ▾</View></Picker></View></View>
      </> : <View className='form-field'><Text className='field-label'>邀请码</Text><Input className='field-input' value={code} placeholder='粘贴朋友分享的邀请码' onInput={e => setCode(e.detail.value)} /><Text className='hint'>{isDemo ? '演示账本邀请码：chuanxi2026' : '打开朋友分享的小程序卡片，也会自动填入。'}</Text></View>}
      <Button className='button-primary' loading={busy} disabled={busy || !user.id || !nickname.trim() || (panel === 'join' && !code.trim())} onClick={() => void submit()}>{panel === 'create' ? '创建旅行' : '加入旅行'}</Button>
    </View></View>}
  </Page>;
}
