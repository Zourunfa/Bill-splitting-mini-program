package com.jiqian.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.jiqian.common.BizException;
import com.jiqian.domain.Command;
import com.jiqian.domain.LedgerRules;
import com.jiqian.domain.Models.*;
import com.jiqian.mapper.LedgerMapper;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.HexFormat;
import java.util.List;

/**
 * 用例编排层：开启事务，调用领域规则，再让 TripRepository 读写数据库。
 * Controller 只负责 HTTP 参数；具体 AA 和权限判断仍由 LedgerRules 执行。
 */
@Service
public class LedgerService {
  private static final SecureRandom RANDOM = new SecureRandom();
  private final TripRepository trips;
  private final LedgerMapper mapper;
  private final ObjectMapper objectMapper;

  public LedgerService(TripRepository trips, LedgerMapper mapper, ObjectMapper objectMapper) {
    this.trips = trips;
    this.mapper = mapper;
    this.objectMapper = objectMapper;
  }

  @Transactional
  public User ensureUser(String openId) {
    LedgerRules.require(openId != null && !openId.isBlank(), "微信登录失败，请重新进入小程序");
    User user = trips.findUser(openId);
    if (user == null) {
      user = new User(openId, "旅友");
      trips.upsertUser(user, System.currentTimeMillis());
    }
    return user;
  }

  @Transactional(readOnly = true)
  public Bootstrap bootstrap(String openId) {
    User user = trips.findUser(openId);
    if (user == null) user = new User(openId, "旅友");
    return new Bootstrap(user, trips.findTripsForMember(openId));
  }

  @Transactional
  public Trip create(String openId, CreateTripRequest request) {
    LedgerRules.require(request != null, "旅行信息无效");
    String requestId = LedgerRules.validId(request.requestId());
    String name = LedgerRules.text(request.name(), "昵称", 20);
    User user = new User(openId, name);
    trips.upsertUser(user, System.currentTimeMillis());
    // 将用户身份和请求编号散列成旅行 ID；相同请求重试会落到同一个唯一键上。
    String id = tripId(openId, requestId);
    String inviteCode = randomHex(16);
    Trip trip = LedgerRules.createTrip(request.input(), user, id, inviteCode, System.currentTimeMillis());
    try {
      trips.insertTrip(trip);
      return trip;
    } catch (DuplicateKeyException duplicate) {
      // 相同创建请求重试会命中同一个旅行 ID；其他唯一键冲突则是邀请码碰撞。
      Trip existing = trips.findTrip(id);
      if (existing != null) {
        LedgerRules.require(existing.creatorId().equals(openId), "请求编号已被使用");
        return existing;
      }
      throw new BizException("邀请编号冲突，请重试");
    }
  }

  @Transactional
  public Trip join(String openId, JoinTripRequest request) {
    LedgerRules.require(request != null, "邀请信息无效");
    String inviteCode = LedgerRules.validId(request.inviteCode());
    User user = new User(openId, LedgerRules.text(request.name(), "昵称", 20));
    String id = trips.findTripIdByInviteCode(inviteCode);
    LedgerRules.require(id != null, "邀请不存在，请向朋友索取新的邀请");
    Trip original = trips.lockTrip(id);
    LedgerRules.require(original != null, "邀请已失效");
    Trip next = LedgerRules.joinTrip(original, user, System.currentTimeMillis());
    if (next != original) trips.saveTrip(next);
    trips.upsertUser(user, System.currentTimeMillis());
    return next;
  }

  @Transactional
  public Trip command(String openId, String tripId, Command command) {
    // 先锁定旅行主记录，再按最新状态计算命令结果；整个方法在一个数据库事务里执行。
    Trip original = trips.lockTrip(LedgerRules.validId(tripId));
    LedgerRules.require(original != null, "旅行不存在或不可访问");
    Trip next = LedgerRules.applyCommand(original, openId, command, System.currentTimeMillis());
    if (next != original) trips.saveTrip(next);
    return next;
  }

  private String tripId(String openId, String requestId) {
    try {
      byte[] digest = MessageDigest.getInstance("SHA-256")
          .digest((openId + ":" + requestId).getBytes(StandardCharsets.UTF_8));
      return "t_" + HexFormat.of().formatHex(digest).substring(0, 32);
    } catch (NoSuchAlgorithmException impossible) {
      throw new IllegalStateException("SHA-256 is not available", impossible);
    }
  }

  private static String randomHex(int bytes) {
    byte[] random = new byte[bytes];
    RANDOM.nextBytes(random);
    return HexFormat.of().formatHex(random);
  }
}
