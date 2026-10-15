package com.jiqian.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.jiqian.common.BizException;
import com.jiqian.domain.Models.*;
import com.jiqian.mapper.LedgerMapper;
import org.springframework.stereotype.Repository;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 关系数据库与页面账本对象之间的转换层。一个 Trip 在 MySQL 中拆成多张关联表，
 * 读取时拼回聚合对象，保存时在同一事务里整体替换子记录。
 */
@Repository
public class TripRepository {
  private static final long MAX_TRIP_BYTES = 800_000;
  private final LedgerMapper mapper;
  private final ObjectMapper objectMapper;

  public TripRepository(LedgerMapper mapper, ObjectMapper objectMapper) {
    this.mapper = mapper;
    this.objectMapper = objectMapper;
  }

  public User findUser(String id) {
    Map<String, Object> row = mapper.findUser(id);
    return row == null ? null : new User(string(row, "id"), string(row, "name"));
  }

  public void upsertUser(User user, long now) {
    mapper.upsertUser(user.id(), user.name(), now);
  }

  public Trip findTrip(String id) {
    Map<String, Object> row = mapper.findTrip(id);
    return row == null ? null : readTrip(row);
  }

  public Trip lockTrip(String id) {
    Map<String, Object> row = mapper.lockTrip(id);
    return row == null ? null : readTrip(row);
  }

  public String findTripIdByInviteCode(String inviteCode) {
    return mapper.findTripIdByInviteCode(inviteCode);
  }

  public List<Trip> findTripsForMember(String memberId) {
    List<Trip> result = new ArrayList<>();
    for (String tripId : mapper.findTripIdsForMember(memberId)) {
      Trip trip = findTrip(tripId);
      if (trip != null && trip.members().stream().anyMatch(member -> member.id().equals(memberId) && member.active())) {
        result.add(trip);
      }
    }
    return result;
  }

  public void insertTrip(Trip trip) {
    mapper.insertTrip(tripValues(trip));
    saveChildren(trip);
  }

  public void saveTrip(Trip trip) {
    checkSize(trip);
    Map<String, Object> values = tripValues(trip);
    // 乐观锁版本检查是第二道并发保护；即使调用方没有持有行锁，也不会静默覆盖旧版本。
    values.put("expectedVersion", trip.version() - 1);
    if (mapper.updateTrip(values) != 1) throw new BizException("账本已更新，请刷新后重新操作");
    saveChildren(trip);
  }

  private Trip readTrip(Map<String, Object> row) {
    // 主表只保存旅行基本信息；成员、消费、分摊、转账和动态分别从子表读取。
    String id = string(row, "id");
    List<Map<String, Object>> memberRows = mapper.findMembers(id);
    List<Member> members = memberRows.stream().map(member -> new Member(string(member, "memberId"),
        string(member, "name"), string(member, "color"), bool(member, "active"))).toList();

    Map<String, LinkedHashMap<String, Integer>> sharesByExpense = new LinkedHashMap<>();
    Map<String, List<String>> participantsByExpense = new LinkedHashMap<>();
    for (Map<String, Object> share : mapper.findExpenseShares(id)) {
      String expenseId = string(share, "expenseId"), memberId = string(share, "memberId");
      sharesByExpense.computeIfAbsent(expenseId, ignored -> new LinkedHashMap<>())
          .put(memberId, integer(share, "amount"));
      participantsByExpense.computeIfAbsent(expenseId, ignored -> new ArrayList<>()).add(memberId);
    }
    List<Expense> expenses = mapper.findExpenses(id).stream().map(expense -> {
      String expenseId = string(expense, "id");
      return new Expense(expenseId, string(expense, "title"), integer(expense, "amount"),
          string(expense, "payerId"), participantsByExpense.getOrDefault(expenseId, List.of()),
          string(expense, "category"), string(expense, "expenseDate"), string(expense, "note"),
          string(expense, "creatorId"), sharesByExpense.getOrDefault(expenseId, new LinkedHashMap<>()),
          number(expense, "createdAt"), number(expense, "updatedAt"), bool(expense, "deleted"));
    }).toList();

    List<Settlement> settlements = mapper.findSettlements(id).stream().map(settlement ->
        new Settlement(string(settlement, "id"), string(settlement, "fromId"), string(settlement, "toId"),
            integer(settlement, "amount"), string(settlement, "status"), number(settlement, "createdAt"),
            nullableNumber(settlement, "confirmedAt"))).toList();
    List<AuditEntry> audit = mapper.findAudit(id).stream().map(entry ->
        new AuditEntry(string(entry, "actorId"), string(entry, "action"), string(entry, "targetId"), number(entry, "at")))
        .toList();

    return new Trip(id, string(row, "name"), string(row, "destination"), string(row, "startDate"),
        string(row, "endDate"), string(row, "creatorId"), string(row, "status"), members,
        members.stream().filter(Member::active).map(Member::id).toList(), expenses, settlements, audit,
        string(row, "inviteCode"), number(row, "createdAt"), integer(row, "version"));
  }

  private void saveChildren(Trip trip) {
    // 只在 LedgerService 的事务中调用：先删旧子行，再写入新快照，失败时由事务整体回滚。
    mapper.deleteAudit(trip.id());
    mapper.deleteSettlements(trip.id());
    mapper.deleteExpenses(trip.id()); // expense_shares are removed through the FK cascade.

    for (int i = 0; i < trip.members().size(); i++) {
      Member member = trip.members().get(i);
      mapper.insertMember(values("tripId", trip.id(), "memberId", member.id(), "name", member.name(),
          "color", member.color(), "active", member.active(), "memberOrder", i, "joinedAt", trip.createdAt()));
    }
    for (Expense expense : trip.expenses()) {
      mapper.insertExpense(values("tripId", trip.id(), "id", expense.id(), "title", expense.title(),
          "amount", expense.amount(), "payerId", expense.payerId(), "category", expense.category(),
          "expenseDate", expense.date(), "note", expense.note(), "creatorId", expense.creatorId(),
          "deleted", expense.deleted(), "createdAt", expense.createdAt(), "updatedAt", expense.updatedAt()));
      for (int i = 0; i < expense.participantIds().size(); i++) {
        String memberId = expense.participantIds().get(i);
        Integer amount = expense.shares().get(memberId);
        if (amount == null) throw new IllegalStateException("Expense share is missing for participant");
        mapper.insertExpenseShare(values("tripId", trip.id(), "expenseId", expense.id(), "memberId", memberId,
            "amount", amount, "participantOrder", i));
      }
    }
    for (Settlement settlement : trip.settlements()) {
      mapper.insertSettlement(values("tripId", trip.id(), "id", settlement.id(), "fromId", settlement.fromId(),
          "toId", settlement.toId(), "amount", settlement.amount(), "status", settlement.status(),
          "createdAt", settlement.createdAt(), "confirmedAt", settlement.confirmedAt()));
    }
    for (AuditEntry entry : trip.audit()) {
      mapper.insertAudit(values("tripId", trip.id(), "actorId", entry.actorId(), "action", entry.action(),
          "targetId", entry.targetId(), "at", entry.at()));
    }
  }

  private Map<String, Object> tripValues(Trip trip) {
    return values("id", trip.id(), "name", trip.name(), "destination", trip.destination(),
        "startDate", trip.startDate(), "endDate", trip.endDate(), "creatorId", trip.creatorId(),
        "status", trip.status(), "inviteCode", trip.inviteCode(), "version", trip.version(),
        "createdAt", trip.createdAt());
  }

  private void checkSize(Trip trip) {
    try {
      if (objectMapper.writeValueAsString(trip).getBytes(StandardCharsets.UTF_8).length > MAX_TRIP_BYTES) {
        throw new BizException("账本已达第一版容量上限，请新建旅行账本");
      }
    } catch (JsonProcessingException error) {
      throw new IllegalStateException("Could not serialize trip", error);
    }
  }

  private static Map<String, Object> values(Object... pairs) {
    Map<String, Object> result = new LinkedHashMap<>();
    for (int i = 0; i < pairs.length; i += 2) result.put((String) pairs[i], pairs[i + 1]);
    return result;
  }

  private static Object value(Map<String, Object> row, String name) {
    if (row.containsKey(name)) return row.get(name);
    String lower = name.substring(0, 1).toLowerCase() + name.substring(1);
    if (row.containsKey(lower)) return row.get(lower);
    return row.entrySet().stream().filter(entry -> entry.getKey().equalsIgnoreCase(name))
        .map(Map.Entry::getValue).findFirst().orElse(null);
  }

  private static String string(Map<String, Object> row, String name) {
    Object value = value(row, name);
    return value == null ? null : value.toString();
  }

  private static long number(Map<String, Object> row, String name) {
    Object value = value(row, name);
    if (value instanceof Number number) return number.longValue();
    if (value == null) throw new IllegalStateException("Missing numeric database field: " + name);
    return Long.parseLong(value.toString());
  }

  private static Long nullableNumber(Map<String, Object> row, String name) {
    Object value = value(row, name);
    if (value == null) return null;
    return value instanceof Number number ? number.longValue() : Long.parseLong(value.toString());
  }

  private static int integer(Map<String, Object> row, String name) {
    return Math.toIntExact(number(row, name));
  }

  private static boolean bool(Map<String, Object> row, String name) {
    Object value = value(row, name);
    if (value instanceof Boolean bool) return bool;
    if (value instanceof Number number) return number.intValue() != 0;
    return Boolean.parseBoolean(String.valueOf(value));
  }
}
