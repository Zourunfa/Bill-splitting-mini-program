package com.jiqian.domain;

import com.fasterxml.jackson.annotation.JsonSubTypes;
import com.fasterxml.jackson.annotation.JsonTypeInfo;
import com.jiqian.domain.Models.ExpenseInput;

/**
 * 前端命令的 Java 版本。JSON 的 type 字段告诉 Jackson 应把请求反序列化成下面哪种动作。
 */
@JsonTypeInfo(use = JsonTypeInfo.Id.NAME, property = "type")
@JsonSubTypes({
    @JsonSubTypes.Type(value = Command.AddExpense.class, name = "addExpense"),
    @JsonSubTypes.Type(value = Command.EditExpense.class, name = "editExpense"),
    @JsonSubTypes.Type(value = Command.DeleteExpense.class, name = "deleteExpense"),
    @JsonSubTypes.Type(value = Command.RecordTransfer.class, name = "recordTransfer"),
    @JsonSubTypes.Type(value = Command.ConfirmTransfer.class, name = "confirmTransfer"),
    @JsonSubTypes.Type(value = Command.CancelTransfer.class, name = "cancelTransfer"),
    @JsonSubTypes.Type(value = Command.Close.class, name = "close"),
    @JsonSubTypes.Type(value = Command.Reopen.class, name = "reopen"),
    @JsonSubTypes.Type(value = Command.DeactivateMember.class, name = "deactivateMember"),
    @JsonSubTypes.Type(value = Command.RenameSelf.class, name = "renameSelf")
})
public sealed interface Command permits Command.AddExpense, Command.EditExpense, Command.DeleteExpense,
    Command.RecordTransfer, Command.ConfirmTransfer, Command.CancelTransfer, Command.Close,
    Command.Reopen, Command.DeactivateMember, Command.RenameSelf {

  record AddExpense(String requestId, ExpenseInput expense) implements Command {}
  record EditExpense(String expenseId, ExpenseInput expense, Integer expectedVersion,
                     String expectedExpenseSnapshot) implements Command {}
  record DeleteExpense(String expenseId, Integer expectedVersion,
                       String expectedExpenseSnapshot) implements Command {}
  record RecordTransfer(String requestId, String toId, Integer amount) implements Command {}
  record ConfirmTransfer(String settlementId) implements Command {}
  record CancelTransfer(String settlementId) implements Command {}
  record Close() implements Command {}
  record Reopen() implements Command {}
  record DeactivateMember(String memberId) implements Command {}
  record RenameSelf(String name) implements Command {}
}
