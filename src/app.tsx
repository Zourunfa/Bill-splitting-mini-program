import type { PropsWithChildren } from 'react';
import { LedgerProvider } from './store';
import './app.scss';

// 全局账本状态放在页面树最外层，因此任一页面都能使用 useLedger/useTrip。
export default function App({ children }: PropsWithChildren) {
  return <LedgerProvider>{children}</LedgerProvider>;
}
