import { Button, Input, Picker, Text, Textarea, View } from '@tarojs/components';
import Taro, { useRouter } from '@tarojs/taro';
import { useEffect, useRef, useState } from 'react';
import { Avatar, Empty, Page, SectionTitle, TripMissing, confirm } from '../../components/ui';
import { errorMessage, notifyError, useTrip } from '../../store';
import { requestId } from '../../services/ledger';
import { equalShares, expenseSnapshot, money, parseAmount } from '../../../shared/ledger';
import { CATEGORIES, type Category } from '../../../shared/types';

interface ExpenseForm { amount: string; title: string; payerId: string; participantIds: string[]; category: Category; date: string; note: string; requestId: string; expectedVersion: number; expectedExpenseSnapshot?: string }
export default function ExpensePage() {
  const { trip, tripId, user, run, reload } = useTrip();
  const router = useRouter();
  const expenseId = router.params.expenseId;
  const expense = trip?.expenses.find(e => e.id === expenseId && !e.deleted);
  const [form, setForm] = useState<ExpenseForm | null>(null), [busy, setBusy] = useState(false);
  const initialized = useRef(''), saving = useRef(false);
  const [saveError, setSaveError] = useState('');
  const formKey = `${tripId}_${user.id}_${expenseId || 'new'}`;
  const canEdit = trip?.status === 'active' && (!expense || expense.creatorId === user.id || trip.creatorId === user.id);
  useEffect(() => {
    if (!trip || !user.id || initialized.current === formKey) return;
    initialized.current = formKey;
    setForm({
      amount: expense ? money(expense.amount) : '', title: expense?.title || '',
      payerId: expense?.payerId || user.id,
      participantIds: expense?.participantIds || trip.members.filter(m => m.active).map(m => m.id),
      category: expense?.category || '餐饮', date: expense?.date || localToday(), note: expense?.note || '',
      requestId: requestId(), expectedVersion: trip.version, expectedExpenseSnapshot: expense ? expenseSnapshot(expense) : undefined
    });
  }, [trip, user.id, expense, formKey]);
  if (!trip) return <TripMissing />;
  if (expenseId && !expense) return <Page><Empty title='这笔账单已删除或不存在' /><Button className='button-secondary' onClick={() => void Taro.redirectTo({ url: `/pages/bills/index?tripId=${trip.id}` })}>回到账单</Button></Page>;
  if (!form) return <Page><Empty title='正在准备记账…' /></Page>;
  const patch = (next: Partial<ExpenseForm>) => setForm(prev => prev ? { ...prev, ...next } : prev);
  const activeMembers = trip.members.filter(m => m.active || m.id === form.payerId || form.participantIds.includes(m.id));
  let shares: Record<string, number> = {};
  try { shares = equalShares(parseAmount(form.amount), form.participantIds); } catch { /* 输入过程中允许金额尚未完整。 */ }
  const pending = trip.settlements.some(s => s.status === 'pending');
  const conflict = !!expense && (form.expectedExpenseSnapshot
    ? form.expectedExpenseSnapshot !== expenseSnapshot(expense)
    : form.expectedVersion !== trip.version);
  async function reviewLatest() {
    if (!expense || !trip || !form || saving.current) return;
    const latest = expense;
    const names = (ids: string[]) => ids.map(id => trip.members.find(m => m.id === id)?.name || id).join('、');
    const summary = (value: { title: string; amount: string; category: string; date: string; payerId: string; participantIds: string[]; note: string }) =>
      `${value.title} · ¥${value.amount}\n${value.category} · ${value.date}\n${names([value.payerId])}垫付；${names(value.participantIds)}分摊\n备注：${value.note || '无'}`;
    const result = await Taro.showModal({ title: '核对这笔账单', content: `最新已保存：\n${summary({ ...latest, amount: money(latest.amount) })}\n\n你的未保存修改：\n${summary(form)}\n\n保留修改后，仍需点击“保存修改”才会更新账单。`, confirmText: '保留修改', cancelText: '继续核对', confirmColor: '#456c57' });
    if (result.confirm) { patch({ expectedVersion: trip.version, expectedExpenseSnapshot: expenseSnapshot(latest) }); setSaveError(''); }
  }

  async function submit() {
    if (!form || !trip || saving.current || conflict) return;
    saving.current = true; setBusy(true); setSaveError('');
    let committed = false;
    try {
      const input = { title: form.title, amount: parseAmount(form.amount), payerId: form.payerId, participantIds: form.participantIds, category: form.category, date: form.date, note: form.note };
      await run(trip.id, expenseId ? { type: 'editExpense', expenseId, expense: input, expectedVersion: form.expectedVersion, expectedExpenseSnapshot: form.expectedExpenseSnapshot } : { type: 'addExpense', requestId: form.requestId, expense: input });
      committed = true;
      await Taro.redirectTo({ url: `/pages/bills/index?tripId=${trip.id}&saved=1` });
    } catch (e) {
      const message = errorMessage(e);
      setSaveError(committed ? '账单已保存，但页面未能自动返回，请点击“返回账单”查看。' : `${/已被修改|账本已更新/.test(message) ? '未保存' : '保存未确认'}：${message}。请核对账单后重试，离开页面将丢弃未提交的内容。`);
      notifyError(e); await reload();
    } finally { saving.current = false; setBusy(false); }
  }
  async function remove() {
    if (!trip || !expenseId || !expense || saving.current || conflict) return;
    const reviewedSnapshot = expenseSnapshot(expense);
    if (!await confirm('删除这笔账单？', '删除后会重新计算所有成员的余额，操作记录会保留。')) return;
    saving.current = true; setBusy(true); setSaveError('');
    let committed = false;
    try {
      await run(trip.id, { type: 'deleteExpense', expenseId, expectedVersion: trip.version, expectedExpenseSnapshot: reviewedSnapshot });
      committed = true;
      await Taro.redirectTo({ url: `/pages/bills/index?tripId=${trip.id}` });
    } catch (e) {
      const message = errorMessage(e);
      setSaveError(committed ? '账单已保存，但页面未能自动返回，请点击“返回账单”查看。' : `${/已被修改|账本已更新/.test(message) ? '未保存' : '保存未确认'}：${message}。请核对账单后重试，离开页面将丢弃未提交的内容。`);
      notifyError(e); await reload();
    } finally { saving.current = false; setBusy(false); }
  }
  return <Page><View className='page-heading'><Text className='eyebrow'>{trip.name}</Text><Text className='page-title'>{expense ? canEdit ? '这一笔，记清楚' : '这一笔的来处' : '旅途里的新一笔'}</Text><Text className='muted'>{canEdit ? '选好谁垫付、谁分摊，剩下的交给我。' : '共享账单 · 记录人或创建者可以修改'}</Text></View>
    <View className='amount-entry'><Text className='field-label'>花了多少钱</Text><View className='amount-input-row'><Text>¥</Text><Input type='digit' value={form.amount} disabled={!canEdit || busy} placeholder='0.00' maxlength={10} onInput={e => patch({ amount: e.detail.value })} /></View><Text className='small muted'>人民币 · 精确到分</Text></View>
    <View className='card form-card'>
      <View className='form-field'><Text className='field-label'>干什么的开销</Text><Input className='field-input' value={form.title} disabled={!canEdit || busy} maxlength={60} placeholder='比如：康定住宿、午饭、加油' onInput={e => patch({ title: e.detail.value })} /></View>
      <View className='form-field'><Text className='field-label'>分类</Text><View className='chips'>{CATEGORIES.map(c => <Text className={`chip ${form.category === c ? 'selected' : ''}`} key={c} onClick={() => canEdit && !busy && patch({ category: c })}>{c}</Text>)}</View></View>
      <View className='form-field'><Text className='field-label'>谁垫付的</Text><Picker disabled={!canEdit || busy} mode='selector' range={activeMembers.map(m => m.name)} value={Math.max(0, activeMembers.findIndex(m => m.id === form.payerId))} onChange={e => patch({ payerId: activeMembers[Number(e.detail.value)].id })}><View className='picker-member field-input'><Avatar member={trip.members.find(m => m.id === form.payerId)} small /><Text>{trip.members.find(m => m.id === form.payerId)?.name}</Text><Text className='muted'>▾</Text></View></Picker></View>
      <View className='form-field'><Text className='field-label'>消费日期</Text><Picker disabled={!canEdit || busy} mode='date' value={form.date} onChange={e => patch({ date: e.detail.value })}><View className='field-input picker-value'>{form.date} <Text className='muted'>▾</Text></View></Picker></View>
    </View>
    <SectionTitle title='哪些人一起分摊' subtitle='没参加的旅伴，这笔就不用分' action={canEdit ? '选全员' : undefined} onAction={() => !busy && patch({ participantIds: trip.members.filter(m => m.active).map(m => m.id) })} />
    <View className='card participant-card'>{activeMembers.map(member => {
      const selected = form.participantIds.includes(member.id);
      return <View key={member.id} className={`participant-row ${selected ? 'checked' : ''}`} onClick={() => {
        if (!canEdit || busy) return;
        patch({ participantIds: selected ? form.participantIds.filter(id => id !== member.id) : [...form.participantIds, member.id] });
      }}><View className={`checkbox ${selected ? 'checked' : ''}`}>{selected ? '✓' : ''}</View><Avatar member={member} small /><Text className='participant-name'>{member.name}{!member.active ? '（已退出）' : ''}</Text><Text className='small muted'>{selected ? Object.keys(shares).length ? `¥${money(shares[member.id] || 0)}` : '参与分摊' : '不参与'}</Text></View>;
    })}<View className='split-note'>{form.participantIds.length} 人均分 · 尾差按固定成员顺序分配</View></View>
    <View className='card form-card'><Text className='field-label'>备注 <Text className='muted small'>选填</Text></Text><Textarea className='note-input' value={form.note} disabled={!canEdit || busy} maxlength={200} placeholder='留下这笔开销的小细节…' onInput={e => patch({ note: e.detail.value })} /></View>
    {expense && <View className='expense-metadata'><Text>记录人：{trip.members.find(m => m.id === expense.creatorId)?.name}</Text><Text>记录于 {new Date(expense.createdAt).toLocaleString('zh-CN')}</Text></View>}
    {pending && expense && <View className='notice' onClick={() => void Taro.redirectTo({ url: `/pages/settlement/index?tripId=${trip.id}` })}>有待确认转账，确认或取消后即可修改历史账单 →</View>}
    {canEdit && conflict && <View className='notice'>这笔账单有更新，你的修改尚未保存。<Button className='button-inline' disabled={busy} onClick={() => void reviewLatest()}>核对最新账单</Button></View>}
    {saveError && <View className='error-banner'>{saveError}</View>}
    {canEdit && <><Text className='save-hint'>提交后大家才会看到 · 离开页面不保留未提交内容</Text><Button className='button-primary' loading={busy} disabled={busy || conflict || (!!expense && pending)} onClick={() => void submit()}>{expense ? '保存修改' : '保存这笔开销'}</Button>{expense && <Button className='button-danger' disabled={busy || pending || conflict} onClick={() => void remove()}>删除账单</Button>}</>}
    <Button className='button-secondary' onClick={() => void Taro.redirectTo({ url: `/pages/bills/index?tripId=${trip.id}` })}>返回账单</Button>
  </Page>;
}
function localToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
