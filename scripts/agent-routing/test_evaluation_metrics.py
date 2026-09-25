"""Synthetic-fixture tests for evaluation_metrics (offline, no network, no Git)."""
import json
import math
import pathlib
import subprocess
import sys
import tempfile
import unittest

import evaluation_metrics as em

CLI = pathlib.Path(__file__).with_name("evaluation_metrics.py")


def fingerprint(char):
    return char * 64


def experiment(**over):
    base = {
        "schema_version": 1,
        "experiment_id": "exp-1",
        "model_roles": {"strong-model": "strong", "weak-model": "weak"},
        "token_basis": "total_input_including_cache",
        "measurement_scope": "orch04-offline",
    }
    base.update(over)
    return base


def run(run_id, strategy, **over):
    base = {
        "schema_version": 1,
        "run_id": run_id,
        "case_id": "case-1",
        "case_revision": "rev-1",
        "trial_id": "t1",
        "strategy": strategy,
        "input_fingerprint": fingerprint("a"),
        "oracle_sha256": fingerprint("b"),
        "candidate_fingerprint": fingerprint("c"),
        "measurement_scope": "orch04-offline",
        "token_basis": "total_input_including_cache",
        "outcome": "accepted",
        "ground_truth": "passed",
        "verification": {"independent_verified": True, "run_id": run_id,
                         "candidate_fingerprint": fingerprint("c"),
                         "oracle_sha256": fingerprint("b")},
        "attempt_count": 1,
        "repair_count": 0,
        "elapsed_seconds": 12.5,
        "strong_interventions": 1,
        "usage_complete": {"strong": True, "weak": True},
        "measurement_source": {"strong": "provider", "weak": "provider"},
        "usage": [
            {"model_id": "strong-model", "input_tokens": 100, "output_tokens": 20,
             "cache_read_tokens": 80},
            {"model_id": "weak-model", "input_tokens": 500, "output_tokens": 50,
             "cache_read_tokens": 0},
        ],
    }
    base.update(over)
    return base


def pair(baseline_over=None, adaptive_over=None):
    return [run("rb", "baseline", **(baseline_over or {})),
            run("ra", "adaptive", **(adaptive_over or {}))]


def receipt_id():
    return "verify-" + fingerprint("9")[:32]


def evaluate(runs, exp=None):
    return em.evaluate_runs(exp if exp is not None else experiment(), runs)


class ValidationTests(unittest.TestCase):
    def test_rejects_malformed_experiment(self):
        cases = [
            ("bool schema_version", {"schema_version": True}),
            ("wrong schema_version", {"schema_version": 2}),
            ("empty experiment_id", {"experiment_id": ""}),
            ("whitespace experiment_id", {"experiment_id": "   "}),
            ("empty scope", {"measurement_scope": ""}),
            ("wrong basis", {"token_basis": "sum_of_calls"}),
            ("empty roles", {"model_roles": {}}),
            ("unknown role", {"model_roles": {"strong-model": "medium"}}),
            ("whitespace model key", {"model_roles": {"   ": "strong"}}),
        ]
        for label, over in cases:
            with self.subTest(case=label):
                self.assertRaises(ValueError, em.evaluate_runs, experiment(**over), [])

    def test_single_role_model_map_is_valid(self):
        single = experiment(model_roles={"strong-model": "strong"})
        record = run("rb", "baseline")
        record["usage"] = [record["usage"][0]]
        record["usage_complete"] = {"strong": True, "weak": False}
        report = em.evaluate_runs(single, [record])
        self.assertEqual(120, report["per_strategy"]["baseline"]["tokens"]["strong"])
        self.assertIsNone(report["per_strategy"]["baseline"]["tokens"]["weak"])
        self.assertEqual({"strong-model": "strong"},
                         report["generated_from"]["model_roles"])

    def test_whitespace_only_identifiers_rejected(self):
        cases = [
            ("run_id", lambda r: r.update(run_id="  ")),
            ("case_id", lambda r: r.update(case_id=" ")),
            ("trial_id", lambda r: r.update(trial_id="\t")),
            ("scope", lambda r: r.update(measurement_scope="   ")),
            ("verification receipt id", lambda r:
                r["verification"].update(run_id="  ")),
            ("measurement source", lambda r:
                r["measurement_source"].update(strong="   ")),
            ("usage model id", lambda r: r["usage"][0].update(model_id=" ")),
        ]
        for label, mutate in cases:
            with self.subTest(case=label):
                record = run("rb", "baseline")
                mutate(record)
                self.assertRaises(ValueError, em.evaluate_runs, experiment(), [record])

    def test_rejects_runs_container_that_is_not_a_list(self):
        self.assertRaises(ValueError, em.evaluate_runs, experiment(), {"run": run("r", "baseline")})

    def test_rejects_unknown_usage_model(self):
        broken = run("rb", "baseline")
        broken["usage"].append({"model_id": "mystery-model", "input_tokens": 1,
                                "output_tokens": 1, "cache_read_tokens": 0})
        self.assertRaises(ValueError, em.evaluate_runs, experiment(), [broken])

    def test_rejects_bool_negative_and_nonfinite_values(self):
        def with_usage_row(row_over):
            def mutate(record):
                record["usage"][0].update(row_over)
            return mutate

        cases = [
            ("bool attempt_count", lambda r: r.update(attempt_count=True)),
            ("zero attempt_count", lambda r: r.update(attempt_count=0)),
            ("bool repair_count", lambda r: r.update(repair_count=True)),
            ("negative repair_count", lambda r: r.update(repair_count=-1)),
            ("repair_count >= attempts", lambda r: r.update(repair_count=1)),
            ("bool strong_interventions", lambda r: r.update(strong_interventions=True)),
            ("negative strong_interventions", lambda r: r.update(strong_interventions=-1)),
            ("bool elapsed", lambda r: r.update(elapsed_seconds=True)),
            ("infinite elapsed", lambda r: r.update(elapsed_seconds=math.inf)),
            ("nan elapsed", lambda r: r.update(elapsed_seconds=math.nan)),
            ("negative elapsed", lambda r: r.update(elapsed_seconds=-0.5)),
            ("int verification flag", lambda r:
                r["verification"].update(independent_verified=1)),
            ("int usage_complete flag", lambda r:
                r["usage_complete"].update(strong=1)),
            ("empty source", lambda r: r["measurement_source"].update(strong="")),
            ("extra field", lambda r: r.update(sneaky_extra=1)),
            ("negative input tokens", with_usage_row({"input_tokens": -1})),
            ("bool input tokens", with_usage_row({"input_tokens": True})),
            ("bool cache tokens", with_usage_row({"cache_read_tokens": True})),
            ("cache exceeds input", with_usage_row({"cache_read_tokens": 121})),
            ("unknown outcome", lambda r: r.update(outcome="skipped")),
            ("unknown ground truth", lambda r: r.update(ground_truth="maybe")),
            ("bad fingerprint", lambda r: r.update(input_fingerprint="zz")),
        ]
        for label, mutate in cases:
            with self.subTest(case=label):
                record = run("rb", "baseline")
                mutate(record)
                self.assertRaises(ValueError, em.evaluate_runs, experiment(), [record])

    def test_rejects_missing_required_field(self):
        record = run("rb", "baseline")
        del record["candidate_fingerprint"]
        self.assertRaises(ValueError, em.evaluate_runs, experiment(), [record])

    def test_cache_is_included_in_input_not_added_again(self):
        report = evaluate(pair())
        baseline = report["per_strategy"]["baseline"]["tokens"]
        self.assertEqual(120, baseline["strong"])
        self.assertEqual(550, baseline["weak"])


class JsonInputTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="eval-metrics-test-")
        self.root = pathlib.Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def write(self, name, payload):
        path = self.root / name
        path.write_bytes(payload)
        return path

    def test_malformed_json_rejected(self):
        path = self.write("bad.json", b"{oops")
        self.assertRaises(ValueError, em.read_input, path)

    def test_duplicate_json_key_rejected(self):
        path = self.write("dup.json",
                          b'{"experiment": null, "experiment": null, "runs": []}')
        self.assertRaises(ValueError, em.read_input, path)

    def test_nonfinite_json_constant_rejected(self):
        path = self.write("nan.json", b'{"experiment": NaN, "runs": []}')
        self.assertRaises(ValueError, em.read_input, path)

    def test_oversized_json_rejected(self):
        path = self.write("big.json", b"x" * (em.MAX_INPUT_BYTES + 1))
        self.assertRaises(ValueError, em.read_input, path)

    def test_input_within_limit_parses(self):
        payload = {"experiment": experiment(), "runs": pair()}
        path = self.write("ok.json", json.dumps(payload).encode("utf-8"))
        parsed = em.read_input(path)
        self.assertEqual("exp-1", parsed["experiment"]["experiment_id"])


class PairingTests(unittest.TestCase):
    def test_one_baseline_plus_one_adaptive_form_a_pair(self):
        report = evaluate(pair())
        self.assertEqual(1, len(report["pairs"]))
        self.assertEqual([], report["unmatched_runs"])
        pair_record = report["pairs"][0]
        self.assertTrue(pair_record["compatible"])
        self.assertTrue(pair_record["conditional_on_success"])
        self.assertEqual(0, pair_record["deltas"]["attempt_count"])

    def test_duplicate_strategy_key_rejected_even_if_revision_differs(self):
        runs = [run("rb", "baseline"), run("rb2", "baseline", case_revision="rev-2")]
        self.assertRaises(ValueError, em.evaluate_runs, experiment(), runs)

    def test_duplicate_run_id_rejected(self):
        runs = [run("rb", "baseline"), run("rb", "adaptive", trial_id="t2")]
        self.assertRaises(ValueError, em.evaluate_runs, experiment(), runs)

    def test_unmatched_run_is_reported_not_silently_dropped(self):
        report = evaluate([run("rb", "baseline")])
        self.assertEqual(1, len(report["unmatched_runs"]))
        entry = report["unmatched_runs"][0]
        self.assertEqual("rb", entry["run_id"])
        self.assertEqual("baseline", entry["strategy"])
        self.assertTrue(any("counterpart" in reason for reason in entry["reasons"]))
        self.assertEqual([], report["pairs"])
        self.assertFalse(report["overall"]["comparison_valid"])
        self.assertTrue(any("counterpart" in reason
                            for reason in report["overall"]["validity_reasons"]))


class CompatibilityTests(unittest.TestCase):
    def assert_incompatible(self, runs, expected_fragment):
        report = evaluate(runs)
        pair_record = report["pairs"][0]
        self.assertFalse(pair_record["compatible"])
        self.assertTrue(any(expected_fragment in reason
                            for reason in pair_record["incompatibility_reasons"]),
                        pair_record["incompatibility_reasons"])
        for field in ("attempt_count", "repair_count", "strong_interventions",
                      "elapsed_seconds", "strong_tokens", "weak_tokens"):
            self.assertIsNone(pair_record["deltas"][field], field)
        self.assertFalse(report["overall"]["comparison_valid"])
        self.assertTrue(any("incompatible pair" in reason
                            for reason in report["overall"]["validity_reasons"]))

    def test_revision_mismatch(self):
        self.assert_incompatible(pair(adaptive_over={"case_revision": "rev-2"}),
                                 "case_revision")

    def test_oracle_mismatch(self):
        self.assert_incompatible(pair(adaptive_over={"oracle_sha256": fingerprint("d")}),
                                 "oracle_sha256")

    def test_input_fingerprint_mismatch(self):
        self.assert_incompatible(pair(adaptive_over={"input_fingerprint": fingerprint("e")}),
                                 "input_fingerprint")

    def test_scope_mismatch_between_strategies(self):
        self.assert_incompatible(pair(adaptive_over={"measurement_scope": "other-scope"}),
                                 "measurement_scope differs")

    def test_basis_mismatch_between_strategies(self):
        self.assert_incompatible(pair(adaptive_over={"token_basis": "sum_of_calls"}),
                                 "token_basis differs")

    def test_scope_conformance_to_experiment(self):
        over = {"measurement_scope": "other-scope"}
        self.assert_incompatible(pair(baseline_over=over, adaptive_over=over),
                                 "does not match the experiment")

    def test_strong_source_mismatch_blocks_strong_comparison_only(self):
        over = {"measurement_source": {"strong": "estimated", "weak": "provider"}}
        report = evaluate(pair(adaptive_over=over))
        pair_record = report["pairs"][0]
        self.assertTrue(pair_record["compatible"])
        self.assertFalse(pair_record["measurement_source_match"]["strong"])
        self.assertIsNone(pair_record["deltas"]["strong_tokens"])
        self.assertIsNotNone(pair_record["deltas"]["weak_tokens"])
        self.assertFalse(report["overall"]["comparison_valid"])
        self.assertTrue(any("strong measurement sources" in reason
                            for reason in report["overall"]["validity_reasons"]))
        self.assertIsNone(report["overall"]["strong_tokens"]["delta"])

    def test_weak_source_mismatch_blocks_weak_comparison_only(self):
        over = {"measurement_source": {"strong": "provider", "weak": "estimated"}}
        report = evaluate(pair(adaptive_over=over))
        self.assertTrue(report["overall"]["comparison_valid"])
        self.assertIsNone(report["overall"]["weak_tokens"]["delta"])
        self.assertIsNotNone(report["overall"]["strong_tokens"]["delta"])
        self.assertTrue(any("weak measurement sources" in reason
                            for reason in report["overall"]["weak_tokens"]["delta_reasons"]))


class QualityTests(unittest.TestCase):
    def test_false_acceptance_is_retained_and_counted(self):
        report = evaluate(pair(baseline_over={"ground_truth": "failed"}))
        self.assertEqual(1, len(report["quality_violations"]))
        self.assertIn("false_acceptance", report["quality_violations"][0]["kinds"])
        self.assertEqual(1, report["per_strategy"]["baseline"]["false_acceptance_count"])
        self.assertEqual(1, report["per_strategy"]["baseline"]["run_count"])
        self.assertEqual(1, report["per_strategy"]["baseline"]["quality_violation_count"])
        self.assertFalse(report["overall"]["comparison_valid"])
        self.assertTrue(any("false acceptance" in reason
                            for reason in report["overall"]["validity_reasons"]))

    def assert_binding_violation(self, verification_over, kind):
        record = run("rb", "baseline")
        record["verification"].update(verification_over)
        report = evaluate([record, run("ra", "adaptive")])
        kinds = report["quality_violations"][0]["kinds"]
        self.assertIn(kind, kinds)
        self.assertFalse(report["per_strategy"]["baseline"]["qualified_delivery_count"])
        self.assertFalse(report["overall"]["comparison_valid"])
        self.assertTrue(any("binding" in reason
                            for reason in report["overall"]["validity_reasons"]),
                        report["overall"]["validity_reasons"])

    def test_unverified_acceptance_is_a_violation(self):
        self.assert_binding_violation({"independent_verified": False}, "unverified_acceptance")

    def test_missing_verification_receipt_id_is_a_violation(self):
        self.assert_binding_violation({"run_id": None}, "missing_verification_id")

    def test_verifier_receipt_id_may_differ_from_run_id(self):
        record = run("rb", "baseline")
        record["verification"]["run_id"] = receipt_id()
        adaptive = run("ra", "adaptive")
        adaptive["verification"]["run_id"] = "verify-d957804fb9174558a622b2f1b5df611f"
        report = evaluate([record, adaptive])
        self.assertEqual([], report["quality_violations"])
        for strategy in ("baseline", "adaptive"):
            self.assertEqual(1, report["per_strategy"][strategy]["qualified_delivery_count"])
        self.assertTrue(report["overall"]["comparison_valid"])
        self.assertFalse(any("binding" in reason
                             for reason in report["overall"]["validity_reasons"]))

    def test_binding_fingerprint_mismatch_is_a_violation(self):
        self.assert_binding_violation({"candidate_fingerprint": fingerprint("e")},
                                      "binding_mismatch")

    def test_false_rejection_is_reported(self):
        report = evaluate(pair(baseline_over={"outcome": "rejected",
                                              "ground_truth": "passed"}))
        self.assertEqual(1, len(report["false_rejections"]))
        self.assertEqual("rb", report["false_rejections"][0]["run_id"])
        self.assertEqual(1, report["per_strategy"]["baseline"]["false_rejection_count"])
        self.assertEqual(0, report["per_strategy"]["baseline"]["qualified_delivery_count"])
        self.assertEqual(1, report["per_strategy"]["adaptive"]["qualified_delivery_count"])
        self.assertFalse(report["overall"]["comparison_valid"])
        self.assertTrue(any("no qualified deliveries for strategy 'baseline'" in reason
                            for reason in report["overall"]["validity_reasons"]))

    def test_unknown_quality_blocks_overall_comparison(self):
        report = evaluate(pair(adaptive_over={"ground_truth": "unknown"}))
        self.assertEqual(1, report["per_strategy"]["adaptive"]["unknown_quality_count"])
        self.assertFalse(report["overall"]["comparison_valid"])
        self.assertTrue(any("unknown ground-truth quality" in reason
                            for reason in report["overall"]["validity_reasons"]))
        self.assertIsNone(report["pairs"][0]["deltas"]["strong_tokens"])

    def test_no_qualified_deliveries_invalidates_savings_comparison(self):
        failed = {"outcome": "failed", "ground_truth": "failed",
                  "candidate_fingerprint": None,
                  "verification": {"independent_verified": False, "run_id": None,
                                   "candidate_fingerprint": None, "oracle_sha256": None}}
        report = evaluate(pair(baseline_over=failed,
                               adaptive_over={**failed, "usage": []}))
        for strategy in ("baseline", "adaptive"):
            metrics = report["per_strategy"][strategy]
            self.assertEqual(0, metrics["qualified_delivery_count"])
            self.assertIsNone(metrics["cost_per_qualified_delivery"])
        self.assertFalse(report["overall"]["comparison_valid"])
        self.assertTrue(any("no qualified deliveries for strategy 'adaptive'" in reason
                            for reason in report["overall"]["validity_reasons"]))
        self.assertTrue(any("no qualified deliveries for strategy 'baseline'" in reason
                            for reason in report["overall"]["validity_reasons"]))
        self.assertIsNone(report["overall"]["strong_tokens"]["delta"])
        self.assertIsNone(report["overall"]["strong_tokens"]["relative_change"])
        self.assertEqual(120, report["per_strategy"]["baseline"]["tokens"]["strong"])
        self.assertEqual(0, report["per_strategy"]["adaptive"]["tokens"]["strong"])
        self.assertIsNone(report["pairs"][0]["deltas"]["strong_tokens"])
        self.assertEqual(0, report["pairs"][0]["deltas"]["attempt_count"])


class MetricTests(unittest.TestCase):
    def test_known_zero_stays_zero_and_unknown_stays_null(self):
        baseline = run("rb", "baseline")
        baseline["usage"] = []
        adaptive = run("ra", "adaptive")
        adaptive["usage_complete"] = {"strong": False, "weak": True}
        adaptive["usage"] = [adaptive["usage"][1]]
        report = evaluate([baseline, adaptive])
        self.assertEqual(0, report["per_strategy"]["baseline"]["tokens"]["strong"])
        self.assertIsNone(report["per_strategy"]["adaptive"]["tokens"]["strong"])
        self.assertEqual(["ra"],
                         report["per_strategy"]["adaptive"]["tokens_unknown_run_ids"]["strong"])
        self.assertEqual(0.0,
                         report["per_strategy"]["baseline"]["cost_per_qualified_delivery"])
        self.assertIsNone(report["per_strategy"]["adaptive"]["cost_per_qualified_delivery"])

    def test_failed_runs_remain_in_counts_and_aggregate_cost(self):
        failed = run("rb-failed", "baseline", trial_id="t2", outcome="failed",
                     ground_truth="failed", candidate_fingerprint=None,
                     attempt_count=2, repair_count=1, strong_interventions=2,
                     elapsed_seconds=20.0,
                     verification={"independent_verified": False, "run_id": None,
                                   "candidate_fingerprint": None, "oracle_sha256": None})
        failed["usage"][0] = {"model_id": "strong-model", "input_tokens": 50,
                              "output_tokens": 20, "cache_read_tokens": 0}
        report = evaluate([run("rb", "baseline"), failed])
        metrics = report["per_strategy"]["baseline"]
        self.assertEqual(2, metrics["run_count"])
        self.assertEqual(190, metrics["tokens"]["strong"])
        self.assertEqual(3, metrics["attempt_count_total"])
        self.assertEqual(1, metrics["repair_count_total"])
        self.assertEqual(3, metrics["strong_interventions_total"])
        self.assertEqual(32.5, metrics["elapsed_seconds_total"])
        self.assertEqual(1, metrics["outcome_counts"]["failed"])
        self.assertEqual([], report["quality_violations"])
        self.assertFalse(report["overall"]["comparison_valid"])

    def test_baseline_zero_gives_null_relative_change_not_division_error(self):
        baseline = run("rb", "baseline")
        baseline["usage"] = []
        report = evaluate([baseline, run("ra", "adaptive")])
        overall = report["overall"]
        self.assertTrue(overall["comparison_valid"])
        self.assertEqual(120, overall["strong_tokens"]["delta"])
        self.assertIsNone(overall["strong_tokens"]["relative_change"])
        self.assertTrue(any("baseline" in reason and "0" in reason
                            for reason in overall["strong_tokens"]["relative_change_reasons"]))

    def test_happy_path_pair_and_overall(self):
        adaptive = run("ra", "adaptive",
                       strong_interventions=0, elapsed_seconds=8.0)
        adaptive["usage"][0] = {"model_id": "strong-model", "input_tokens": 40,
                                "output_tokens": 20, "cache_read_tokens": 0}
        report = evaluate([run("rb", "baseline"), adaptive])
        self.assertTrue(report["overall"]["comparison_valid"])
        self.assertEqual([], report["overall"]["validity_reasons"])
        overall = report["overall"]
        self.assertEqual(-60, overall["strong_tokens"]["delta"])
        self.assertAlmostEqual(-0.5, overall["strong_tokens"]["relative_change"])
        self.assertAlmostEqual(120.0,
                               overall["cost_per_qualified_delivery"]["baseline"])
        self.assertAlmostEqual(60.0,
                               overall["cost_per_qualified_delivery"]["adaptive"])
        self.assertEqual(-1, overall["strong_interventions"]["delta"])
        self.assertAlmostEqual(-4.5, overall["elapsed_seconds"]["delta"])
        pair_record = report["pairs"][0]
        self.assertTrue(pair_record["conditional_on_success"])
        self.assertEqual(-60, pair_record["deltas"]["strong_tokens"])
        self.assertFalse(report["can_promote"])
        self.assertTrue(report["advisory_only"])

    def test_missing_strong_counters_fail_overall_comparison(self):
        rows = pair()
        for row in rows:
            row["usage_complete"]["strong"] = False
        report = evaluate(rows)
        self.assertFalse(report["overall"]["comparison_valid"])
        self.assertTrue(any("strong token totals unknown" in reason
                            for reason in report["overall"]["validity_reasons"]),
                        report["overall"]["validity_reasons"])
        self.assertIsNone(report["overall"]["strong_tokens"]["delta"])
        self.assertIsNone(report["overall"]["strong_tokens"]["relative_change"])

    def test_strategy_without_runs_has_null_totals_not_zero(self):
        report = evaluate([run("ra", "adaptive")])
        baseline = report["per_strategy"]["baseline"]
        self.assertEqual(0, baseline["run_count"])
        self.assertEqual(0, baseline["attempt_count_total"])
        self.assertEqual(0, baseline["repair_count_total"])
        self.assertIsNone(baseline["tokens"]["strong"])
        self.assertIsNone(baseline["tokens"]["weak"])
        self.assertIsNone(baseline["elapsed_seconds_total"])
        self.assertIsNone(baseline["strong_interventions_total"])

    def test_mixed_basis_or_source_does_not_sum_incompatible_measurements(self):
        for category in ("basis", "source"):
            with self.subTest(case=category):
                rows = [run("b1", "baseline"), run("a1", "adaptive"),
                        run("b2", "baseline", trial_id="t2"),
                        run("a2", "adaptive", trial_id="t2")]
                for row in rows[2:]:
                    if category == "basis":
                        row["token_basis"] = "uncached_input"
                    else:
                        row["measurement_source"]["strong"] = "estimated"
                report = evaluate(rows)
                adaptive = report["per_strategy"]["adaptive"]
                self.assertIsNone(adaptive["tokens"]["strong"])
                self.assertIsNone(adaptive["cost_per_qualified_delivery"])
                self.assertTrue(adaptive["aggregate_reasons"], category)
                if category == "basis":
                    self.assertTrue(any("mixed token basis" in reason
                                        for reason in adaptive["aggregate_reasons"]))
                else:
                    self.assertTrue(any("mixed measurement sources" in reason
                                        for reason in adaptive["aggregate_reasons"]))
                    self.assertEqual(1100, adaptive["tokens"]["weak"])
                self.assertEqual(25.0, adaptive["elapsed_seconds_total"])
                self.assertEqual([120, 120],
                                 [record["tokens"]["strong"]
                                  for record in report["run_records"]
                                  if record["strategy"] == "adaptive"])
                self.assertFalse(report["overall"]["comparison_valid"])

    def test_orch03_shaped_record_reports_unknown_savings(self):
        shaped_experiment = experiment(
            experiment_id="orch04-observed-pilot",
            model_roles={"strong-model": "strong", "GLM-5.3-Flash": "weak"})
        record = run("ORCH-03-PILOT-complete", "adaptive",
                     case_revision="1", trial_id="observed-20260925",
                     attempt_count=3, repair_count=2,
                     strong_interventions=None, elapsed_seconds=None,
                     usage_complete={"strong": False, "weak": True},
                     measurement_source={"strong": "unknown", "weak": "provider"})
        record["usage"] = [{"model_id": "GLM-5.3-Flash", "input_tokens": 1331558,
                            "output_tokens": 18604, "cache_read_tokens": 1206080}]
        record["verification"]["run_id"] = "verify-d957804fb9174558a622b2f1b5df611f"
        report = evaluate([record], shaped_experiment)
        self.assertIsNone(report["per_strategy"]["adaptive"]["tokens"]["strong"])
        self.assertEqual(1350162, report["per_strategy"]["adaptive"]["tokens"]["weak"])
        self.assertEqual(1, report["per_strategy"]["adaptive"]["qualified_delivery_count"])
        self.assertEqual([], report["quality_violations"])
        self.assertEqual(1, len(report["unmatched_runs"]))
        self.assertFalse(report["overall"]["comparison_valid"])
        self.assertIsNone(report["overall"]["strong_tokens"]["delta"])
        self.assertTrue(any("no runs recorded for strategy 'baseline'" in reason
                            for reason in report["overall"]["validity_reasons"]))
        self.assertFalse(report["can_promote"])


class ExperimentAggregationTests(unittest.TestCase):
    def test_uniform_wrong_token_basis_has_no_derived_token_cost(self):
        rows = pair({"token_basis": "uncached_input"}, {"token_basis": "uncached_input"})
        report = evaluate(rows)
        for strategy in ("baseline", "adaptive"):
            value = report["per_strategy"][strategy]
            self.assertIsNone(value["tokens"]["strong"])
            self.assertIsNone(value["tokens"]["weak"])
            self.assertIsNone(value["cost_per_qualified_delivery"])
            self.assertEqual(12.5, value["elapsed_seconds_total"])
            self.assertTrue(value["aggregate_reasons"])
        self.assertEqual([120, 120], [r["tokens"]["strong"] for r in report["run_records"]])

    def test_wrong_scope_cannot_aggregate_time_or_interventions(self):
        rows = pair({"measurement_scope": "partial-work"}, {"measurement_scope": "partial-work"})
        report = evaluate(rows)
        for strategy in ("baseline", "adaptive"):
            value = report["per_strategy"][strategy]
            self.assertIsNone(value["elapsed_seconds_total"])
            self.assertIsNone(value["strong_interventions_total"])
            self.assertEqual(1, value["attempt_count_total"])
            self.assertEqual(1, value["run_count"])
        self.assertEqual([12.5, 12.5], [r["elapsed_seconds"] for r in report["run_records"]])


class CommandLineTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="eval-metrics-cli-")
        self.root = pathlib.Path(self.temp.name)
        self.input_path = self.root / "input.json"
        self.input_path.write_text(
            json.dumps({"experiment": experiment(), "runs": pair()}), encoding="utf-8")
        self.out = self.root / "report.json"

    def tearDown(self):
        self.temp.cleanup()

    def run_cli(self, input_path=None, out=None):
        return subprocess.run(
            [sys.executable, str(CLI), "--input", str(input_path or self.input_path),
             "--out", str(out or self.out)],
            capture_output=True, text=True)

    def test_writes_new_report_and_refuses_to_overwrite(self):
        first = self.run_cli()
        self.assertEqual(0, first.returncode, first.stderr)
        written = self.out.read_bytes()
        report = json.loads(written.decode("utf-8"))
        self.assertFalse(report["can_promote"])
        self.assertEqual(2, report["generated_from"]["run_count"])
        second = self.run_cli()
        self.assertEqual(1, second.returncode)
        self.assertIn("already exists", second.stderr)
        self.assertEqual(written, self.out.read_bytes())

    def test_malformed_input_fails_without_writing_output(self):
        bad = self.root / "bad.json"
        bad.write_text("{nope", encoding="utf-8")
        run = self.run_cli(input_path=bad)
        self.assertEqual(1, run.returncode)
        self.assertFalse(self.out.exists())

    def test_unknown_model_fails_without_writing_output(self):
        payload = {"experiment": experiment(),
                   "runs": [run("rb", "baseline", usage=[
                       {"model_id": "mystery-model", "input_tokens": 1,
                        "output_tokens": 1, "cache_read_tokens": 0}])]}
        bad = self.root / "unknown-model.json"
        bad.write_text(json.dumps(payload), encoding="utf-8")
        process = self.run_cli(input_path=bad)
        self.assertEqual(1, process.returncode)
        self.assertIn("model_roles", process.stderr)
        self.assertFalse(self.out.exists())


if __name__ == "__main__":
    unittest.main()
