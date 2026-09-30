import { Button, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import type { PropsWithChildren } from 'react';
import { money } from '../../shared/ledger';
import type { Category, Expense, Member, Trip } from '../../shared/types';
import { go, isDemo, useLedger } from '../store';

export const categoryIcon: Record<Category, string> = { 餐饮: '食', 住宿: '宿', 交通: '行', 门票: '游', 其他: '杂' };
export function Avatar({ member, small = false }: { member?: Member; small?: boolean }) {
  return <View className={`avatar ${small ? 'avatar-small' : ''}`} style={{ backgroundColor: member?.color || '#456c57' }}>{member?.name.slice(0, 1) || '?'}</View>;
}
export function Amount({ value, className = '' }: { value: number; className?: string }) {
  return <Text className={`amount ${className}`}>¥{money(value)}</Text>;
}
export function SectionTitle({ title, subtitle, action, onAction }: { title: string; subtitle?: string; action?: string; onAction?: () => void }) {
  return <View className='section-heading'><View><Text className='section-title'>{title}</Text>{subtitle && <Text className='section-subtitle'>{subtitle}</Text>}</View>{action && <Text className='text-link' onClick={onAction}>{action} →</Text>}</View>;
}
export function Empty({ title, detail }: { title: string; detail?: string }) {
  return <View className='empty'><View className='empty-symbol'>✦</View><Text className='empty-title'>{title}</Text>{detail && <Text className='muted'>{detail}</Text>}</View>;
}
export function Page({ children, trip, active }: PropsWithChildren<{ trip?: Trip; active?: string }>) {
  const { error, reload } = useLedger();
  return <View className={`page ${trip ? 'page-with-tabs' : ''}`}>
    {isDemo && <View className='demo-banner'><Text>本地演示 · 数据只保存在当前设备</Text><Text className='text-link' onClick={() => go('trips')}>切换成员</Text></View>}
    {error && <View className='error-banner' onClick={() => void reload()}>{error} · 点击重试</View>}
    {children}
    {trip && <View className='bottom-nav'>
      {[['overview', '总览', '◫'], ['bills', '账单', '≡'], ['members', '旅伴', '♧'], ['settlement', '结算', '⇄']].map(([key, label, icon]) => <View key={key} className={`nav-item ${active === key ? 'active' : ''}`} onClick={() => {
        if (key !== active) void Taro.redirectTo({ url: `/pages/${key}/index?tripId=${trip.id}` });
      }}><Text className='nav-icon'>{icon}</Text><Text>{label}</Text></View>)}
    </View>}
  </View>;
}
export function TripHeader({ trip, title, subtitle }: { trip: Trip; title: string; subtitle: string }) {
  return <View className='page-heading'><View className='row-between'><Text className='eyebrow'>{trip.destination} / {trip.members.filter(m => m.active).length} 位旅伴</Text><Text className='text-link small' onClick={() => go('trips')}>我的旅行</Text></View><Text className='page-title'>{title}</Text><Text className='muted'>{subtitle}</Text></View>;
}
export function ExpenseRow({ expense, trip, onClick }: { expense: Expense; trip: Trip; onClick?: () => void }) {
  const payer = trip.members.find(m => m.id === expense.payerId);
  return <View className='expense-row' onClick={onClick}><View className={`category-icon category-${{ '住宿': 'lodging', '餐饮': 'food', '交通': 'transport', '门票': 'tickets', '其他': 'other' }[expense.category]}`}>{categoryIcon[expense.category]}</View><View className='expense-info'><Text className='expense-title'>{expense.title}</Text><Text className='muted small'>{payer?.name}垫付 · {expense.participantIds.length} 人分摊</Text></View><View className='expense-right'><Amount value={expense.amount} /><Text className='muted small'>{expense.date.slice(5).replace('-', '.')}</Text></View></View>;
}
export function TripMissing() {
  const { loading } = useLedger();
  return <Page><Empty title={loading ? '正在打开账本…' : '暂时找不到这次旅行'} detail={loading ? '稍等一下，旅途马上开始' : '请检查网络，或回到旅行列表重新打开'} /><Button className='button-secondary' onClick={() => void Taro.reLaunch({ url: '/pages/trips/index' })}>回到我的旅行</Button></Page>;
}
export function Tag({ children }: PropsWithChildren) { return <Text className='tag'>{children}</Text>; }
export async function confirm(title: string, content: string): Promise<boolean> {
  const result = await Taro.showModal({ title, content, confirmColor: '#456c57', confirmText: '确定' });
  return result.confirm;
}
