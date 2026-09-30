import { Button, Text, View } from '@tarojs/components';
import { Amount, Avatar, Empty, ExpenseRow, Page, SectionTitle, TripHeader, TripMissing } from '../../components/ui';
import { go, useTrip } from '../../store';
import { getBalances, money } from '../../../shared/ledger';
import { CATEGORIES } from '../../../shared/types';
import { TripName } from '../../components/trip-name';

export default function OverviewPage() {
  const { trip, user } = useTrip();
  if (!trip) return <TripMissing />;
  const expenses = trip.expenses.filter(e => !e.deleted);
  const total = expenses.reduce((s, e) => s + e.amount, 0);
  const balances = getBalances(trip);
  const mine = balances.find(b => b.memberId === user.id);
  const recent = [...expenses].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt).slice(0, 4);
  const pending = trip.settlements.filter(s => s.status === 'pending').length;
  return <Page trip={trip} active='overview'>
    <TripHeader trip={trip} title={trip.name} subtitle={`${trip.startDate.replace(/-/g, '.')} — ${trip.endDate.replace(/-/g, '.')} · ${trip.status === 'closed' ? '已结清，留住这段回忆' : '旅途中，随手记一笔'}`} />
    <TripName trip={trip} />
    <View className='summary-card'><View className='row-between'><Text className='summary-label'>这趟旅行，一起花了</Text><Text className='summary-decoration'>✦</Text></View><View className='summary-total'><Text className='currency'>¥</Text><Text>{money(total)}</Text></View><View className='summary-footer'><View className='avatar-stack'>{trip.members.filter(m => m.active).slice(0, 5).map(m => <Avatar member={m} key={m.id} small />)}</View><Text>{expenses.length} 笔共同开销</Text></View></View>
    <View className='my-stats'><View><Text className='muted small'>我应承担</Text><Amount value={mine?.share || 0} /></View><View><Text className='muted small'>我已垫付</Text><Amount value={mine?.paid || 0} /></View><View><Text className='muted small'>{(mine?.balance || 0) >= 0 ? '我待收' : '我待付'}</Text><Amount value={Math.abs(mine?.balance || 0)} className='green' /></View></View>
    {trip.status === 'active' && <Button className='button-primary add-expense' onClick={() => go('expense', trip.id)}>＋ 记一笔共同开销</Button>}
    {pending > 0 && <View className='notice' onClick={() => go('settlement', trip.id)}>有 {pending} 笔转账等待收款人确认 · 去看看 →</View>}
    <SectionTitle title='旅途里的每一笔' subtitle='大家都能看到，放心一起花' action='全部账单' onAction={() => go('bills', trip.id)} />
    <View className='card'>{recent.length ? recent.map(e => <ExpenseRow expense={e} trip={trip} key={e.id} onClick={() => go('expense', trip.id, `&expenseId=${e.id}`)} />) : <Empty title='第一笔，记点什么？' detail='一顿饭、一箱油，或者今晚的住宿' />}</View>
    {total > 0 && <><SectionTitle title='钱都花在哪儿了' /><View className='card category-summary'>{CATEGORIES.map(category => {
      const value = expenses.filter(e => e.category === category).reduce((s, e) => s + e.amount, 0);
      if (!value) return null;
      return <View className='category-stat' key={category}><View className='row-between'><Text>{category}</Text><Text className='muted small'>¥{money(value)} · {Math.round(value / total * 100)}%</Text></View><View className='progress-track'><View className='progress-fill' style={{ width: `${value / total * 100}%` }} /></View></View>;
    })}</View></>}
    <Text className='footer-note'>风景值得记录，开销也是。</Text>
  </Page>;
}
