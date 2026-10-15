package com.jiqian.controller;

import com.jiqian.auth.JwtService;
import com.jiqian.auth.WeChatAuthService;
import com.jiqian.common.ApiResponse;
import com.jiqian.common.BizException;
import com.jiqian.domain.Models.LoginResult;
import com.jiqian.domain.Models.User;
import com.jiqian.service.LedgerService;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 登录入口只接收 wx.login 的临时 code，用户身份由微信服务端响应确定。 */
@RestController
@RequestMapping("/api/auth")
public class AuthController {
  private final WeChatAuthService weChatAuthService;
  private final JwtService jwtService;
  private final LedgerService ledgerService;

  public AuthController(WeChatAuthService weChatAuthService, JwtService jwtService, LedgerService ledgerService) {
    this.weChatAuthService = weChatAuthService;
    this.jwtService = jwtService;
    this.ledgerService = ledgerService;
  }

  @PostMapping("/login")
  public ApiResponse<LoginResult> login(@RequestBody LoginRequest request) {
    if (request == null) throw new BizException("微信登录凭证无效，请重新进入小程序");
    String openId = weChatAuthService.exchangeCode(request.code());
    User user = ledgerService.ensureUser(openId);
    return ApiResponse.success(new LoginResult(jwtService.issue(openId), user));
  }

  public record LoginRequest(String code) {}
}
