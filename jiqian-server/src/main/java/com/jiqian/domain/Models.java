package com.jiqian.domain;

import java.util.List;
import java.util.Map;

/**
 * Java 后端对外返回和内部传递的数据结构，对应 shared/types.ts 中的 TypeScript 类型。
 * 金额使用整数“分”；修改字段时需要一起检查 JSON、MyBatis 和数据库字段映射。
 */
public final class Models {
  private Models() {}

  public record User(String id, String name) {}
  public record Member(String id, String name, String color, boolean active) {}
  public record ExpenseInput(String title, Integer amount, String payerId, List<String> participantIds,
                             String category, String date, String note) {}
  public record Expense(String id, String title, int amount, String payerId, List<String> participantIds,
                        String category, String date, String note, String creatorId,
                        Map<String, Integer> shares, long createdAt, long updatedAt, boolean deleted) {}
  public record Settlement(String id, String fromId, String toId, int amount, String status,
                           long createdAt, Long confirmedAt) {}
  public record AuditEntry(String actorId, String action, String targetId, long at) {}
  public record Trip(String id, String name, String destination, String startDate, String endDate,
                     String creatorId, String status, List<Member> members, List<String> memberIds,
                     List<Expense> expenses, List<Settlement> settlements, List<AuditEntry> audit,
                     String inviteCode, long createdAt, int version) {}
  public record TripInput(String name, String destination, String startDate, String endDate) {}
  public record Balance(String memberId, long paid, long share, long received, long sent, long balance) {}
  public record Transfer(String fromId, String toId, long amount) {}
  public record Bootstrap(User user, List<Trip> trips) {}
  public record LoginResult(String token, User user) {}
  public record CreateTripRequest(String requestId, String name, TripInput input) {}
  public record JoinTripRequest(String inviteCode, String name) {}
}
