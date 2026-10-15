package com.jiqian.service;

import com.jiqian.domain.Command.AddExpense;
import com.jiqian.domain.Command.EditExpense;
import com.jiqian.domain.Models.CreateTripRequest;
import com.jiqian.domain.Models.ExpenseInput;
import com.jiqian.domain.Models.JoinTripRequest;
import com.jiqian.domain.Models.Trip;
import com.jiqian.domain.Models.TripInput;
import com.jiqian.domain.Models.User;
import com.jiqian.auth.JwtService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class LedgerServiceTest {
  @Autowired private LedgerService ledger;
  @Autowired private TripRepository trips;
  @Autowired private JwtService jwtService;
  @Autowired private MockMvc mockMvc;

  @Test
  void bootstrapRequiresAndAcceptsASignedBearerToken() throws Exception {
    mockMvc.perform(get("/api/bootstrap"))
        .andExpect(status().isUnauthorized())
        .andExpect(jsonPath("$.ok").value(false));

    String openId = "openid_http_" + UUID.randomUUID().toString().replace("-", "");
    mockMvc.perform(get("/api/bootstrap").header("Authorization", "Bearer " + jwtService.issue(openId)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.ok").value(true))
        .andExpect(jsonPath("$.data.user.id").value(openId));
  }

  @Test
  void writesAndReadsNormalizedTripRowsInsideServiceTransactions() {
    String alice = "openid_a_" + UUID.randomUUID().toString().replace("-", "");
    String bob = "openid_b_" + UUID.randomUUID().toString().replace("-", "");
    ledger.ensureUser(alice);
    Trip created = ledger.create(alice, new CreateTripRequest("create_1", "小王",
        new TripInput("川西旅行", "川西", "2026-10-01", "2026-10-07")));

    ledger.ensureUser(bob);
    Trip joined = ledger.join(bob, new JoinTripRequest(created.inviteCode(), "小李"));
    assertEquals(2, joined.members().size());

    ExpenseInput expense = new ExpenseInput("住宿", 1001, alice, List.of(bob, alice), "住宿", "2026-10-01", "");
    Trip updated = ledger.command(alice, created.id(), new AddExpense("expense_1", expense));
    Trip loaded = trips.findTrip(updated.id());
    assertNotNull(loaded);
    assertEquals(3, loaded.version());
    assertEquals(List.of(bob, alice), loaded.expenses().get(0).participantIds());
    assertEquals(501, loaded.expenses().get(0).shares().get(alice));
    assertEquals(500, loaded.expenses().get(0).shares().get(bob));
    assertEquals(1, ledger.bootstrap(alice).trips().size());

    String snapshot = com.jiqian.domain.LedgerRules.expenseSnapshot(loaded.expenses().get(0));
    ExpenseInput changed = new ExpenseInput("住宿", 2000, alice, List.of(bob, alice), "住宿", "2026-10-01", "改价");
    Trip edited = ledger.command(alice, created.id(), new EditExpense("expense_1", changed, 0, snapshot));
    assertEquals(2000, trips.findTrip(edited.id()).expenses().get(0).amount());
  }

  @Test
  void failedCommandRollsBackAndDoesNotAdvanceVersion() {
    String userId = "openid_" + UUID.randomUUID().toString().replace("-", "");
    ledger.ensureUser(userId);
    Trip created = ledger.create(userId, new CreateTripRequest("create_1", "小王",
        new TripInput("周末", "成都", "2026-10-01", "2026-10-02")));
    ExpenseInput invalid = new ExpenseInput("无效付款人", 100, "stranger", List.of(userId), "其他", "2026-10-01", "");
    assertThrows(RuntimeException.class, () -> ledger.command(userId, created.id(), new AddExpense("bad_1", invalid)));
    Trip after = trips.findTrip(created.id());
    assertEquals(1, after.version());
    assertEquals(0, after.expenses().size());
  }
}
