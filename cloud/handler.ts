import { createHash, randomBytes } from 'node:crypto';
import { applyCommand, assert, createTrip, joinTrip, text, validId } from '../shared/ledger';
import type { Command, Trip, TripInput, User } from '../shared/types';

interface Doc { get(): Promise<{ data: unknown }>; set(input: { data: unknown }): Promise<unknown> }
interface Query { get(): Promise<{ data: unknown[] }>; orderBy(field: string, order: 'desc'): Query; limit(count: number): Query }
interface Collection { doc(id: string): Doc; where(filter: Record<string, unknown>): Query }
export interface Database {
  collection(name: string): Collection;
  command: { all(values: string[]): unknown };
  runTransaction<T>(callback: (tx: { collection(name: string): Collection }) => Promise<T>): Promise<T>;
}
interface Dependencies { db: Database; getUserId(): string | undefined; now?: () => number; makeInvite?: () => string }
function clean<T>(value: unknown): T | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return undefined;
  const { _id, _openid, ...data } = raw as Record<string, unknown>;
  return data as T;
}
async function maybeGet<T>(doc: Doc): Promise<T | undefined> {
  try { return clean<T>((await doc.get()).data); }
  catch (error) {
    const message = typeof error === 'string' ? error : (error as { errMsg?: string }).errMsg || (error as Error).message || '';
    if (/document.*(?:not exist|does not exist|不存在)/i.test(message)) return undefined;
    throw error;
  }
}
function checkSize(trip: Trip) {
  assert(Buffer.byteLength(JSON.stringify(trip), 'utf8') <= 800_000, '账本已达第一版容量上限，请新建旅行账本');
}
export function createHandler({ db, getUserId, now = Date.now, makeInvite = () => randomBytes(16).toString('hex') }: Dependencies) {
  return async (event: Record<string, unknown>) => {
    try {
      const userId = getUserId();
      assert(userId, '请从微信小程序调用');
      assert(event && typeof event === 'object', '请求内容无效');
      const action = event.action;
      if (action === 'bootstrap') {
        const existing = await maybeGet<User>(db.collection('users').doc(userId));
        const user = existing || { id: userId, name: '旅友' };
        const result = await db.collection('trips').where({ memberIds: db.command.all([userId]) }).orderBy('createdAt', 'desc').limit(20).get();
        const trips = result.data.map(raw => clean<Trip>(raw)!).filter(trip => trip.members.some(m => m.id === userId && m.active));
        return { ok: true, data: { user, trips } };
      }
      if (action === 'create') {
        const id = `t_${createHash('sha256').update(`${userId}:${validId(event.requestId)}`).digest('hex').slice(0, 32)}`;
        const user = { id: userId, name: text(event.name, '昵称', 20) };
        assert(event.input && typeof event.input === 'object', '旅行信息无效');
        const inviteCode = makeInvite();
        const trip = await db.runTransaction(async tx => {
          const doc = tx.collection('trips').doc(id);
          const existing = await maybeGet<Trip>(doc);
          if (existing) { assert(existing.creatorId === userId, '请求编号已被使用'); return existing; }
          const trip = createTrip(event.input as TripInput, user, id, inviteCode, now());
          const inviteDoc = tx.collection('invites').doc(inviteCode);
          assert(!await maybeGet(inviteDoc), '邀请编号冲突，请重试');
          await doc.set({ data: trip });
          await inviteDoc.set({ data: { tripId: id, createdAt: now() } });
          await tx.collection('users').doc(userId).set({ data: user });
          return trip;
        });
        return { ok: true, data: trip };
      }
      if (action === 'join') {
        const code = validId(event.inviteCode);
        const user = { id: userId, name: text(event.name, '昵称', 20) };
        const trip = await db.runTransaction(async tx => {
          const invite = await maybeGet<{ tripId: string }>(tx.collection('invites').doc(code));
          assert(invite, '邀请不存在，请向朋友索取新的邀请');
          const doc = tx.collection('trips').doc(invite.tripId);
          const original = await maybeGet<Trip>(doc);
          assert(original, '邀请已失效');
          const next = joinTrip(original, user, now()); checkSize(next);
          if (next !== original) await doc.set({ data: next });
          await tx.collection('users').doc(userId).set({ data: user });
          return next;
        });
        return { ok: true, data: trip };
      }
      if (action === 'command') {
        const id = validId(event.tripId);
        assert(event.command && typeof event.command === 'object', '操作无效');
        const trip = await db.runTransaction(async tx => {
          const doc = tx.collection('trips').doc(id);
          const original = await maybeGet<Trip>(doc);
          assert(original, '旅行不存在或不可访问');
          const next = applyCommand(original, userId, event.command as Command, now()); checkSize(next);
          if (next !== original) await doc.set({ data: next });
          return next;
        });
        return { ok: true, data: trip };
      }
      throw new Error('不支持的请求');
    } catch (error) {
      // SDK 故障不给客户端返回内部环境或数据库信息。
      if ((error as { errCode?: unknown; code?: unknown }).errCode || (error as { code?: unknown }).code) {
        console.error('ledger SDK error', (error as { errCode?: unknown }).errCode || (error as { code?: unknown }).code);
        return { ok: false, error: '云服务请求失败，请检查环境配置或稍后重试' };
      }
      return { ok: false, error: error instanceof Error ? error.message : '操作失败，请稍后重试' };
    }
  };
}
