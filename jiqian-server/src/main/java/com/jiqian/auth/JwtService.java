package com.jiqian.auth;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Date;

/** JWT 的签发与验签边界；服务端密钥由环境变量注入，不随 token 返回给客户端。 */
@Service
public class JwtService {
  private final SecretKey key;
  private final Duration ttl;

  public JwtService(@Value("${app.jwt.secret}") String secret,
                    @Value("${app.jwt.ttl:14d}") Duration ttl) {
    byte[] bytes = secret.getBytes(StandardCharsets.UTF_8);
    if (bytes.length < 32) throw new IllegalArgumentException("JWT_SECRET must be at least 32 bytes");
    this.key = Keys.hmacShaKeyFor(bytes);
    this.ttl = ttl;
  }

  public String issue(String openId) {
    // OpenID 放在签名保护的 subject 里，并设置有效期；客户端无法自行改写身份。
    Date now = new Date();
    Date expiration = new Date(now.getTime() + ttl.toMillis());
    return Jwts.builder().subject(openId).issuedAt(now).expiration(expiration).signWith(key).compact();
  }

  public String subject(String token) {
    // parseSignedClaims 同时验证签名和有效期；无效 token 会由拦截器转成 401。
    Claims claims = Jwts.parser().verifyWith(key).build().parseSignedClaims(token).getPayload();
    return claims.getSubject();
  }
}
