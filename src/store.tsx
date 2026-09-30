import { createContext, useCallback, useContext, useEffect, useRef, useState, type PropsWithChildren } from 'react';
import Taro, { useDidHide, useDidShow, useRouter } from '@tarojs/taro';
import { isDemo, ledgerService } from './services/ledger';
import type { Command, Trip, TripInput, User } from '../shared/types';

interface LedgerStore {
  trips: Trip[]; user: User; loading: boolean; error: string;
  reload: () => Promise<void>;
  create: (input: TripInput, name: string, id: string) => Promise<Trip>;
  join: (code: string, name: string) => Promise<Trip>;
  run: (tripId: string, command: Command) => Promise<Trip>;
  switchUser: (user: User) => Promise<void>;
  addDemoMember: (tripId: string, name: string) => Promise<void>;
  resetDemo: () => Promise<void>;
}
const Context = createContext<LedgerStore | null>(null);
export function LedgerProvider({ children }: PropsWithChildren) {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [user, setUser] = useState<User>({ id: '', name: '旅友' });
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  const generation = useRef(0);
  const reload = useCallback(async () => {
    const version = ++generation.current;
    try {
      const data = await ledgerService.bootstrap();
      if (version !== generation.current) return;
      setTrips(prev => data.trips.map(next => {
        const cached = prev.find(t => t.id === next.id);
        return cached && cached.version > next.version ? cached : next;
      })); setUser(data.user); setError('');
    } catch (e) { if (version === generation.current) setError(errorMessage(e)); }
    finally { if (version === generation.current) setLoading(false); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  const replace = (trip: Trip) => {
    generation.current++; // 丢弃先前发出的旧读取结果。
    setTrips(prev => {
      if (prev.some(t => t.id === trip.id && t.version > trip.version)) return prev;
      return [trip, ...prev.filter(t => t.id !== trip.id)].sort((a, b) => b.createdAt - a.createdAt);
    });
    setError('');
  };
  const store: LedgerStore = {
    trips, user, loading, error, reload,
    create: async (input, name, id) => { const trip = await ledgerService.create(input, name, id); replace(trip); setUser(prev => ({ ...prev, name })); return trip; },
    join: async (code, name) => { const trip = await ledgerService.join(code, name); replace(trip); setUser(prev => ({ ...prev, name })); return trip; },
    run: async (tripId, command) => { const trip = await ledgerService.command(tripId, command); replace(trip); return trip; },
    switchUser: async (next) => { await ledgerService.selectDemoUser(next); await reload(); },
    addDemoMember: async (tripId, name) => { const trip = await ledgerService.addDemoMember(tripId, name); replace(trip); },
    resetDemo: async () => { await ledgerService.resetDemo(); await reload(); }
  };
  return <Context.Provider value={store}>{children}</Context.Provider>;
}
export function useLedger() {
  const store = useContext(Context);
  if (!store) throw new Error('账本未初始化');
  return store;
}
export function useTrip() {
  const store = useLedger();
  const router = useRouter();
  const tripId = router.params.tripId || '';
  const timer = useRef<ReturnType<typeof setInterval>>();
  const stop = () => { if (timer.current) clearInterval(timer.current); timer.current = undefined; };
  useDidShow(() => {
    stop();
    if (!isDemo) { void store.reload(); timer.current = setInterval(() => void store.reload(), 15_000); }
  });
  useDidHide(stop);
  useEffect(() => stop, []);
  return { ...store, trip: store.trips.find(t => t.id === tripId), tripId };
}
export function errorMessage(e: unknown) { return e instanceof Error ? e.message : '操作失败，请稍后重试'; }
export function notifyError(e: unknown) { void Taro.showToast({ title: errorMessage(e), icon: 'none', duration: 3000 }); }
export function go(page: string, tripId?: string, extra = '') {
  void Taro.navigateTo({ url: `/pages/${page}/index${tripId ? `?tripId=${encodeURIComponent(tripId)}${extra}` : ''}` });
}
export { isDemo };
