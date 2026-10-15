import { useShareAppMessage } from '@tarojs/taro';
import type { Trip } from '../shared/types';
import { isDemo } from './services/ledger';

// 分享旅行时附带邀请码；本地演示数据不跨设备共享，所以只分享旅行列表入口。
export function useTripShare(trip?: Trip) {
  const inviteCode = isDemo ? '' : trip?.inviteCode;
  useShareAppMessage(() => ({
    title: inviteCode && trip ? `一起去 · ${trip.name}，邀请你一起记账` : '一起去 · 旅行AA账本',
    path: inviteCode
      ? `/pages/trips/index?invite=${encodeURIComponent(inviteCode)}`
      : '/pages/trips/index'
  }));
}

export function useAppShare() {
  useShareAppMessage(() => ({
    title: '一起去 · 旅行AA账本，好好玩，账我来算。',
    path: '/pages/trips/index'
  }));
}
