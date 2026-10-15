package com.jiqian.controller;

import com.jiqian.auth.JwtInterceptor;
import com.jiqian.common.ApiResponse;
import com.jiqian.domain.Command;
import com.jiqian.domain.Models.Bootstrap;
import com.jiqian.domain.Models.CreateTripRequest;
import com.jiqian.domain.Models.JoinTripRequest;
import com.jiqian.domain.Models.Trip;
import com.jiqian.service.LedgerService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** HTTP 路由薄薄地转交给 LedgerService；账本权限和规则不在 Controller 中实现。 */
@RestController
@RequestMapping("/api")
public class LedgerController {
  private final LedgerService ledgerService;

  public LedgerController(LedgerService ledgerService) {
    this.ledgerService = ledgerService;
  }

  @GetMapping("/bootstrap")
  public ApiResponse<Bootstrap> bootstrap(HttpServletRequest request) {
    return ApiResponse.success(ledgerService.bootstrap(userId(request)));
  }

  @PostMapping("/trips")
  public ApiResponse<Trip> create(HttpServletRequest request, @RequestBody CreateTripRequest body) {
    return ApiResponse.success(ledgerService.create(userId(request), body));
  }

  @PostMapping("/trips/join")
  public ApiResponse<Trip> join(HttpServletRequest request, @RequestBody JoinTripRequest body) {
    return ApiResponse.success(ledgerService.join(userId(request), body));
  }

  @PostMapping("/trips/{tripId}/commands")
  public ApiResponse<Trip> command(HttpServletRequest request, @PathVariable String tripId,
                                   @RequestBody Command command) {
    return ApiResponse.success(ledgerService.command(userId(request), tripId, command));
  }

  private String userId(HttpServletRequest request) {
    return (String) request.getAttribute(JwtInterceptor.USER_ID_ATTRIBUTE);
  }
}
