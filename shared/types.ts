export const CATEGORIES = ['餐饮', '住宿', '交通', '门票', '其他'] as const;
export type Category = typeof CATEGORIES[number];

export interface Member { id: string; name: string; color: string; active: boolean }
export interface ExpenseInput {
  title: string;
  amount: number;
  payerId: string;
  participantIds: string[];
  category: Category;
  date: string;
  note: string;
}
export interface Expense extends ExpenseInput {
  id: string;
  creatorId: string;
  shares: Record<string, number>;
  createdAt: number;
  updatedAt: number;
  deleted: boolean;
}
export interface Settlement {
  id: string;
  fromId: string;
  toId: string;
  amount: number;
  status: 'pending' | 'confirmed' | 'cancelled';
  createdAt: number;
  confirmedAt?: number;
}
export interface AuditEntry { actorId: string; action: string; targetId: string; at: number }
export interface Trip {
  id: string;
  name: string;
  destination: string;
  startDate: string;
  endDate: string;
  creatorId: string;
  status: 'active' | 'closed';
  members: Member[];
  memberIds: string[];
  expenses: Expense[];
  settlements: Settlement[];
  audit: AuditEntry[];
  inviteCode: string;
  createdAt: number;
  version: number;
}
export interface TripInput { name: string; destination: string; startDate: string; endDate: string }
export interface User { id: string; name: string }
export interface Balance { memberId: string; paid: number; share: number; received: number; sent: number; balance: number }
export interface Transfer { fromId: string; toId: string; amount: number }

export type Command =
  | { type: 'addExpense'; requestId: string; expense: ExpenseInput }
  | { type: 'editExpense'; expenseId: string; expense: ExpenseInput; expectedVersion: number; expectedExpenseSnapshot?: string }
  | { type: 'deleteExpense'; expenseId: string; expectedVersion: number; expectedExpenseSnapshot?: string }
  | { type: 'recordTransfer'; requestId: string; toId: string; amount: number }
  | { type: 'confirmTransfer'; settlementId: string }
  | { type: 'cancelTransfer'; settlementId: string }
  | { type: 'close' }
  | { type: 'reopen' }
  | { type: 'deactivateMember'; memberId: string }
  | { type: 'renameSelf'; name: string };
