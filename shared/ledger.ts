import { CATEGORIES, type Balance, type Command, type Expense, type ExpenseInput, type Member, type Transfer, type Trip, type TripInput, type User } from './types';

const COLORS = ['#456c57', '#b77d49', '#7c79a7', '#5e859f', '#ad7377', '#78916b'];
export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
export function text(value: unknown, label: string, max = 60): string {
  assert(typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max, `${label}需填写 1～${max} 个字`);
  return value.trim();
}
export function validDate(value: unknown): string {
  assert(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), '请选择有效日期');
  const parsed = new Date(`${value}T00:00:00Z`);
  assert(!Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value, '日期不存在');
  return value;
}
export function validAmount(value: unknown): number {
  assert(typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 100_000_000, '金额需大于零，且不超过 100 万元');
  return value;
}
export function parseAmount(value: string): number {
  assert(/^\d{1,7}(\.\d{1,2})?$/.test(value.trim()), '请输入金额，最多两位小数');
  const [yuan, cents = ''] = value.trim().split('.');
  return validAmount(Number(yuan) * 100 + Number(cents.padEnd(2, '0')));
}
export function money(cents: number): string { return (cents / 100).toFixed(2); }
// 固定字段顺序，兼容没有单笔版本号的已有账单；昵称和其他账单不参与冲突判断。
export function expenseSnapshot(expense: Expense): string {
  return JSON.stringify([expense.id, expense.title, expense.amount, expense.payerId,
    [...expense.participantIds].sort(), expense.category, expense.date, expense.note,
    expense.updatedAt, expense.deleted]);
}
export const EXPENSE_CONFLICT = '这笔账单已被修改，请核对最新内容后再保存';
export function validId(value: unknown): string {
  assert(typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value), '请求编号无效，请刷新后重试');
  return value;
}
export function equalShares(amount: number, ids: string[]): Record<string, number> {
  validAmount(amount);
  assert(ids.length > 0 && new Set(ids).size === ids.length, '请至少选择一位分摊成员，且不能重复');
  const sorted = [...ids].sort();
  const base = Math.floor(amount / sorted.length), remainder = amount % sorted.length;
  return Object.fromEntries(sorted.map((id, index) => [id, base + (index < remainder ? 1 : 0)]));
}
export function makeMember(id: string, name: string, index: number): Member {
  return { id, name: text(name, '昵称', 20), color: COLORS[index % COLORS.length], active: true };
}
export function createTrip(input: TripInput, user: User, id: string, inviteCode: string, now = Date.now()): Trip {
  const startDate = validDate(input.startDate), endDate = validDate(input.endDate);
  assert(endDate >= startDate, '结束日期不能早于开始日期');
  return {
    id: validId(id), name: text(input.name, '旅行名称', 30), destination: text(input.destination, '目的地', 30),
    startDate, endDate, creatorId: user.id, inviteCode, status: 'active',
    members: [makeMember(user.id, user.name, 0)], memberIds: [user.id],
    expenses: [], settlements: [], audit: [], createdAt: now, version: 1
  };
}
export function getBalances(trip: Trip, includePending = false): Balance[] {
  const result = new Map(trip.members.map(m => [m.id, { memberId: m.id, paid: 0, share: 0, received: 0, sent: 0, balance: 0 }]));
  for (const e of trip.expenses) {
    if (e.deleted) continue;
    const payer = result.get(e.payerId);
    if (payer) payer.paid += e.amount;
    for (const [id, value] of Object.entries(e.shares)) {
      const member = result.get(id);
      if (member) member.share += value;
    }
  }
  for (const s of trip.settlements) {
    if (s.status !== 'confirmed' && !(includePending && s.status === 'pending')) continue;
    const from = result.get(s.fromId), to = result.get(s.toId);
    if (from) from.sent += s.amount;
    if (to) to.received += s.amount;
  }
  for (const b of result.values()) b.balance = b.paid - b.share + b.sent - b.received;
  return [...result.values()];
}
export function suggestTransfers(trip: Trip): Transfer[] {
  const balances = getBalances(trip, true);
  const debtors = balances.filter(b => b.balance < 0).map(b => ({ id: b.memberId, amount: -b.balance })).sort((a, b) => b.amount - a.amount || a.id.localeCompare(b.id));
  const creditors = balances.filter(b => b.balance > 0).map(b => ({ id: b.memberId, amount: b.balance })).sort((a, b) => b.amount - a.amount || a.id.localeCompare(b.id));
  const transfers: Transfer[] = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const amount = Math.min(debtors[i].amount, creditors[j].amount);
    transfers.push({ fromId: debtors[i].id, toId: creditors[j].id, amount });
    debtors[i].amount -= amount; creditors[j].amount -= amount;
    if (!debtors[i].amount) i++;
    if (!creditors[j].amount) j++;
  }
  return transfers;
}
function expenseInput(input: ExpenseInput, trip: Trip, previous?: ExpenseInput): ExpenseInput {
  assert(input && typeof input === 'object', '账单内容无效');
  const active = new Set(trip.members.filter(m => m.active).map(m => m.id));
  assert(active.has(input.payerId) || previous?.payerId === input.payerId, '付款人必须是当前旅行成员');
  assert(Array.isArray(input.participantIds) && input.participantIds.length > 0 && input.participantIds.every(id => active.has(id) || previous?.participantIds.includes(id)), '请选择有效分摊成员');
  assert(new Set(input.participantIds).size === input.participantIds.length, '分摊成员不能重复');
  assert(CATEGORIES.includes(input.category), '费用分类无效');
  assert(typeof input.note === 'string' && input.note.length <= 200, '备注不能超过 200 字');
  return {
    title: text(input.title, '用途', 60), amount: validAmount(input.amount), payerId: input.payerId,
    participantIds: [...input.participantIds], category: input.category, date: validDate(input.date), note: input.note.trim()
  };
}
function requireMember(trip: Trip, actor: string) {
  assert(trip.members.some(m => m.id === actor && m.active), '你不是这次旅行的有效成员');
}
function audit(trip: Trip, actor: string, action: string, targetId: string, now: number) {
  trip.version++;
  trip.audit.push({ actorId: actor, action, targetId, at: now });
  // 小规模旅行使用单文档事务，保留最近 200 条操作记录。
  trip.audit = trip.audit.slice(-200);
}
export function joinTrip(original: Trip, user: User, now = Date.now()): Trip {
  assert(original.status === 'active', '这次旅行已关闭');
  if (original.members.some(m => m.id === user.id)) {
    requireMember(original, user.id);
    return original;
  }
  assert(original.members.length < 30, '第一版每次旅行最多支持 30 人');
  const trip: Trip = JSON.parse(JSON.stringify(original));
  trip.members.push(makeMember(user.id, user.name, trip.members.length));
  trip.memberIds.push(user.id);
  audit(trip, user.id, '加入旅行', user.id, now);
  return trip;
}
export function applyCommand(original: Trip, actor: string, command: Command, now = Date.now()): Trip {
  assert(command && typeof command === 'object', '操作无效');
  requireMember(original, actor);
  const trip: Trip = JSON.parse(JSON.stringify(original));
  const owner = trip.creatorId === actor;
  // 重试已提交的新增操作时，即使账本已关闭也返回原结果。
  if (command.type === 'addExpense') {
    validId(command.requestId);
    const existing = trip.expenses.find(e => e.id === command.requestId);
    if (existing) { assert(existing.creatorId === actor, '请求编号已被使用'); return original; }
  }
  if (command.type === 'recordTransfer') {
    validId(command.requestId);
    const existing = trip.settlements.find(s => s.id === command.requestId);
    if (existing) { assert(existing.fromId === actor, '请求编号已被使用'); return original; }
  }
  if (command.type === 'reopen') {
    assert(owner, '只有创建者可以重新打开账本');
    if (trip.status === 'active') return original;
    trip.status = 'active'; audit(trip, actor, '重新打开账本', trip.id, now); return trip;
  }
  assert(trip.status === 'active', '账本已关闭，请先由创建者重新打开');
  switch (command.type) {
    case 'addExpense': {
      assert(trip.expenses.length < 500, '第一版每次旅行最多保存 500 笔账单');
      const input = expenseInput(command.expense, trip);
      trip.expenses.push({ ...input, id: command.requestId, creatorId: actor, shares: equalShares(input.amount, input.participantIds), createdAt: now, updatedAt: now, deleted: false });
      audit(trip, actor, '新增账单', command.requestId, now); break;
    }
    case 'editExpense':
    case 'deleteExpense': {
      assert(!trip.settlements.some(s => s.status === 'pending'), '有待确认转账，请确认或取消后再修改消费');
      const expense = trip.expenses.find(e => e.id === command.expenseId && !e.deleted);
      assert(expense, '账单不存在或已删除');
      assert(owner || expense.creatorId === actor, '只有记录人或旅行创建者可以修改账单');
      if (command.expectedExpenseSnapshot !== undefined) {
        assert(typeof command.expectedExpenseSnapshot === 'string' && command.expectedExpenseSnapshot === expenseSnapshot(expense), EXPENSE_CONFLICT);
      } else {
        // 兼容仍在运行的旧体验版。
        assert(command.expectedVersion === trip.version, '账本已更新，请刷新后重新操作');
      }
      if (command.type === 'deleteExpense') expense.deleted = true;
      else { const input = expenseInput(command.expense, trip, expense); Object.assign(expense, input, { shares: equalShares(input.amount, input.participantIds) }); }
      expense.updatedAt = now;
      audit(trip, actor, command.type === 'deleteExpense' ? '删除账单' : '修改账单', expense.id, now); break;
    }
    case 'recordTransfer': {
      const amount = validAmount(command.amount);
      assert(command.toId !== actor && trip.members.some(m => m.id === command.toId), '请选择其他收款成员');
      const balances = getBalances(trip, true);
      const from = balances.find(b => b.memberId === actor)!, to = balances.find(b => b.memberId === command.toId)!;
      assert(from.balance < 0 && to.balance > 0 && amount <= Math.min(-from.balance, to.balance), '待结金额已变化，请刷新结算建议');
      assert(trip.settlements.length < 500, '转账记录已达第一版上限');
      trip.settlements.push({ id: command.requestId, fromId: actor, toId: command.toId, amount, status: 'pending', createdAt: now });
      audit(trip, actor, '标记已转账', command.requestId, now); break;
    }
    case 'confirmTransfer':
    case 'cancelTransfer': {
      const settlement = trip.settlements.find(s => s.id === command.settlementId);
      assert(settlement, '转账记录不存在');
      if (command.type === 'confirmTransfer') {
        assert(settlement.toId === actor, '只有收款人可以确认到账');
        if (settlement.status === 'confirmed') return original;
        assert(settlement.status === 'pending', '这笔转账已取消');
        settlement.status = 'confirmed'; settlement.confirmedAt = now;
      } else {
        assert(settlement.fromId === actor || settlement.toId === actor, '只有转账双方可以取消');
        if (settlement.status === 'cancelled') return original;
        assert(settlement.status === 'pending', '已确认到账的转账不能取消');
        settlement.status = 'cancelled';
      }
      audit(trip, actor, command.type === 'confirmTransfer' ? '确认到账' : '取消转账标记', settlement.id, now); break;
    }
    case 'close':
      assert(owner, '只有创建者可以关闭账本');
      assert(!trip.settlements.some(s => s.status === 'pending') && getBalances(trip).every(b => b.balance === 0), '还有未结清的金额或待确认转账');
      trip.status = 'closed'; audit(trip, actor, '关闭账本', trip.id, now); break;
    case 'deactivateMember': {
      assert(owner, '只有创建者可以移除成员');
      assert(command.memberId !== trip.creatorId, '创建者不能被移除');
      const member = trip.members.find(m => m.id === command.memberId);
      assert(member?.active, '成员不存在或已退出');
      assert(getBalances(trip).find(b => b.memberId === member.id)?.balance === 0, '该成员尚未结清，不能移除');
      assert(!trip.settlements.some(s => s.status === 'pending' && (s.fromId === member.id || s.toId === member.id)), '该成员还有待确认转账');
      member.active = false; trip.memberIds = trip.memberIds.filter(id => id !== member.id);
      audit(trip, actor, '移除成员', member.id, now); break;
    }
    case 'renameSelf':
      trip.members.find(m => m.id === actor)!.name = text(command.name, '昵称', 20);
      audit(trip, actor, '修改昵称', actor, now); break;
    default: throw new Error('不支持的操作');
  }
  const inactive = new Set(trip.members.filter(m => !m.active).map(m => m.id));
  assert(getBalances(trip).every(b => !inactive.has(b.memberId) || b.balance === 0), '历史账单涉及已退出成员，不能改变其已结清金额');
  return trip;
}
