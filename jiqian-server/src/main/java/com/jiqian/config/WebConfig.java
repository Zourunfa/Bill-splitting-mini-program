package com.jiqian.config;

import com.jiqian.auth.JwtInterceptor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.net.InetSocketAddress;
import java.net.Proxy;
import java.time.Duration;

/** 全局 HTTP 客户端和登录鉴权配置；登录路由放行，其他 API 都需要 JWT。 */
@Configuration
public class WebConfig implements WebMvcConfigurer {
  private final JwtInterceptor jwtInterceptor;
  private final String proxyHost;
  private final int proxyPort;

  public WebConfig(JwtInterceptor jwtInterceptor,
                   @Value("${app.wechat.proxy-host:}") String proxyHost,
                   @Value("${app.wechat.proxy-port:7890}") int proxyPort) {
    this.jwtInterceptor = jwtInterceptor;
    this.proxyHost = proxyHost;
    this.proxyPort = proxyPort;
  }

  @Bean
  public RestTemplate restTemplate() {
    // 微信 code2session 是外部网络请求，设置超时，避免登录线程一直等待。
    SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
    factory.setConnectTimeout(Duration.ofSeconds(5));
    factory.setReadTimeout(Duration.ofSeconds(5));
    if (!proxyHost.isBlank()) {
      factory.setProxy(new Proxy(Proxy.Type.HTTP, new InetSocketAddress(proxyHost, proxyPort)));
    }
    return new RestTemplate(factory);
  }

  @Override
  public void addInterceptors(InterceptorRegistry registry) {
    // 先由拦截器恢复可信用户身份，再让 Controller 调用账本业务。
    registry.addInterceptor(jwtInterceptor)
        .addPathPatterns("/api/**")
        .excludePathPatterns("/api/auth/login");
  }
}
