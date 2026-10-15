package com.jiqian.domain;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.jiqian.common.BizException;
import com.jiqian.domain.Command.*;
import com.jiqian.domain.Models.*;

import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * 纯账本业务规则：不调用 Spring 或数据库，因此服务端每次接到命令都能统一校验。
 * 它与 shared/ledger.ts 保持同一套规则；金额单位始终是整数分。
 */
public final class LedgerRules {
  private static final List<String> CATEGORIES = List.of("餐饮", "住宿", "交通", "门票", "其他");
  private static final List<String> COLORS = List.of("#456c57", "#b77d49", "#7c79a7", "#5e859f", "#ad7377", "#78916b");
  private static final Pattern ID = Pattern.compile("[a-zA-Z0-9_-]{1,100}");
  private static final Pattern DATE = Pattern.compile("\\d{4}-\\d{2}-\\d{2}");
  private static final ObjectMapper JSON = new ObjectMapper();

  private LedgerRules() {}

  public static void require(boolean condition, String message) {
    if (!condition) throw new BizException(message);
  }

  public static String text(String value, String label, int max) {
    require(value != null && !value.trim().isEmpty() && value.trim().length() <= max,
        label + "需填写 1～" + max + " 个字");
    return value.trim();
  }

  public static String validDate(String value) {
    require(value != null && DATE.matcher(value).matches(), "请选择有效日期");
    try {
      require(LocalDate.parse(value).toString().equals(value), "日期不存在");
    } catch (DateTimeParseException error) {
      throw new BizException("日期不存在");
    }
    return value;
  }

  public static int validAmount(Integer value) {
    require(value != null && value > 0 && value <= 100_000_000, "金额需大于零，且不超过 100 万元");
    return value;
  }

  public static String validId(String value) {
    require(value != null && ID.matcher(value).matches(), "请求编号无效，请刷新后重试");
    return value;
  }

  public static Map<String, Integer> equalShares(int amount, List<String> ids) {
    validAmount(amount);
    require(ids != null && !ids.isEmpty(), "请至少选择一位分摊成员，且不能重复");
    require(new HashSet<>(ids).size() == ids.size(), "请至少选择一位分摊成员，且不能重复");
    // 先固定成员顺序，再把除不尽的余数按顺序逐个分 1 分，保证 shares 总和等于金额。
    List<String> sorted = ids.stream().sorted().toList();
    int base = amount / sorted.size(), remainder = amount % sorted.size();
    Map<String, Integer> shares = new LinkedHashMap<>();
    for (int i = 0; i < sorted.size(); i++) shares.put(sorted.get(i), base + (i < remainder ? 1 : 0));
    return shares;
  }

  public static Trip createTrip(TripInput input, User user, String id, String inviteCode, long now) {
    require(input != null, "旅行信息无效");
    String startDate = validDate(input.startDate()), endDate = validDate(input.endDate());
    require(endDate.compareTo(startDate) >= 0, "结束日期不能早于开始日期");
    require(user != null && user.id() != null && !user.id().isBlank(), "用户信息无效");
    return new Trip(validId(id), text(input.name(), "旅行名称", 30), text(input.destination(), "目的地", 30),
        startDate, endDate, user.id(), "active", List.of(makeMember(user.id(), user.name(), 0)),
        List.of(user.id()), List.of(), List.of(), List.of(), validId(inviteCode), now, 1);
  }

  private static Member makeMember(String id, String name, int index) {
    return new Member(id, text(name, "昵称", 20), COLORS.get(index % COLORS.size()), true);
  }

  public static List<Balance> getBalances(Trip trip) {
    Map<String, MutableBalance> balances = new LinkedHashMap<>();
    for (Member member : trip.members()) balances.put(member.id(), new MutableBalance(member.id()));
    for (Expense expense : trip.expenses()) {
      if (expense.deleted()) continue;
      MutableBalance payer = balances.get(expense.payerId());
      if (payer != null) payer.paid += expense.amount();
      for (Map.Entry<String, Integer> share : expense.shares().entrySet()) {
        MutableBalance member = balances.get(share.getKey());
        if (member != null) member.share += share.getValue();
      }
    }
    // 展示真实余额时只计入收款人已确认的转账。
    for (Settlement settlement : trip.settlements()) {
      if (!"confirmed".equals(settlement.status())) continue;
      MutableBalance from = balances.get(settlement.fromId()), to = balances.get(settlement.toId());
      if (from != null) from.sent += settlement.amount();
      if (to != null) to.received += settlement.amount();
    }
    return balances.values().stream().map(MutableBalance::toBalance).toList();
  }

  private static List<Balance> getBalancesIncludingPending(Trip trip) {
    Map<String, MutableBalance> balances = new LinkedHashMap<>();
    for (Member member : trip.members()) balances.put(member.id(), new MutableBalance(member.id()));
    for (Expense expense : trip.expenses()) {
      if (expense.deleted()) continue;
      MutableBalance payer = balances.get(expense.payerId());
      if (payer != null) payer.paid += expense.amount();
      for (Map.Entry<String, Integer> share : expense.shares().entrySet()) {
        MutableBalance member = balances.get(share.getKey());
        if (member != null) member.share += share.getValue();
      }
    }
    // 生成建议时待确认转账先占用对应金额，避免重复安排同一笔债务。
    for (Settlement settlement : trip.settlements()) {
      if (!("confirmed".equals(settlement.status()) || "pending".equals(settlement.status()))) continue;
      MutableBalance from = balances.get(settlement.fromId()), to = balances.get(settlement.toId());
      if (from != null) from.sent += settlement.amount();
      if (to != null) to.received += settlement.amount();
    }
    return balances.values().stream().map(MutableBalance::toBalance).toList();
  }

  public static List<Transfer> suggestTransfers(Trip trip) {
    // 以待结余额配对债务人与债权人，生成可以把所有人的净余额归零的一组转账。
    List<Balance> balances = getBalancesIncludingPending(trip);
    List<MutableAmount> debtors = balances.stream().filter(b -> b.balance() < 0)
        .map(b -> new MutableAmount(b.memberId(), -b.balance()))
        .sorted(Comparator.comparingLong((MutableAmount a) -> a.amount).reversed().thenComparing(a -> a.id)).toList();
    List<MutableAmount> creditors = balances.stream().filter(b -> b.balance() > 0)
        .map(b -> new MutableAmount(b.memberId(), b.balance()))
        .sorted(Comparator.comparingLong((MutableAmount a) -> a.amount).reversed().thenComparing(a -> a.id)).toList();
    List<Transfer> result = new ArrayList<>();
    int i = 0, j = 0;
    while (i < debtors.size() && j < creditors.size()) {
      long amount = Math.min(debtors.get(i).amount, creditors.get(j).amount);
      result.add(new Transfer(debtors.get(i).id, creditors.get(j).id, amount));
      debtors.get(i).amount -= amount;
      creditors.get(j).amount -= amount;
      if (debtors.get(i).amount == 0) i++;
      if (creditors.get(j).amount == 0) j++;
    }
    return result;
  }

  private static ExpenseInput normalizeExpenseInput(ExpenseInput input, Trip trip, ExpenseInput previous) {
    require(input != null, "账单内容无效");
    Set<String> active = new HashSet<>(trip.members().stream().filter(Member::active).map(Member::id).toList());
    require(active.contains(input.payerId()) || (previous != null && previous.payerId().equals(input.payerId())),
        "付款人必须是当前旅行成员");
    require(input.participantIds() != null && !input.participantIds().isEmpty()
        && input.participantIds().stream().allMatch(id -> active.contains(id)
        || (previous != null && previous.participantIds().contains(id))), "请选择有效分摊成员");
    require(new HashSet<>(input.participantIds()).size() == input.participantIds().size(), "分摊成员不能重复");
    require(CATEGORIES.contains(input.category()), "费用分类无效");
    require(input.note() != null && input.note().length() <= 200, "备注不能超过 200 字");
    return new ExpenseInput(text(input.title(), "用途", 60), validAmount(input.amount()), input.payerId(),
        List.copyOf(input.participantIds()), input.category(), validDate(input.date()), input.note().trim());
  }

  public static String expenseSnapshot(Expense expense) {
    List<String> ids = expense.participantIds().stream().sorted().toList();
    List<Object> fields = Arrays.asList(expense.id(), expense.title(), expense.amount(), expense.payerId(),
        ids, expense.category(), expense.date(), expense.note(), expense.updatedAt(), expense.deleted());
    try {
      return JSON.writeValueAsString(fields);
    } catch (JsonProcessingException error) {
      throw new IllegalStateException("Could not serialize expense snapshot", error);
    }
  }

  public static Trip joinTrip(Trip original, User user, long now) {
    require("active".equals(original.status()), "这次旅行已关闭");
    Member existing = original.members().stream().filter(m -> m.id().equals(user.id())).findFirst().orElse(null);
    if (existing != null) {
      require(existing.active(), "你不是这次旅行的有效成员");
      return original;
    }
    require(original.members().size() < 30, "第一版每次旅行最多支持 30 人");
    List<Member> members = new ArrayList<>(original.members());
    members.add(makeMember(user.id(), user.name(), members.size()));
    List<String> memberIds = new ArrayList<>(original.memberIds());
    memberIds.add(user.id());
    return audit(copy(original, members, memberIds, original.expenses(), original.settlements(), original.audit(),
        original.status(), original.version()), user.id(), "加入旅行", user.id(), now);
  }

  public static Trip applyCommand(Trip original, String actor, Command command, long now) {
    // 命令入口负责权限、幂等和业务校验，再返回新的不可变 Trip，不直接改原对象。
    require(command != null, "操作无效");
    requireMember(original, actor);
    // 新增账单和转账使用请求编号去重；网络超时后的安全重试不会重复写入。
    if (command instanceof AddExpense add) {
      validId(add.requestId());
      Expense existing = original.expenses().stream().filter(e -> e.id().equals(add.requestId())).findFirst().orElse(null);
      if (existing != null) {
        require(existing.creatorId().equals(actor), "请求编号已被使用");
        return original;
      }
    }
    if (command instanceof RecordTransfer record) {
      validId(record.requestId());
      Settlement existing = original.settlements().stream().filter(s -> s.id().equals(record.requestId())).findFirst().orElse(null);
      if (existing != null) {
        require(existing.fromId().equals(actor), "请求编号已被使用");
        return original;
      }
    }
    boolean owner = original.creatorId().equals(actor);
    if (command instanceof Reopen) {
      require(owner, "只有创建者可以重新打开账本");
      if ("active".equals(original.status())) return original;
      return audit(copy(original, original.members(), original.memberIds(), original.expenses(), original.settlements(),
          original.audit(), "active", original.version()), actor, "重新打开账本", original.id(), now);
    }
    require("active".equals(original.status()), "账本已关闭，请先由创建者重新打开");

    Trip next;
    if (command instanceof AddExpense add) {
      require(original.expenses().size() < 500, "第一版每次旅行最多保存 500 笔账单");
      ExpenseInput input = normalizeExpenseInput(add.expense(), original, null);
      List<Expense> expenses = new ArrayList<>(original.expenses());
      expenses.add(new Expense(add.requestId(), input.title(), input.amount(), input.payerId(), input.participantIds(),
          input.category(), input.date(), input.note(), actor, equalShares(input.amount(), input.participantIds()), now, now, false));
      next = copy(original, original.members(), original.memberIds(), expenses, original.settlements(), original.audit(),
          original.status(), original.version());
      next = audit(next, actor, "新增账单", add.requestId(), now);
    } else if (command instanceof EditExpense edit) {
      requireNoPendingTransfers(original);
      Expense expense = findExpense(original, edit.expenseId());
      require(owner || expense.creatorId().equals(actor), "只有记录人或旅行创建者可以修改账单");
      verifyExpenseVersion(original, expense, edit.expectedVersion(), edit.expectedExpenseSnapshot());
      ExpenseInput input = normalizeExpenseInput(edit.expense(), original, toInput(expense));
      List<Expense> expenses = replaceExpense(original, expense,
          new Expense(expense.id(), input.title(), input.amount(), input.payerId(), input.participantIds(),
              input.category(), input.date(), input.note(), expense.creatorId(),
              equalShares(input.amount(), input.participantIds()), expense.createdAt(), now, false));
      next = audit(copy(original, original.members(), original.memberIds(), expenses, original.settlements(),
          original.audit(), original.status(), original.version()), actor, "修改账单", expense.id(), now);
    } else if (command instanceof DeleteExpense delete) {
      requireNoPendingTransfers(original);
      Expense expense = findExpense(original, delete.expenseId());
      require(owner || expense.creatorId().equals(actor), "只有记录人或旅行创建者可以修改账单");
      verifyExpenseVersion(original, expense, delete.expectedVersion(), delete.expectedExpenseSnapshot());
      Expense deleted = new Expense(expense.id(), expense.title(), expense.amount(), expense.payerId(),
          expense.participantIds(), expense.category(), expense.date(), expense.note(), expense.creatorId(),
          expense.shares(), expense.createdAt(), now, true);
      next = audit(copy(original, original.members(), original.memberIds(), replaceExpense(original, expense, deleted),
          original.settlements(), original.audit(), original.status(), original.version()), actor, "删除账单", expense.id(), now);
    } else if (command instanceof RecordTransfer record) {
      int amount = validAmount(record.amount());
      require(record.toId() != null && !record.toId().equals(actor)
          && original.members().stream().anyMatch(member -> member.id().equals(record.toId())), "请选择其他收款成员");
      List<Balance> balances = getBalancesIncludingPending(original);
      Balance from = balances.stream().filter(balance -> balance.memberId().equals(actor)).findFirst().orElseThrow();
      Balance to = balances.stream().filter(balance -> balance.memberId().equals(record.toId())).findFirst().orElseThrow();
      require(from.balance() < 0 && to.balance() > 0 && amount <= Math.min(-from.balance(), to.balance()),
          "待结金额已变化，请刷新结算建议");
      require(original.settlements().size() < 500, "转账记录已达第一版上限");
      List<Settlement> settlements = new ArrayList<>(original.settlements());
      settlements.add(new Settlement(record.requestId(), actor, record.toId(), amount, "pending", now, null));
      next = audit(copy(original, original.members(), original.memberIds(), original.expenses(), settlements,
          original.audit(), original.status(), original.version()), actor, "标记已转账", record.requestId(), now);
    } else if (command instanceof ConfirmTransfer confirm) {
      Settlement settlement = findSettlement(original, confirm.settlementId());
      require(settlement.toId().equals(actor), "只有收款人可以确认到账");
      if ("confirmed".equals(settlement.status())) return original;
      require("pending".equals(settlement.status()), "这笔转账已取消");
      Settlement changed = new Settlement(settlement.id(), settlement.fromId(), settlement.toId(),
          settlement.amount(), "confirmed", settlement.createdAt(), now);
      next = audit(copy(original, original.members(), original.memberIds(), original.expenses(),
          replaceSettlement(original, settlement, changed), original.audit(), original.status(), original.version()),
          actor, "确认到账", settlement.id(), now);
    } else if (command instanceof CancelTransfer cancel) {
      Settlement settlement = findSettlement(original, cancel.settlementId());
      require(settlement.fromId().equals(actor) || settlement.toId().equals(actor), "只有转账双方可以取消");
      if ("cancelled".equals(settlement.status())) return original;
      require("pending".equals(settlement.status()), "已确认到账的转账不能取消");
      Settlement changed = new Settlement(settlement.id(), settlement.fromId(), settlement.toId(),
          settlement.amount(), "cancelled", settlement.createdAt(), settlement.confirmedAt());
      next = audit(copy(original, original.members(), original.memberIds(), original.expenses(),
          replaceSettlement(original, settlement, changed), original.audit(), original.status(), original.version()),
          actor, "取消转账标记", settlement.id(), now);
    } else if (command instanceof Close) {
      require(owner, "只有创建者可以关闭账本");
      require(original.settlements().stream().noneMatch(s -> "pending".equals(s.status()))
          && getBalances(original).stream().allMatch(balance -> balance.balance() == 0), "还有未结清的金额或待确认转账");
      next = audit(copy(original, original.members(), original.memberIds(), original.expenses(), original.settlements(),
          original.audit(), "closed", original.version()), actor, "关闭账本", original.id(), now);
    } else if (command instanceof DeactivateMember deactivate) {
      require(owner, "只有创建者可以移除成员");
      require(deactivate.memberId() != null && !deactivate.memberId().equals(original.creatorId()), "创建者不能被移除");
      Member member = original.members().stream().filter(m -> m.id().equals(deactivate.memberId())).findFirst().orElse(null);
      require(member != null && member.active(), "成员不存在或已退出");
      Balance balance = getBalances(original).stream().filter(b -> b.memberId().equals(member.id())).findFirst().orElse(null);
      require(balance != null && balance.balance() == 0, "该成员尚未结清，不能移除");
      require(original.settlements().stream().noneMatch(s -> "pending".equals(s.status())
          && (s.fromId().equals(member.id()) || s.toId().equals(member.id()))), "该成员还有待确认转账");
      List<Member> members = new ArrayList<>(original.members());
      int index = members.indexOf(member);
      members.set(index, new Member(member.id(), member.name(), member.color(), false));
      List<String> memberIds = original.memberIds().stream().filter(id -> !id.equals(member.id())).toList();
      next = audit(copy(original, members, memberIds, original.expenses(), original.settlements(), original.audit(),
          original.status(), original.version()), actor, "移除成员", member.id(), now);
    } else if (command instanceof RenameSelf rename) {
      List<Member> members = new ArrayList<>(original.members());
      int index = indexOfMember(members, actor);
      Member member = members.get(index);
      members.set(index, new Member(member.id(), text(rename.name(), "昵称", 20), member.color(), member.active()));
      next = audit(copy(original, members, original.memberIds(), original.expenses(), original.settlements(),
          original.audit(), original.status(), original.version()), actor, "修改昵称", actor, now);
    } else {
      throw new BizException("不支持的操作");
    }

    Set<String> inactiveIds = new HashSet<>(next.members().stream().filter(member -> !member.active()).map(Member::id).toList());
    require(getBalances(next).stream().allMatch(balance -> !inactiveIds.contains(balance.memberId()) || balance.balance() == 0),
        "历史账单涉及已退出成员，不能改变其已结清金额");
    return next;
  }

  private static void verifyExpenseVersion(Trip trip, Expense expense, Integer expectedVersion, String snapshot) {
    // 优先比较当前账单快照；旧客户端没有快照时才退回到整本账的版本号比较。
    if (snapshot != null) {
      require(expenseSnapshot(expense).equals(snapshot), "这笔账单已被修改，请核对最新内容后再保存");
    } else {
      require(expectedVersion != null && expectedVersion == trip.version(), "账本已更新，请刷新后重新操作");
    }
  }

  private static ExpenseInput toInput(Expense expense) {
    return new ExpenseInput(expense.title(), expense.amount(), expense.payerId(), expense.participantIds(),
        expense.category(), expense.date(), expense.note());
  }

  private static void requireNoPendingTransfers(Trip trip) {
    require(trip.settlements().stream().noneMatch(settlement -> "pending".equals(settlement.status())),
        "有待确认转账，请确认或取消后再修改消费");
  }

  private static Expense findExpense(Trip trip, String id) {
    Expense expense = trip.expenses().stream().filter(item -> item.id().equals(id) && !item.deleted()).findFirst().orElse(null);
    require(expense != null, "账单不存在或已删除");
    return expense;
  }

  private static Settlement findSettlement(Trip trip, String id) {
    Settlement settlement = trip.settlements().stream().filter(item -> item.id().equals(id)).findFirst().orElse(null);
    require(settlement != null, "转账记录不存在");
    return settlement;
  }

  private static List<Expense> replaceExpense(Trip trip, Expense oldValue, Expense newValue) {
    List<Expense> result = new ArrayList<>(trip.expenses());
    result.set(result.indexOf(oldValue), newValue);
    return result;
  }

  private static List<Settlement> replaceSettlement(Trip trip, Settlement oldValue, Settlement newValue) {
    List<Settlement> result = new ArrayList<>(trip.settlements());
    result.set(result.indexOf(oldValue), newValue);
    return result;
  }

  private static int indexOfMember(List<Member> members, String id) {
    for (int i = 0; i < members.size(); i++) if (members.get(i).id().equals(id)) return i;
    throw new BizException("你不是这次旅行的有效成员");
  }

  private static void requireMember(Trip trip, String actor) {
    require(trip.members().stream().anyMatch(member -> member.id().equals(actor) && member.active()),
        "你不是这次旅行的有效成员");
  }

  private static Trip audit(Trip trip, String actor, String action, String targetId, long now) {
    // 每次实际修改都增加版本号并保留最近 200 条动态，供冲突检测和成员页查看。
    List<AuditEntry> entries = new ArrayList<>(trip.audit());
    entries.add(new AuditEntry(actor, action, targetId, now));
    if (entries.size() > 200) entries = new ArrayList<>(entries.subList(entries.size() - 200, entries.size()));
    return copy(trip, trip.members(), trip.memberIds(), trip.expenses(), trip.settlements(), entries,
        trip.status(), trip.version() + 1);
  }

  private static Trip copy(Trip trip, List<Member> members, List<String> memberIds, List<Expense> expenses,
                           List<Settlement> settlements, List<AuditEntry> audit, String status, int version) {
    return new Trip(trip.id(), trip.name(), trip.destination(), trip.startDate(), trip.endDate(), trip.creatorId(),
        status, members, memberIds, expenses, settlements, audit, trip.inviteCode(), trip.createdAt(), version);
  }

  private static final class MutableBalance {
    private final String memberId;
    private long paid, share, received, sent;
    private MutableBalance(String memberId) { this.memberId = memberId; }
    private Balance toBalance() { return new Balance(memberId, paid, share, received, sent, paid - share + sent - received); }
  }

  private static final class MutableAmount {
    private final String id;
    private long amount;
    private MutableAmount(String id, long amount) { this.id = id; this.amount = amount; }
  }
}
