// 第 1 行：声明当前类属于哪个包
package com.jiqian;

// 第 3～6 行：导入需要使用的类
// 告诉 MyBatis 去哪里扫描 Mapper 接口
import org.mybatis.spring.annotation.MapperScan;
// 提供启动 Spring Boot 应用的方法
import org.springframework.boot.SpringApplication;
// 标记 Spring Boot 的主启动类
import org.springframework.boot.autoconfigure.SpringBootApplication;
// 启用 Spring 的声明式事务管理
import org.springframework.transaction.annotation.EnableTransactionManagement;


/** Spring Boot 启动入口，同时启用 MyBatis Mapper 扫描和声明式事务。 */
// Spring Boot 的核心注解 这是应用程序的主启动类，请以它为入口，启动 Spring 容器并自动配置应用
@SpringBootApplication
@MapperScan("com.jiqian.mapper") //这一行告诉 MyBatis：去 com.jiqian.mapper 这个包下面寻找 Mapper 接口，并为符合条件的接口创建可注入的代理对象。
@EnableTransactionManagement
public class JiqianApplication {
  public static void main(String[] args) {
    SpringApplication.run(JiqianApplication.class, args);
  }
}
