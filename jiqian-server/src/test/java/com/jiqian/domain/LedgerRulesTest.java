package com.jiqian.domain;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.jiqian.common.BizException;
import com.jiqian.domain.Command.AddExpense;
import com.jiqian.domain.Command.ConfirmTransfer;
import com.jiqian.domain.Command.EditExpense;
import com.jiqian.domain.Command.Close;
import com.jiqian.domain.Command.Reopen;
import com.jiqian.domain.Command.DeactivateMember;
import com.jiqian.domain.Command.RecordTransfer;
import com.jiqian.domain.Models.*;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotSame;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class LedgerRulesTest {
  private Trip trip() {
    return LedgerRules.createTrip(new TripInput("川西旅行", "川西", "2026-10-01", "2026-10-07"),
        new User("a", "小王"), "t_abc123", "invite_123", 100);
  }

  private ExpenseInput expense(int amount, List<String> participants) {
    return new ExpenseInput("住宿", amount, "a", participants, "住宿", "2026-10-01", "");
  }

  @Test
  void equalSharesAreExactAndRemainderUsesSortedMemberIds() {
    assertEquals(Map.of("a", 501, "b", 500), LedgerRules.equalShares(1001, List.of("b", "a")));
  }

  @Test
  void joinDoesNotRedistributeHistoryAndIsIdempotent() {
    Trip original = LedgerRules.applyCommand(trip(), "a", new AddExpense("expense_1", expense(10000, List.of("a"))), 101);
    Trip joined = LedgerRules.joinTrip(original, new User("b", "小李"), 102);
    assertNotSame(original, joined);
    assertEquals(0, LedgerRules.getBalances(joined).stream().filter(b -> b.memberId().equals("b")).findFirst().orElseThrow().share());
    assertSame(joined, LedgerRules.joinTrip(joined, new User("b", "改过的全局名"), 103));
  }

  @Test
  void repeatedAddExpenseReturnsOriginalAndDoesNotAdvanceVersion() {
    Trip first = LedgerRules.applyCommand(trip(), "a", new AddExpense("expense_1", expense(1000, List.of("a"))), 101);
    Trip retry = LedgerRules.applyCommand(first, "a", new AddExpense("expense_1", expense(1000, List.of("a"))), 102);
    assertSame(first, retry);
    assertEquals(1, retry.expenses().size());
    assertEquals(first.version(), retry.version());
  }

  @Test
  void requestIdsCannotBeReusedByAnotherMember() {
    Trip joined = LedgerRules.joinTrip(trip(), new User("b", "小李"), 101);
    Trip first = LedgerRules.applyCommand(joined, "a", new AddExpense("expense_1", expense(1000, List.of("a"))), 102);
    assertThrows(BizException.class,
        () -> LedgerRules.applyCommand(first, "b", new AddExpense("expense_1", expense(1000, List.of("b"))), 103));
  }

  @Test
  void transferUsesPendingReservationsAndOnlyRecipientCanConfirm() {
    Trip joined = LedgerRules.joinTrip(trip(), new User("b", "小李"), 101);
    Trip spent = LedgerRules.applyCommand(joined, "a", new AddExpense("expense_1", expense(1000, List.of("a", "b"))), 102);
    Trip marked = LedgerRules.applyCommand(spent, "b", new RecordTransfer("transfer_1", "a", 500), 103);
    assertEquals(0, LedgerRules.suggestTransfers(marked).stream().mapToLong(Transfer::amount).sum());
    assertThrows(BizException.class, () -> LedgerRules.applyCommand(marked, "b", new ConfirmTransfer("transfer_1"), 104));
    Trip confirmed = LedgerRules.applyCommand(marked, "a", new ConfirmTransfer("transfer_1"), 105);
    assertEquals(0, LedgerRules.getBalances(confirmed).stream().mapToLong(Balance::balance).sum());
  }

  @Test
  void snapshotSerializationMatchesClientShape() {
    Trip joined = LedgerRules.joinTrip(trip(), new User("b", "小李"), 101);
    Trip spent = LedgerRules.applyCommand(joined, "a", new AddExpense("expense_1", expense(1001, List.of("b", "a"))), 102);
    assertEquals("[\"expense_1\",\"住宿\",1001,\"a\",[\"a\",\"b\"],\"住宿\",\"2026-10-01\",\"\",102,false]",
        LedgerRules.expenseSnapshot(spent.expenses().get(0)));
  }

  @Test
  void expenseSnapshotAllowsUnrelatedChangesButRejectsStaleEdits() {
    Trip joined = LedgerRules.joinTrip(trip(), new User("b", "小李"), 101);
    Trip spent = LedgerRules.applyCommand(joined, "a", new AddExpense("expense_1", expense(1001, List.of("b", "a"))), 102);
    String snapshot = LedgerRules.expenseSnapshot(spent.expenses().get(0));
    Trip renamed = LedgerRules.applyCommand(spent, "b", new Command.RenameSelf("小李子"), 103);
    Trip edited = LedgerRules.applyCommand(renamed, "a",
        new EditExpense("expense_1", expense(2000, List.of("b", "a")), 0, snapshot), 104);
    assertEquals(2000, edited.expenses().get(0).amount());
    assertThrows(BizException.class, () -> LedgerRules.applyCommand(edited, "a",
        new EditExpense("expense_1", expense(3000, List.of("b", "a")), 0, snapshot), 105));
  }

  @Test
  void inactiveMemberCannotHaveTheirSettledHistoryChanged() {
    Trip joined = LedgerRules.joinTrip(trip(), new User("b", "小李"), 101);
    ExpenseInput first = new ExpenseInput("共同开销 1", 1000, "a", List.of("a", "b"), "其他", "2026-10-01", "");
    Trip spent = LedgerRules.applyCommand(joined, "a", new AddExpense("expense_1", first), 102);
    ExpenseInput second = new ExpenseInput("共同开销 2", 1000, "b", List.of("a", "b"), "其他", "2026-10-01", "");
    spent = LedgerRules.applyCommand(spent, "a", new AddExpense("expense_2", second), 103);
    Trip left = LedgerRules.applyCommand(spent, "a", new DeactivateMember("b"), 104);
    assertFalse(left.members().get(1).active());
    ExpenseInput changed = new ExpenseInput("共同开销 1", 1200, "a", List.of("a", "b"), "其他", "2026-10-01", "");
    assertThrows(BizException.class, () -> LedgerRules.applyCommand(left, "a",
        new EditExpense("expense_1", changed, 0, LedgerRules.expenseSnapshot(left.expenses().get(0))), 105));
  }

  @Test
  void closingRequiresAllBalancesSettledAndCreatorCanReopen() {
    Trip joined = LedgerRules.joinTrip(trip(), new User("b", "小李"), 101);
    Trip spent = LedgerRules.applyCommand(joined, "a", new AddExpense("expense_1", expense(1000, List.of("a", "b"))), 102);
    assertThrows(BizException.class, () -> LedgerRules.applyCommand(spent, "a", new Close(), 103));
    Trip settled = LedgerRules.applyCommand(spent, "a", new AddExpense("expense_2",
        new ExpenseInput("返款", 1000, "b", List.of("a", "b"), "其他", "2026-10-01", "")), 103);
    Trip closed = LedgerRules.applyCommand(settled, "a", new Close(), 104);
    assertEquals("closed", closed.status());
    assertEquals("active", LedgerRules.applyCommand(closed, "a", new Reopen(), 105).status());
  }

  @Test
  void businessValidationRejectsImpossibleDatesAndInvalidExpenseAmounts() {
    assertThrows(BizException.class, () -> LedgerRules.validDate("2026-02-30"));
    assertThrows(BizException.class, () -> LedgerRules.validAmount(-1));
    assertThrows(BizException.class, () -> LedgerRules.equalShares(1, List.of("a", "a")));
  }

  @Test
  void commandJsonKeepsTheExistingDiscriminatedUnionContract() throws Exception {
    ObjectMapper mapper = new ObjectMapper();
    Command command = mapper.readValue("""
        {"type":"addExpense","requestId":"expense_1","expense":{"title":"午饭","amount":1800,
          "payerId":"a","participantIds":["a"],"category":"餐饮","date":"2026-10-01","note":""}}
        """, Command.class);
    assertTrue(command instanceof AddExpense);
    assertFalse(((AddExpense) command).expense().participantIds().isEmpty());
    assertEquals(1800, ((AddExpense) command).expense().amount());
  }
}
