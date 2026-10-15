package com.jiqian.mapper;

import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.util.List;
import java.util.Map;

/** 用注解 SQL 把关系表行映射成 Map；字段别名统一成 TripRepository 使用的驼峰名称。 */
@Mapper
public interface LedgerMapper {
  @Select("SELECT id, name, created_at AS createdAt FROM users WHERE id = #{id}")
  Map<String, Object> findUser(@Param("id") String id);

  @Insert("""
      INSERT INTO users (id, name, created_at) VALUES (#{id}, #{name}, #{createdAt})
      ON DUPLICATE KEY UPDATE name = VALUES(name)
      """)
  int upsertUser(@Param("id") String id, @Param("name") String name, @Param("createdAt") long createdAt);

  @Select("SELECT id, name, destination, start_date AS startDate, end_date AS endDate, creator_id AS creatorId, " +
      "status, invite_code AS inviteCode, version, created_at AS createdAt FROM trips WHERE id = #{id}")
  Map<String, Object> findTrip(@Param("id") String id);

  @Select("SELECT id, name, destination, start_date AS startDate, end_date AS endDate, creator_id AS creatorId, " +
      "status, invite_code AS inviteCode, version, created_at AS createdAt FROM trips WHERE id = #{id} FOR UPDATE")
  // InnoDB 行锁在当前事务结束前保护同一本旅行，防止两个命令同时读取并覆盖。
  Map<String, Object> lockTrip(@Param("id") String id);

  @Select("SELECT id FROM trips WHERE invite_code = #{inviteCode}")
  String findTripIdByInviteCode(@Param("inviteCode") String inviteCode);

  @Select("SELECT t.id FROM trips t INNER JOIN trip_members m ON m.trip_id = t.id " +
      "WHERE m.member_id = #{memberId} AND m.active = 1 ORDER BY t.created_at DESC LIMIT 20")
  List<String> findTripIdsForMember(@Param("memberId") String memberId);

  @Insert("""
      INSERT INTO trips (id, name, destination, start_date, end_date, creator_id, status, invite_code, version, created_at)
      VALUES (#{id}, #{name}, #{destination}, #{startDate}, #{endDate}, #{creatorId}, #{status}, #{inviteCode}, #{version}, #{createdAt})
      """)
  int insertTrip(Map<String, Object> values);

  @Update("""
      UPDATE trips SET name = #{name}, destination = #{destination}, start_date = #{startDate}, end_date = #{endDate},
        status = #{status}, version = #{version}
      WHERE id = #{id} AND version = #{expectedVersion}
      """)
  // 版本条件是乐观锁：更新行数为 0 说明账本已被别人先修改。
  int updateTrip(Map<String, Object> values);

  @Select("SELECT trip_id AS tripId, member_id AS memberId, name, color, active, member_order AS memberOrder, joined_at AS joinedAt " +
      "FROM trip_members WHERE trip_id = #{tripId} ORDER BY member_order")
  List<Map<String, Object>> findMembers(@Param("tripId") String tripId);

  @Select("SELECT trip_id AS tripId, id, title, amount, payer_id AS payerId, category, expense_date AS expenseDate, " +
      "note, creator_id AS creatorId, deleted, created_at AS createdAt, updated_at AS updatedAt " +
      "FROM expenses WHERE trip_id = #{tripId} ORDER BY created_at, id")
  List<Map<String, Object>> findExpenses(@Param("tripId") String tripId);

  @Select("SELECT trip_id AS tripId, expense_id AS expenseId, member_id AS memberId, amount, " +
      "participant_order AS participantOrder FROM expense_shares WHERE trip_id = #{tripId} " +
      "ORDER BY expense_id, participant_order")
  List<Map<String, Object>> findExpenseShares(@Param("tripId") String tripId);

  @Select("SELECT trip_id AS tripId, id, from_id AS fromId, to_id AS toId, amount, status, " +
      "created_at AS createdAt, confirmed_at AS confirmedAt FROM settlements WHERE trip_id = #{tripId} ORDER BY created_at, id")
  List<Map<String, Object>> findSettlements(@Param("tripId") String tripId);

  @Select("SELECT trip_id AS tripId, actor_id AS actorId, action, target_id AS targetId, at " +
      "FROM audit_logs WHERE trip_id = #{tripId} ORDER BY id")
  List<Map<String, Object>> findAudit(@Param("tripId") String tripId);

  @Delete("DELETE FROM audit_logs WHERE trip_id = #{tripId}")
  int deleteAudit(@Param("tripId") String tripId);

  @Delete("DELETE FROM settlements WHERE trip_id = #{tripId}")
  int deleteSettlements(@Param("tripId") String tripId);

  @Delete("DELETE FROM expenses WHERE trip_id = #{tripId}")
  int deleteExpenses(@Param("tripId") String tripId);

  @Insert("INSERT INTO trip_members (trip_id, member_id, name, color, active, member_order, joined_at) " +
      "VALUES (#{tripId}, #{memberId}, #{name}, #{color}, #{active}, #{memberOrder}, #{joinedAt}) " +
      "ON DUPLICATE KEY UPDATE name = VALUES(name), color = VALUES(color), active = VALUES(active), member_order = VALUES(member_order)")
  int insertMember(Map<String, Object> values);

  @Insert("""
      INSERT INTO expenses (trip_id, id, title, amount, payer_id, category, expense_date, note, creator_id, deleted, created_at, updated_at)
      VALUES (#{tripId}, #{id}, #{title}, #{amount}, #{payerId}, #{category}, #{expenseDate}, #{note}, #{creatorId}, #{deleted}, #{createdAt}, #{updatedAt})
      """)
  int insertExpense(Map<String, Object> values);

  @Insert("INSERT INTO expense_shares (trip_id, expense_id, member_id, amount, participant_order) " +
      "VALUES (#{tripId}, #{expenseId}, #{memberId}, #{amount}, #{participantOrder})")
  int insertExpenseShare(Map<String, Object> values);

  @Insert("INSERT INTO settlements (trip_id, id, from_id, to_id, amount, status, created_at, confirmed_at) " +
      "VALUES (#{tripId}, #{id}, #{fromId}, #{toId}, #{amount}, #{status}, #{createdAt}, #{confirmedAt})")
  int insertSettlement(Map<String, Object> values);

  @Insert("INSERT INTO audit_logs (trip_id, actor_id, action, target_id, at) " +
      "VALUES (#{tripId}, #{actorId}, #{action}, #{targetId}, #{at})")
  int insertAudit(Map<String, Object> values);
}
