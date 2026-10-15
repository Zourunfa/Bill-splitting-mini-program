import Taro from '@tarojs/taro';
import { applyCommand, createTrip, joinTrip, validId } from '../../shared/ledger';
import { DEMO_USERS, seedTrips } from '../../shared/demo';
import type { Command, Trip, TripInput, User } from '../../shared/types';

// 按构建配置选择数据来源；页面与 store 不必关心数据在本机、CloudBase 还是 MySQL。
const API_BASE = (API_BASE_URL || '').replace(/\/$/, '');
const USE_JAVA_BACKEND = process.env.TARO_ENV === 'weapp' && Boolean(API_BASE);
export const isDemo = process.env.TARO_ENV !== 'weapp' || (!CLOUD_ENV && !API_BASE);
const STORAGE_KEY = 'jiqian_demo_v1';
const USER_KEY = 'jiqian_demo_user_v1';
const TOKEN_KEY = 'jiqian_api_token_v1';
export function requestId(): string {
  // 新建/转账命令带唯一编号，超时后重试同一编号可以让服务端识别为同一次操作。
  return `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}
function localTrips(): Trip[] {
  const saved = Taro.getStorageSync(STORAGE_KEY);
  if (saved) return saved as Trip[];
  // 第一次打开本地演示时才写入种子数据；之后以用户实际操作过的数据为准。
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
let loginInFlight: Promise<string> | undefined;

interface ApiEnvelope<T> { ok: boolean; data?: T; error?: string }

async function loginToApi(): Promise<string> {
  // 并行的 API 请求共用一次微信登录，避免同时重复换取服务端 token。
  if (!loginInFlight) {
    loginInFlight = (async () => {
      const login = await Taro.login();
      if (!login.code) throw new Error('微信登录失败，请重新进入小程序');
      const response = await Taro.request<ApiEnvelope<{ token: string }>>({
        url: `${API_BASE}/api/auth/login`, method: 'POST', data: { code: login.code }
      });
      const envelope = response.data;
      if (response.statusCode < 200 || response.statusCode >= 300 || !envelope?.ok || !envelope.data?.token) {
        throw new Error(envelope?.error || '登录服务暂时不可用，请稍后重试');
      }
      Taro.setStorageSync(TOKEN_KEY, envelope.data.token);
      return envelope.data.token;
    })().finally(() => { loginInFlight = undefined; });
  }
  return loginInFlight;
}

async function apiToken(): Promise<string> {
  const token = Taro.getStorageSync(TOKEN_KEY);
  return typeof token === 'string' && token ? token : loginToApi();
}

async function callApi<T>(path: string, method: 'GET' | 'POST', data?: unknown, retry = true): Promise<T> {
  const token = await apiToken();
  const response = await Taro.request<ApiEnvelope<T>>({
    url: `${API_BASE}${path}`, method, data,
    header: { Authorization: `Bearer ${token}` }
  });
  if (response.statusCode === 401 && retry) {
    // token 失效时重新登录并且只重试一次，避免鉴权故障造成无限请求。
    Taro.removeStorageSync(TOKEN_KEY);
    await loginToApi();
    return callApi<T>(path, method, data, false);
  }
  const envelope = response.data;
  if (response.statusCode < 200 || response.statusCode >= 300 || !envelope?.ok) {
    throw new Error(envelope?.error || '服务暂时不可用，请稍后重试');
  }
  return envelope.data as T;
}

async function call<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  if (USE_JAVA_BACKEND) {
    if (action === 'bootstrap') return callApi<T>('/api/bootstrap', 'GET');
    if (action === 'create') return callApi<T>('/api/trips', 'POST', payload);
    if (action === 'join') return callApi<T>('/api/trips/join', 'POST', payload);
    if (action === 'command') {
      const tripId = payload.tripId;
      if (typeof tripId !== 'string') throw new Error('旅行编号无效');
      return callApi<T>(`/api/trips/${encodeURIComponent(tripId)}/commands`, 'POST', payload.command);
    }
    throw new Error('不支持的请求');
  }
  if (!cloudReady) { Taro.cloud.init({ env: CLOUD_ENV }); cloudReady = true; }
  // CloudBase 模式的数据库访问统一经过 ledger 云函数。
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
