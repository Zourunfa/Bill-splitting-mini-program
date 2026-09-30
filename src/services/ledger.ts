import Taro from '@tarojs/taro';
import { applyCommand, createTrip, joinTrip, validId } from '../../shared/ledger';
import { DEMO_USERS, seedTrips } from '../../shared/demo';
import type { Command, Trip, TripInput, User } from '../../shared/types';

export const isDemo = process.env.TARO_ENV !== 'weapp' || !CLOUD_ENV;
const STORAGE_KEY = 'jiqian_demo_v1';
const USER_KEY = 'jiqian_demo_user_v1';
export function requestId(): string {
  return `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}
function localTrips(): Trip[] {
  const saved = Taro.getStorageSync(STORAGE_KEY);
  if (saved) return saved as Trip[];
  const trips = seedTrips(); Taro.setStorageSync(STORAGE_KEY, trips); return trips;
}
function localUser(): User {
  return Taro.getStorageSync(USER_KEY) || DEMO_USERS[0];
}
function writeTrip(trip: Trip) {
  const trips = localTrips();
  const index = trips.findIndex(t => t.id === trip.id);
  if (index < 0) trips.unshift(trip); else trips[index] = trip;
  Taro.setStorageSync(STORAGE_KEY, trips);
}
let cloudReady = false;
async function call<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  if (!cloudReady) { Taro.cloud.init({ env: CLOUD_ENV }); cloudReady = true; }
  const result = await Taro.cloud.callFunction({ name: 'ledger', data: { action, ...payload } });
  const response = result.result as { ok: boolean; data?: T; error?: string };
  if (!response?.ok) throw new Error(response?.error || '服务暂时不可用，请稍后重试');
  return response.data as T;
}
export const ledgerService = {
  async bootstrap(): Promise<{ user: User; trips: Trip[] }> {
    if (!isDemo) return call('bootstrap');
    const user = localUser();
    return { user, trips: localTrips().filter(t => t.members.some(m => m.id === user.id && m.active)) };
  },
  async create(input: TripInput, name: string, id: string): Promise<Trip> {
    if (!isDemo) return call('create', { input, name, requestId: id });
    const user = { ...localUser(), name };
    const existing = localTrips().find(t => t.id === id);
    if (existing) return existing;
    const trip = createTrip(input, user, id, requestId());
    writeTrip(trip); Taro.setStorageSync(USER_KEY, user); return trip;
  },
  async join(inviteCode: string, name: string): Promise<Trip> {
    if (!isDemo) return call('join', { inviteCode, name });
    const user = { ...localUser(), name };
    const original = localTrips().find(t => t.inviteCode === inviteCode);
    if (!original) throw new Error('邀请不存在，请检查邀请码');
    const trip = joinTrip(original, user); writeTrip(trip); Taro.setStorageSync(USER_KEY, user); return trip;
  },
  async command(tripId: string, command: Command): Promise<Trip> {
    if (!isDemo) return call('command', { tripId, command });
    const trip = localTrips().find(t => t.id === tripId);
    if (!trip) throw new Error('旅行不存在');
    const next = applyCommand(trip, localUser().id, command); writeTrip(next); return next;
  },
  async selectDemoUser(user: User): Promise<void> {
    if (!isDemo) throw new Error('切换成员仅限演示模式');
    Taro.setStorageSync(USER_KEY, user);
  },
  async addDemoMember(tripId: string, name: string): Promise<Trip> {
    if (!isDemo) throw new Error('请通过微信分享邀请朋友加入');
    const original = localTrips().find(t => t.id === tripId);
    if (!original) throw new Error('旅行不存在');
    if (original.creatorId !== localUser().id) throw new Error('演示成员由创建者添加');
    const trip = joinTrip(original, { id: validId(requestId()), name }); writeTrip(trip); return trip;
  },
  async resetDemo(): Promise<void> {
    if (!isDemo) throw new Error('当前不是演示模式');
    Taro.removeStorageSync(STORAGE_KEY); Taro.removeStorageSync(USER_KEY);
  }
};
