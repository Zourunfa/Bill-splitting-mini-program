package com.jiqian.auth;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.jiqian.common.ApiResponse;
import io.jsonwebtoken.JwtException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

import java.io.IOException;

/** 从 Bearer token 验证用户身份，并把签名中的 subject 放到请求上下文。 */
@Component
public class JwtInterceptor implements HandlerInterceptor {
  // final字段视为了防止重新赋值 static final 常量
  public static final String USER_ID_ATTRIBUTE = "jiqian.userId";
  private final JwtService jwtService;
  private final ObjectMapper objectMapper;

  public JwtInterceptor(JwtService jwtService, ObjectMapper objectMapper) {
    this.jwtService = jwtService;
    this.objectMapper = objectMapper;
  }

  @Override
  public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) throws IOException {
    String authorization = request.getHeader("Authorization");
    if (authorization == null || !authorization.startsWith("Bearer ")) {
      unauthorized(response, "登录已过期，请重新进入小程序");
      return false;
    }
    try {
      String userId = jwtService.subject(authorization.substring(7).trim());
      if (userId == null || userId.isBlank()) {
        unauthorized(response, "登录已过期，请重新进入小程序");
        return false;
      }
      request.setAttribute(USER_ID_ATTRIBUTE, userId);
      return true;
    } catch (JwtException | IllegalArgumentException error) {
      unauthorized(response, "登录已过期，请重新进入小程序");
      return false;
    }
  }

  private void unauthorized(HttpServletResponse response, String message) throws IOException {
    response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
    response.setCharacterEncoding("UTF-8");
    response.setContentType(MediaType.APPLICATION_JSON_VALUE);
    objectMapper.writeValue(response.getOutputStream(), ApiResponse.failure(message));
  }
}
