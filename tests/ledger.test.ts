import { describe, expect, it } from 'vitest';
import { applyCommand, createTrip, equalShares, expenseSnapshot, getBalances, joinTrip, money, parseAmount, suggestTransfers } from '../shared/ledger';
import type { ExpenseInput, Trip } from '../shared/types';

function fixture(): Trip {
  let trip = createTrip({ name: '川西旅行', destination: '川西', startDate: '2026-10-01', endDate: '2026-10-07' }, { id: 'a', name: '小王' }, 'trip', 'invite', 1);
  trip = joinTrip(trip, { id: 'b', name: '小李' }, 2);
  return joinTrip(trip, { id: 'c', name: '小张' }, 3);
}
const base: ExpenseInput = { title: '住宿', amount: 60000, payerId: 'a', participantIds: ['a', 'b', 'c'], category: '住宿', date: '2026-10-01', note: '' };
function expense(trip: Trip, id = 'e1', input = base, actor = 'a'): Trip {
  return applyCommand(trip, actor, { type: 'addExpense', requestId: id, expense: input }, 10);
}
function example(): Trip {
  let trip = expense(fixture());
  trip = expense(trip, 'e2', { ...base, title: '吃饭', amount: 30000, payerId: 'b', category: '餐饮' }, 'b');
  return expense(trip, 'e3', { ...base, title: '门票', amount: 20000, payerId: 'c', participantIds: ['a', 'c'], category: '门票' }, 'c');
}

describe('金额与均分', () => {
  it('精确解析金额，不依赖浮点乘法', () => {
    expect(parseAmount('10.01')).toBe(1001); expect(parseAmount('0.29')).toBe(29);
    expect(parseAmount('12.3')).toBe(1230); expect(money(1001)).toBe('10.01');
    for (const value of ['0', '-1', '1.001', 'NaN', '1e3', '1000000.01']) expect(() => parseAmount(value)).toThrow();
  });
  it('按稳定顺序分配尾差，总额始终相等', () => {
    expect(equalShares(100, ['c', 'b', 'a'])).toEqual({ a: 34, b: 33, c: 33 });
    expect(equalShares(1, ['b', 'a', 'c'])).toEqual({ a: 1, b: 0, c: 0 });
    expect(() => equalShares(100, [])).toThrow(); expect(() => equalShares(100, ['a', 'a'])).toThrow();
  });
  it('大量不同金额和人数都不丢失一分钱', () => {
    for (let size = 1; size <= 30; size++) for (let amount = 1; amount < 1200; amount += 17) {
      const values = Object.values(equalShares(amount, Array.from({ length: size }, (_, i) => `m${i}`)));
      expect(values.reduce((a, b) => a + b, 0)).toBe(amount);
      expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(1);
    }
  });
});
describe('账单和权限', () => {
  it('付款人、记录人、参与人可以不同', () => {
    const trip = expense(fixture(), 'e1', { ...base, payerId: 'b', participantIds: ['a', 'c'] });
    expect(trip.expenses[0].creatorId).toBe('a');
    expect(getBalances(trip).map(b => b.balance)).toEqual([-30000, 60000, -30000]);
  });
  it('准确计算部分人参与的示例', () => {
    expect(getBalances(example()).map(b => ({ paid: b.paid, share: b.share, balance: b.balance }))).toEqual([
      { paid: 60000, share: 40000, balance: 20000 }, { paid: 30000, share: 30000, balance: 0 }, { paid: 20000, share: 40000, balance: -20000 }
    ]);
    expect(suggestTransfers(example())).toEqual([{ fromId: 'c', toId: 'a', amount: 20000 }]);
  });
  it('重复提交只保存一笔，不增加版本', () => {
    const trip = expense(fixture()); expect(expense(trip)).toBe(trip);
    expect(() => expense(trip, 'e1', base, 'b')).toThrow('请求编号已被使用');
  });
  it('非成员不能读写账本操作', () => { expect(() => expense(fixture(), 'e1', base, 'outsider')).toThrow('有效成员'); });
  it('非记录人和非创建者不能改账', () => {
    const trip = expense(fixture());
    expect(() => applyCommand(trip, 'b', { type: 'deleteExpense', expenseId: 'e1', expectedVersion: trip.version })).toThrow('记录人');
  });
  it('旧版本修改被拒绝，避免覆盖朋友的新账', () => {
    const trip = expense(fixture());
    expect(() => applyCommand(trip, 'a', { type: 'editExpense', expenseId: 'e1', expense: base, expectedVersion: trip.version - 1 })).toThrow('已更新');
  });
  it('成员改名和新增其他账单不阻止保存当前账单', () => {
    const original = expense(fixture());
    const expectedExpenseSnapshot = expenseSnapshot(original.expenses[0]);
    let updated = applyCommand(original, 'b', { type: 'renameSelf', name: '新名字' });
    updated = joinTrip(updated, { id: 'd', name: '新旅伴' });
    updated = expense(updated, 'other');
    const saved = applyCommand(updated, 'a', { type: 'editExpense', expenseId: 'e1', expectedVersion: original.version, expectedExpenseSnapshot, expense: { ...base, amount: 71400, title: '香格里拉镇酒店', participantIds: ['a', 'b'] } });
    expect(saved.expenses[0]).toMatchObject({ amount: 71400, title: '香格里拉镇酒店', shares: { a: 35700, b: 35700 } });
    expect(saved.expenses[1]).toEqual(updated.expenses[1]);
    expect(saved.members).toEqual(updated.members);
  });
  it('同一笔账单的并发修改和删除必须核对，时间戳相同也不能覆盖', () => {
    const original = expense(fixture());
    const expectedExpenseSnapshot = expenseSnapshot(original.expenses[0]);
    const updated = applyCommand(original, 'a', { type: 'editExpense', expenseId: 'e1', expectedVersion: original.version, expectedExpenseSnapshot, expense: { ...base, amount: 71400 } }, original.expenses[0].updatedAt);
    for (const type of ['editExpense', 'deleteExpense'] as const) {
      expect(() => applyCommand(updated, 'a', { type, expenseId: 'e1', expectedVersion: updated.version, expectedExpenseSnapshot, expense: base })).toThrow('这笔账单已被修改');
    }
    const reviewed = applyCommand(updated, 'a', { type: 'editExpense', expenseId: 'e1', expectedVersion: updated.version, expectedExpenseSnapshot: expenseSnapshot(updated.expenses[0]), expense: { ...base, amount: 70000 } });
    expect(reviewed.expenses[0].amount).toBe(70000);
  });
  it('单笔快照不能绕过待确认转账和修改权限', () => {
    const original = expense(fixture());
    const expectedExpenseSnapshot = expenseSnapshot(original.expenses[0]);
    expect(() => applyCommand(original, 'b', { type: 'editExpense', expenseId: 'e1', expectedVersion: original.version, expectedExpenseSnapshot, expense: base })).toThrow('只有记录人');
    const pending = applyCommand(original, 'b', { type: 'recordTransfer', requestId: 'pending1', toId: 'a', amount: 20000 });
    expect(() => applyCommand(pending, 'a', { type: 'editExpense', expenseId: 'e1', expectedVersion: original.version, expectedExpenseSnapshot, expense: base })).toThrow('待确认转账');
  });
  it('软删除会重新计算，保留原记录', () => {
    const trip = expense(fixture());
    const next = applyCommand(trip, 'a', { type: 'deleteExpense', expenseId: 'e1', expectedVersion: trip.version });
    expect(next.expenses[0].deleted).toBe(true); expect(getBalances(next).every(b => b.balance === 0)).toBe(true);
    expect(trip.expenses[0].deleted).toBe(false);
  });
  it('中途加入不承担历史费用', () => {
    const trip = joinTrip(expense(fixture()), { id: 'd', name: '新朋友' });
    expect(getBalances(trip).find(b => b.memberId === 'd')?.share).toBe(0);
    expect(trip.expenses[0].shares).toEqual({ a: 20000, b: 20000, c: 20000 });
  });
  it('成员有未结余额不能退出', () => {
    expect(() => applyCommand(expense(fixture()), 'a', { type: 'deactivateMember', memberId: 'b' })).toThrow('尚未结清');
  });
  it('退出保留历史账目，不能再加入新账', () => {
    let trip = expense(fixture(), 'e1', { ...base, amount: 300, participantIds: ['b'], payerId: 'b' });
    trip = applyCommand(trip, 'a', { type: 'deactivateMember', memberId: 'b' });
    expect(trip.members.find(m => m.id === 'b')?.active).toBe(false);
    expect(getBalances(trip).find(b => b.memberId === 'b')?.paid).toBe(300);
    expect(() => expense(trip, 'e2', base)).toThrow('分摊成员');
    const edited = applyCommand(trip, 'a', { type: 'editExpense', expenseId: 'e1', expectedVersion: trip.version, expense: { ...trip.expenses[0], title: '补备注' } });
    expect(edited.expenses[0].title).toBe('补备注');
  });
  it('服务端拒绝非法金额、日期、分类和伪造成员', () => {
    for (const input of [{ ...base, amount: -1 }, { ...base, amount: 1.5 }, { ...base, date: '2026-02-30' }, { ...base, payerId: 'outsider' }, { ...base, participantIds: ['outsider'] }, { ...base, category: '伪造' }]) {
      expect(() => expense(fixture(), 'e1', input as ExpenseInput)).toThrow();
    }
  });
  it('退出后不能通过改历史账让成员重新欠款，备注仍可修改', () => {
    let trip = applyCommand(example(), 'c', { type: 'recordTransfer', requestId: 's1', toId: 'a', amount: 20000 });
    trip = applyCommand(trip, 'a', { type: 'confirmTransfer', settlementId: 's1' });
    trip = applyCommand(trip, 'a', { type: 'deactivateMember', memberId: 'c' });
    expect(() => applyCommand(trip, 'a', { type: 'deleteExpense', expenseId: 'e3', expectedVersion: trip.version })).toThrow('已退出成员');
    const bill = trip.expenses.find(e => e.id === 'e3')!;
    const next = applyCommand(trip, 'a', { type: 'editExpense', expenseId: 'e3', expectedVersion: trip.version, expense: { ...bill, note: '门票备注补充' } });
    expect(next.expenses.find(e => e.id === 'e3')?.note).toBe('门票备注补充');
  });
});
describe('结算', () => {
  it('标记转账不改变实际余额，但会预留建议金额', () => {
    const trip = applyCommand(example(), 'c', { type: 'recordTransfer', requestId: 's1', toId: 'a', amount: 12000 });
    expect(getBalances(trip).find(b => b.memberId === 'c')?.balance).toBe(-20000);
    expect(suggestTransfers(trip)).toEqual([{ fromId: 'c', toId: 'a', amount: 8000 }]);
    expect(() => applyCommand(trip, 'c', { type: 'recordTransfer', requestId: 's2', toId: 'a', amount: 9000 })).toThrow('金额已变化');
  });
  it('只有收款人能确认，确认后更新余额且不增加旅行消费', () => {
    let trip = applyCommand(example(), 'c', { type: 'recordTransfer', requestId: 's1', toId: 'a', amount: 20000 });
    expect(() => applyCommand(trip, 'c', { type: 'confirmTransfer', settlementId: 's1' })).toThrow('收款人');
    trip = applyCommand(trip, 'a', { type: 'confirmTransfer', settlementId: 's1' });
    expect(getBalances(trip).every(b => b.balance === 0)).toBe(true);
    expect(trip.expenses.reduce((sum, e) => sum + e.amount, 0)).toBe(110000);
    expect(applyCommand(trip, 'a', { type: 'confirmTransfer', settlementId: 's1' })).toBe(trip);
    expect(() => applyCommand(trip, 'c', { type: 'cancelTransfer', settlementId: 's1' })).toThrow('不能取消');
  });
  it('取消标记恢复建议，不发生钱款转移', () => {
    let trip = applyCommand(example(), 'c', { type: 'recordTransfer', requestId: 's1', toId: 'a', amount: 20000 });
    trip = applyCommand(trip, 'c', { type: 'cancelTransfer', settlementId: 's1' });
    expect(suggestTransfers(trip)).toEqual([{ fromId: 'c', toId: 'a', amount: 20000 }]);
  });
  it('待确认转账期间可新增消费，但不能修改历史消费', () => {
    const trip = applyCommand(example(), 'c', { type: 'recordTransfer', requestId: 's1', toId: 'a', amount: 20000 });
    expect(expense(trip, 'new').expenses).toHaveLength(4);
    expect(() => applyCommand(trip, 'a', { type: 'deleteExpense', expenseId: 'e1', expectedVersion: trip.version })).toThrow('待确认');
  });
  it('结清才能关闭，关闭后可由创建者重新打开', () => {
    expect(() => applyCommand(example(), 'a', { type: 'close' })).toThrow('未结清');
    let trip = applyCommand(example(), 'c', { type: 'recordTransfer', requestId: 's1', toId: 'a', amount: 20000 });
    expect(() => applyCommand(trip, 'a', { type: 'close' })).toThrow('待确认');
    trip = applyCommand(trip, 'a', { type: 'confirmTransfer', settlementId: 's1' });
    trip = applyCommand(trip, 'a', { type: 'close' });
    expect(() => expense(trip, 'new')).toThrow('关闭');
    expect(() => applyCommand(trip, 'b', { type: 'reopen' })).toThrow('创建者');
    trip = applyCommand(trip, 'a', { type: 'reopen' }); expect(trip.status).toBe('active');
  });
  it('确认结算后补记仍能正确重新计算', () => {
    let trip = applyCommand(example(), 'c', { type: 'recordTransfer', requestId: 's1', toId: 'a', amount: 20000 });
    trip = applyCommand(trip, 'a', { type: 'confirmTransfer', settlementId: 's1' });
    trip = expense(trip, 'new', { ...base, amount: 30000, payerId: 'b' }, 'b');
    expect(getBalances(trip).map(b => b.balance)).toEqual([-10000, 20000, -10000]);
  });
  it('大量费用结算后全员余额为零，且总余额始终为零', () => {
    let trip = fixture();
    const ids = ['a', 'b', 'c'];
    for (let i = 0; i < 100; i++) {
      const payerId = ids[i % 3], participants = i % 2 ? ids : ids.slice(0, 2);
      trip = expense(trip, `e${i}`, { ...base, amount: 997 + i * 37, payerId, participantIds: participants }, payerId);
      expect(getBalances(trip).reduce((sum, b) => sum + b.balance, 0)).toBe(0);
    }
    for (const [i, transfer] of suggestTransfers(trip).entries()) {
      trip = applyCommand(trip, transfer.fromId, { type: 'recordTransfer', requestId: `s${i}`, toId: transfer.toId, amount: transfer.amount });
      trip = applyCommand(trip, transfer.toId, { type: 'confirmTransfer', settlementId: `s${i}` });
    }
    expect(getBalances(trip).every(b => b.balance === 0)).toBe(true);
  });
});
