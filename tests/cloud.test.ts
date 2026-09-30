import { describe, expect, it } from 'vitest';
import { createHandler, type Database } from '../cloud/handler';
import { getBalances } from '../shared/ledger';
import type { Trip } from '../shared/types';

function memoryDatabase() {
  let documents = new Map<string, Record<string, unknown>>();
  let queue = Promise.resolve();
  const collection = (name: string, map = documents) => ({
    doc: (id: string) => ({
      get: async () => {
        const value = map.get(`${name}/${id}`);
        // 模拟 wx-server-sdk 缺失文档错误，防止首次创建失败。
        if (!value) throw new Error(`document.get: document with _id ${id} does not exist`);
        return { data: { _id: id, ...structuredClone(value) } };
      },
      set: async ({ data }: { data: unknown }) => { map.set(`${name}/${id}`, structuredClone(data) as Record<string, unknown>); }
    }),
    where: (filter: Record<string, unknown>) => {
      let max = 100;
      const query = {
        orderBy: (_field: string, _order: 'desc') => query,
        limit: (count: number) => { max = count; return query; },
        get: async () => ({ data: [...map.entries()].filter(([key, value]) => key.startsWith(`${name}/`) && (filter.memberIds as string[]).every(id => (value.memberIds as string[]).includes(id))).map(([key, value]) => ({ _id: key.split('/')[1], ...structuredClone(value) })).slice(0, max) })
      };
      return query;
    }
  });
  const db: Database = {
    collection: name => collection(name),
    command: { all: values => values },
    runTransaction: <T>(callback: (tx: Pick<Database, 'collection'>) => Promise<T>) => {
      const result = queue.then(async () => {
        const snapshot = structuredClone(documents);
        const value = await callback({ collection: name => collection(name, snapshot) });
        documents = snapshot;
        return value;
      });
      queue = result.then(() => undefined, () => undefined);
      return result;
    }
  };
  return db;
}
function setup() {
  const db = memoryDatabase();
  let id: string | undefined = 'a';
  let count = 0;
  const handle = createHandler({ db, getUserId: () => id, now: () => 100, makeInvite: () => `invite_${++count}` });
  const as = (next?: string) => { id = next; };
  const create = () => handle({ action: 'create', requestId: 'create1', name: '小王', input: { name: '川西旅行', destination: '川西', startDate: '2026-10-01', endDate: '2026-10-07' } });
  return { handle, as, create };
}
describe('云函数接口', () => {
  it('新用户能首次打开、创建旅行，重复创建仍只有一个账本', async () => {
    const { handle, create } = setup();
    expect(await handle({ action: 'bootstrap' })).toMatchObject({ ok: true, data: { user: { id: 'a' }, trips: [] } });
    const first = await create(), second = await create();
    expect(first.ok).toBe(true); expect(first.data).toEqual(second.data);
    const bootstrap = await handle({ action: 'bootstrap' });
    expect(bootstrap).toMatchObject({ data: { trips: [{ creatorId: 'a' }] } });
    expect((bootstrap.data as { trips: Trip[] }).trips).toHaveLength(1);
  });
  it('无微信调用身份时拒绝请求，客户端不能伪造身份', async () => {
    const { handle, as } = setup(); as(undefined);
    expect(await handle({ action: 'bootstrap', userId: 'a' })).toMatchObject({ ok: false });
  });
  it('非成员列表中看不到旅行，也不能改账', async () => {
    const { handle, as, create } = setup(); const trip = (await create()).data as Trip;
    as('outsider');
    expect(await handle({ action: 'bootstrap' })).toMatchObject({ data: { trips: [] } });
    expect(await handle({ action: 'command', tripId: trip.id, actorId: 'a', command: { type: 'close' } })).toMatchObject({ ok: false });
  });
  it('凭邀请加入，重复加入不重复添加成员，历史费用不重新均分', async () => {
    const { handle, as, create } = setup(); let trip = (await create()).data as Trip;
    trip = (await handle({ action: 'command', tripId: trip.id, command: { type: 'addExpense', requestId: 'e1', expense: { title: '先到住宿', amount: 10000, payerId: 'a', participantIds: ['a'], category: '住宿', date: '2026-10-01', note: '' } } })).data as Trip;
    as('b');
    const joined = await handle({ action: 'join', inviteCode: trip.inviteCode, name: '小李' });
    expect(joined.ok).toBe(true); expect((joined.data as Trip).members).toHaveLength(2);
    expect(getBalances(joined.data as Trip).find(b => b.memberId === 'b')?.share).toBe(0);
    expect((await handle({ action: 'join', inviteCode: trip.inviteCode, name: '小李' })).data).toEqual(joined.data);
    expect(await handle({ action: 'join', inviteCode: 'invalid', name: '小李' })).toMatchObject({ ok: false });
  });
  it('旅行内改名只影响本人和本旅行，账单金额及分摊保持不变', async () => {
    const { handle, as, create } = setup(); const first = (await create()).data as Trip;
    const second = (await handle({ action: 'create', requestId: 'create2', name: '小王', input: { name: '下一站', destination: '成都', startDate: '2026-10-01', endDate: '2026-10-07' } })).data as Trip;
    as('b');
    await handle({ action: 'join', inviteCode: first.inviteCode, name: '旅友' });
    await handle({ action: 'join', inviteCode: second.inviteCode, name: '另一群的名字' });
    const before = (await handle({ action: 'command', tripId: first.id, command: { type: 'addExpense', requestId: 'e_name', expense: { title: '午饭', amount: 5000, payerId: 'b', participantIds: ['a', 'b'], category: '餐饮', date: '2026-10-01', note: '' } } })).data as Trip;
    const renamed = await handle({ action: 'command', tripId: first.id, actorId: 'a', command: { type: 'renameSelf', name: '  张同学  ', memberId: 'a' } });
    expect(renamed.ok).toBe(true);
    const after = renamed.data as Trip;
    expect(after.members.map(m => m.name)).toEqual(['小王', '张同学']);
    expect(after.expenses).toEqual(before.expenses);
    expect(getBalances(after)).toEqual(getBalances(before));
    const refreshed = (await handle({ action: 'bootstrap' })).data as { user: { name: string }; trips: Trip[] };
    expect(refreshed.trips.find(t => t.id === first.id)?.members.find(m => m.id === 'b')?.name).toBe('张同学');
    expect(refreshed.trips.find(t => t.id === second.id)?.members.find(m => m.id === 'b')?.name).toBe('另一群的名字');
    expect(refreshed.user.name).toBe('另一群的名字');
    for (const name of ['   ', '名'.repeat(21)]) {
      expect(await handle({ action: 'command', tripId: first.id, command: { type: 'renameSelf', name } })).toMatchObject({ ok: false });
    }
    as('outsider');
    expect(await handle({ action: 'command', tripId: first.id, actorId: 'b', command: { type: 'renameSelf', name: '冒名' } })).toMatchObject({ ok: false });
  });
  it('加入时必须填写名字，空白名字不会新增成员', async () => {
    const { handle, as, create } = setup(); const trip = (await create()).data as Trip;
    as('b');
    expect(await handle({ action: 'join', inviteCode: trip.inviteCode, name: '   ' })).toMatchObject({ ok: false });
    const joined = await handle({ action: 'join', inviteCode: trip.inviteCode, name: ' 张同学 ' });
    expect((joined.data as Trip).members.find(m => m.id === 'b')?.name).toBe('张同学');
  });
  it('事务内同时记账不会覆盖，重试也不会重复记账', async () => {
    const { handle, as, create } = setup(); const trip = (await create()).data as Trip;
    as('b'); await handle({ action: 'join', inviteCode: trip.inviteCode, name: '小李' });
    const calls = Array.from({ length: 20 }, (_, i) => {
      const payerId = i % 2 ? 'a' : 'b'; as(payerId);
      return handle({ action: 'command', tripId: trip.id, command: { type: 'addExpense', requestId: `e${i % 10}`, expense: { title: '沿途吃饭', amount: 1001, payerId, participantIds: ['a', 'b'], category: '餐饮', date: '2026-10-01', note: '' } } });
    });
    const results = await Promise.all(calls); expect(results.every(r => r.ok)).toBe(true);
    const refreshed = (await handle({ action: 'bootstrap' })).data as { trips: Trip[] };
    expect(refreshed.trips[0].expenses).toHaveLength(10);
    expect(getBalances(refreshed.trips[0]).reduce((sum, b) => sum + b.balance, 0)).toBe(0);
  });
  it('服务端重新计算分摊，忽略客户端注入的 shares', async () => {
    const { handle, as, create } = setup(); const trip = (await create()).data as Trip;
    as('b'); await handle({ action: 'join', inviteCode: trip.inviteCode, name: '小李' }); as('a');
    const result = await handle({ action: 'command', tripId: trip.id, command: { type: 'addExpense', requestId: 'e1', expense: { title: '住宿', amount: 1001, payerId: 'a', participantIds: ['b', 'a'], category: '住宿', date: '2026-10-01', note: '', shares: { a: 0, b: 1001 }, creatorId: 'b' } } });
    const expense = (result.data as Trip).expenses[0];
    expect(expense.shares).toEqual({ a: 501, b: 500 }); expect(expense.creatorId).toBe('a');
  });
  it('无效操作会回滚，账本保持原样', async () => {
    const { handle, create } = setup(); const trip = (await create()).data as Trip;
    expect(await handle({ action: 'command', tripId: trip.id, command: { type: 'addExpense', requestId: 'e1', expense: { amount: -1 } } })).toMatchObject({ ok: false });
    expect((await handle({ action: 'bootstrap' })).data).toMatchObject({ trips: [{ expenses: [], version: 1 }] });
  });
});
