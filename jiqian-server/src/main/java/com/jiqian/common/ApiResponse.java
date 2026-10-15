package com.jiqian.common;

import com.fasterxml.jackson.annotation.JsonInclude;

/** 所有 API 统一用 ok/data/error 包装，避免每个接口返回不同格式。 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ApiResponse<T>(boolean ok, T data, String error) {
  public static <T> ApiResponse<T> success(T data) {
    return new ApiResponse<>(true, data, null);
  }

  public static ApiResponse<Void> failure(String message) {
    return new ApiResponse<>(false, null, message);
  }
}
