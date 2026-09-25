import copy
import unittest

from routing import decide, validate_contract, validate_report


def contract(**overrides):
    value = {
        "schema_version": 1, "task_id": "EXAMPLE-01", "contract_revision": 1,
        "base_commit": "a" * 40, "goal": "Update an existing local behavior",
        "acceptance_criteria": ["Existing behavior check passes"],
        "invariants": ["No future bars"], "allowed_paths": ["web/**", "server/**"],
        "context_refs": ["docs/specs/training/rules.md"], "known_risks": [],
        "forbidden_changes": ["Do not relax existing acceptance checks"],
        "forbidden_paths": ["server/private/**"], "approved_changes": [],
        "semantic_scopes": ["chart.labels"], "task_shape": "uncertain",
        "oracle": "reliable", "verification_profile": "focused",
        "budgets": {"scout_rounds": 2, "same_failure_repairs": 2,
                    "total_attempts": 4, "environment_retries": 2},
    }
    value.update(overrides)
    return value


def report(**overrides):
    value = {
        "schema_version": 1, "task_id": "EXAMPLE-01", "contract_revision": 1,
        "base_commit": "a" * 40, "observed_commit": "b" * 40,
        "status": "completed", "assessment": "local_execution",
        "facts": [{"statement": "Only this label consumes the setting",
                   "path": "web/label.ts", "line": 1, "sha256": "c" * 64}],
        "tests": [], "assumptions": [], "uninspected_areas": [],
        "unexpected_findings": [], "requested_scope": [],
        "reported_changes": [], "needs_replan": False, "artifacts": [],
    }
    value.update(overrides)
    return value


def observation(paths=None):
    return {"head": "b" * 40, "tree": "d" * 40, "changed_paths": paths or []}


class RoutingTests(unittest.TestCase):
    def test_four_initial_routes_follow_contract_not_file_count(self):
        cases = [("mechanical", "glm_direct"), ("uncertain", "glm_scout"),
                 ("requires_design", "gpt_plan_glm_execute"),
                 ("designed", "gpt_plan_glm_execute"),
                 ("continuous_judgment", "gpt_direct")]
        for shape, expected in cases:
            with self.subTest(shape=shape):
                out = decide(contract(task_shape=shape), observation(
                    ["web/file%d.ts" % i for i in range(80)]))
                self.assertEqual(expected, out["route"])
                self.assertFalse(out["can_dispatch"])
                self.assertFalse(out["can_promote"])

    def test_scout_may_continue_cheaply_only_with_complete_evidence(self):
        self.assertEqual("glm_direct", decide(contract(), observation(), report())["route"])
        for changes in [{"facts": []}, {"uninspected_areas": ["theme provider"]},
                        {"assumptions": ["SSR probably unused"]},
                        {"status": "partial"}, {"unexpected_findings": ["shared state"]}]:
            with self.subTest(changes=changes):
                self.assertNotEqual("glm_direct", decide(
                    contract(), observation(), report(**changes))["route"])

    def test_unapproved_schema_escalates_but_approved_migration_executes(self):
        observed = observation(["server/src/db.ts"])
        self.assertEqual("gpt_plan_glm_execute", decide(
            contract(task_shape="mechanical"), observed)["route"])
        out = decide(contract(task_shape="designed",
                              approved_changes=["database_schema"]), observed)
        self.assertEqual("execute_contract", out["next_action"])
        self.assertNotIn("unapproved_semantic_change", out["reason_codes"])

    def test_actual_scope_and_forbidden_paths_override_low_risk_claim(self):
        for path in ["external.txt", "server/private/data.ts"]:
            out = decide(contract(task_shape="mechanical"), observation([path]), report())
            self.assertEqual("gpt_plan_glm_execute", out["route"])
            self.assertIn("scope_violation", out["reason_codes"])

    def test_unexpected_changes_replan_and_continuous_unknowns_take_over(self):
        self.assertEqual("gpt_plan_glm_execute", decide(
            contract(), observation(), report(needs_replan=True))["route"])
        history = [{"event_id": str(i), "task_id": "EXAMPLE-01", "kind": "replan"}
                   for i in range(2)]
        self.assertEqual("gpt_direct", decide(
            contract(), observation(), report(), history)["route"])

    def test_two_repairs_count_across_jobs_but_initial_failure_does_not(self):
        history = [{"event_id": "initial", "task_id": "EXAMPLE-01",
                    "kind": "failure", "failure_fingerprint": "test/F"}]
        for index in range(2):
            out = decide(contract(task_shape="mechanical"), observation(), history=history)
            self.assertNotEqual("gpt_direct", out["route"])
            history.append({"event_id": "repair%d" % index, "job_id": "job%d" % index,
                            "task_id": "EXAMPLE-01", "kind": "repair_failed",
                            "failure_fingerprint": "test/F"})
        self.assertEqual("gpt_direct", decide(
            contract(), observation(), history=history)["route"])

    def test_other_tasks_and_duplicate_delivery_cannot_inflate_repair_count(self):
        event = {"event_id": "one", "task_id": "EXAMPLE-01",
                 "kind": "repair_failed", "failure_fingerprint": "F"}
        other = dict(event, event_id="other", task_id="OTHER-01")
        out = decide(contract(task_shape="mechanical"), observation(),
                     history=[event, event, other])
        self.assertNotEqual("gpt_direct", out["route"])

    def test_environment_failures_wait_without_expensive_escalation(self):
        history = [{"event_id": str(i), "task_id": "EXAMPLE-01",
                    "kind": "environment_failure"} for i in range(2)]
        out = decide(contract(task_shape="mechanical"), observation(), history=history)
        self.assertEqual("waiting_environment", out["next_action"])
        self.assertEqual("glm_direct", out["route"])

    def test_behavior_overlap_detected_without_path_overlap(self):
        other = contract(task_id="OTHER-01", allowed_paths=["server/**"])
        out = decide(contract(), observation(["web/label.ts"]), active=[other])
        self.assertIn("semantic_ownership_overlap", out["reason_codes"])
        self.assertEqual("gpt_plan_glm_execute", out["route"])

    def test_stale_scout_cannot_downgrade_route(self):
        out = decide(contract(), observation(), report(observed_commit="e" * 40))
        self.assertEqual("gpt_plan_glm_execute", out["route"])
        self.assertIn("stale_report", out["reason_codes"])

    def test_worker_claim_of_pass_is_never_a_verifier_proof(self):
        out = decide(contract(), observation(), report(
            tests=[{"command": "npm test", "exit_code": 0, "artifact": "unit.log"}]))
        self.assertEqual("not_evaluated", out["verification_status"])
        self.assertFalse(out["can_promote"])

    def test_missing_oracle_and_protected_policy_changes_require_judgment(self):
        for c, observed in [(contract(oracle="missing"), observation()),
                            (contract(task_shape="mechanical", allowed_paths=["**"]),
                             observation(["scripts/worktree/evidence.ts"]))]:
            self.assertEqual("gpt_plan_glm_execute", decide(c, observed)["route"])

    def test_contract_and_report_reject_malformed_versions_types_and_escape(self):
        for changes in [{"schema_version": 2}, {"schema_version": True},
                        {"allowed_paths": ["../secret"]}, {"oracle": "yes"},
                        {"acceptance_criteria": []}, {"budgets": {"scout_rounds": 0}}]:
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                validate_contract(contract(**changes))
        with self.assertRaises(ValueError):
            validate_report(report(needs_replan="false"))
        with self.assertRaises(ValueError):
            validate_report(report(facts=[{"statement": "trust me"}]))

    def test_contract_keeps_context_risks_and_forbidden_semantics_explicit(self):
        for field in ("context_refs", "known_risks", "forbidden_changes"):
            broken = contract()
            del broken[field]
            with self.subTest(field=field), self.assertRaises(ValueError):
                validate_contract(broken)

    def test_scout_budget_and_task_attempt_budget_bound_repeated_work(self):
        for kind, count, expected in [("scout_completed", 2, "gpt_plan_glm_execute"),
                                     ("execution_started", 4, "gpt_direct")]:
            history = [{"event_id": str(i), "task_id": "EXAMPLE-01", "kind": kind}
                       for i in range(count)]
            self.assertEqual(expected, decide(
                contract(), observation(), history=history)["route"])

    def test_same_evidence_replays_identically(self):
        args = (contract(), observation(), report())
        self.assertEqual(decide(*args), decide(*copy.deepcopy(args)))

    def test_scout_success_does_not_override_environment_budget(self):
        history = [{"event_id": str(i), "task_id": "EXAMPLE-01",
                    "kind": "environment_failure"} for i in range(2)]
        out = decide(contract(), observation(), report(), history)
        self.assertEqual("waiting_environment", out["next_action"])

    def test_partial_evidence_revokes_initial_mechanical_assessment(self):
        out = decide(contract(task_shape="mechanical"), observation(),
                     report(status="partial", uninspected_areas=["theme provider"]))
        self.assertEqual("glm_scout", out["route"])

    def test_dirty_observation_and_path_case_cannot_downgrade(self):
        dirty = dict(observation(), worktree_dirty=True)
        self.assertNotEqual("glm_direct", decide(contract(), dirty, report())["route"])
        out = decide(contract(task_shape="mechanical", allowed_paths=["web/Foo.ts"]),
                     observation(["web/foo.ts"]))
        self.assertIn("scope_violation", out["reason_codes"])

    def test_invalid_empty_history_does_not_reset_counters(self):
        for history in ({}, "", False):
            with self.subTest(history=history), self.assertRaises(ValueError):
                decide(contract(), observation(), history=history)


if __name__ == "__main__":
    unittest.main()
