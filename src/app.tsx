import type { PropsWithChildren } from 'react';
import { LedgerProvider } from './store';
import './app.scss';

export default function App({ children }: PropsWithChildren) {
  return <LedgerProvider>{children}</LedgerProvider>;
}
