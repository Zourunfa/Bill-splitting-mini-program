import { Button, Input, Text, View } from '@tarojs/components';
import { useState } from 'react';
import { useRouter } from '@tarojs/taro';
import { Empty, ExpenseRow, Page, SectionTitle, TripHeader, TripMissing } from '../../components/ui';
import { go, useTrip } from '../../store';
import { money } from '../../../shared/ledger';
import { CATEGORIES } from '../../../shared/types';

export default function BillsPage() {
  const { trip } = useTrip();
  const router = useRouter();
  const [category, setCategory] = useState('全部'), [query, setQuery] = useState(''), [payer, setPayer] = useState('全部');
  if (!trip) return <TripMissing />;
  const filtered = trip.expenses.filter(e => !e.deleted && (category === '全部' || e.category === category) && (payer === '全部' || e.payerId === payer) && `${e.title} ${e.note}`.includes(query.trim())).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  const dates = [...new Set(filtered.map(e => e.date))];
  return <Page trip={trip} active='bills'><TripHeader trip={trip} title='共同的账，明明白白' subtitle='每一笔开销，都能找到来处' />
    {router.params.saved === '1' && <View className='notice'>已保存到共享账本，下方已显示最新账单。</View>}
    <View className='search-box'><Text>⌕</Text><Input placeholder='搜索用途或备注' value={query} onInput={e => setQuery(e.detail.value)} /></View>
    <View className='chips'>{['全部', ...CATEGORIES].map(c => <Text className={`chip ${category === c ? 'selected' : ''}`} key={c} onClick={() => setCategory(c)}>{c}</Text>)}</View>
    <View className='chips member-filters'><Text className={`chip ${payer === '全部' ? 'selected' : ''}`} onClick={() => setPayer('全部')}>所有付款人</Text>{trip.members.map(m => <Text className={`chip ${payer === m.id ? 'selected' : ''}`} key={m.id} onClick={() => setPayer(m.id)}>{m.name}</Text>)}</View>
    <View className='filter-summary'><Text>共 {filtered.length} 笔</Text><Text>合计 ¥{money(filtered.reduce((sum, e) => sum + e.amount, 0))}</Text></View>
    {dates.length ? dates.map(date => <View key={date}><SectionTitle title={`${date.slice(5).replace('-', ' 月 ')} 日`} subtitle={`${filtered.filter(e => e.date === date).length} 笔开销`} /><View className='card'>{filtered.filter(e => e.date === date).map(e => <ExpenseRow expense={e} trip={trip} key={e.id} onClick={() => go('expense', trip.id, `&expenseId=${e.id}`)} />)}</View></View>) : <Empty title='这里还没有账单' detail={query || category !== '全部' || payer !== '全部' ? '换个筛选条件试试' : '记下第一笔旅行开销吧'} />}
    {trip.status === 'active' && <Button className='button-primary' onClick={() => go('expense', trip.id)}>＋ 记一笔</Button>}
  </Page>;
}
