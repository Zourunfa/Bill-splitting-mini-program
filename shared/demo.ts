import { applyCommand, createTrip, joinTrip } from './ledger';
import type { Trip, User } from './types';

export const DEMO_USERS: User[] = [
  { id: 'demo_me', name: '我' }, { id: 'demo_lin', name: '小林' },
  { id: 'demo_yu', name: '阿宇' }, { id: 'demo_tang', name: '糖糖' }
];
export function seedTrips(): Trip[] {
  let trip = createTrip({ name: '去川西，找个秋天', destination: '成都 · 康定 · 稻城', startDate: '2026-10-01', endDate: '2026-10-07' }, DEMO_USERS[0], 'demo_trip', 'chuanxi2026', Date.now());
  for (const user of DEMO_USERS.slice(1)) trip = joinTrip(trip, user);
  const all = DEMO_USERS.map(u => u.id);
  const entries = [
    { id: 'demo_e1', title: '康定的第一晚住宿', amount: 128000, payerId: 'demo_me', participantIds: all, category: '住宿' as const, date: '2026-10-01', note: '两间标间，大家一起住' },
    { id: 'demo_e2', title: '出发前，一起吃顿火锅', amount: 36800, payerId: 'demo_lin', participantIds: all, category: '餐饮' as const, date: '2026-10-01', note: '微辣，也是川西的仪式感' },
    { id: 'demo_e3', title: '沿途加油', amount: 42000, payerId: 'demo_yu', participantIds: all, category: '交通' as const, date: '2026-10-02', note: '' },
    { id: 'demo_e4', title: '木格措门票', amount: 21000, payerId: 'demo_tang', participantIds: ['demo_me', 'demo_tang'], category: '门票' as const, date: '2026-10-02', note: '小林和阿宇在镇上逛逛' }
  ];
  for (const { id, ...expense } of entries) trip = applyCommand(trip, expense.payerId, { type: 'addExpense', requestId: id, expense });
  return [trip];
}
