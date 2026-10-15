package com.jiqian.auth;

import com.jiqian.common.BizException;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.util.UriComponentsBuilder;

@Service
public class WeChatAuthService {
  private static final Logger log = LoggerFactory.getLogger(WeChatAuthService.class);
  private final RestTemplate restTemplate;
  private final ObjectMapper objectMapper;
  private final String appId;
  private final String appSecret;
  private final String code2sessionUrl;

  public WeChatAuthService(RestTemplate restTemplate,
                           ObjectMapper objectMapper,
                           @Value("${app.wechat.app-id:}") String appId,
                           @Value("${app.wechat.app-secret:}") String appSecret,
                           @Value("${app.wechat.code2session-url}") String code2sessionUrl) {
    this.restTemplate = restTemplate;
    this.objectMapper = objectMapper;
    this.appId = appId;
    this.appSecret = appSecret;
    this.code2sessionUrl = code2sessionUrl;
  }

  public String exchangeCode(String code) {
    // AppSecret 只用于服务端向微信换取 OpenID，绝不能返回小程序或写进前端包。
    if (appId.isBlank() || appSecret.isBlank()) {
      throw new BizException("微信登录尚未配置，请设置服务端 WECHAT_APP_ID 和 WECHAT_APP_SECRET");
    }
    if (code == null || code.isBlank() || code.length() > 512) {
      throw new BizException("微信登录凭证无效，请重新进入小程序");
    }
    String url = UriComponentsBuilder.fromUriString(code2sessionUrl)
        .queryParam("appid", appId)
        .queryParam("secret", appSecret)
        .queryParam("js_code", code)
        .queryParam("grant_type", "authorization_code")
        .build().encode().toUriString();
    final String responseBody;
    try {
      responseBody = restTemplate.getForObject(url, String.class);
    } catch (RestClientException error) {
      Throwable cause = error.getMostSpecificCause();
      log.warn("WeChat code2session failed; exception={}, cause={}",
          error.getClass().getSimpleName(), cause.getClass().getSimpleName());
      throw new BizException("微信登录服务暂时不可用，请稍后重试");
    }
    final WeChatSession result;
    try {
      result = responseBody == null ? null : objectMapper.readValue(responseBody, WeChatSession.class);
    } catch (JsonProcessingException error) {
      log.warn("WeChat code2session returned malformed JSON");
      throw new BizException("微信登录响应格式无效，请稍后重试");
    }
    if (result == null || result.openid() == null || result.openid().isBlank()) {
      throw new BizException("微信登录失败，请重新进入小程序");
    }
    return result.openid();
  }

  public record WeChatSession(String openid, String session_key, Integer errcode, String errmsg) {}
}
