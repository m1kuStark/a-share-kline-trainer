"""Offline evaluation metrics comparing baseline vs adaptive strategies (ORCH-04 slice B).

Pure-stdlib and offline: no model or network calls, no Git access, no receipts. The
input is one fixed experiment description plus complete logical run records (all
scouts, execution, repairs and review within the declared measurement scope, never
a cherry-picked best attempt). The output is an advisory report with
can_promote=false; declaration fields inside the input are not authenticated by
this tool and cannot create acceptance receipts.

Missing measurements stay unknown (null) and are never turned into zero. Failed,
rejected and unknown runs keep counting toward run counts and aggregate cost, so
failure costs cannot disappear from the totals. Only accepted + ground truth
passed + a verified binding to the current candidate and oracle counts as a
qualified delivery; every other accepted run stays visible as a quality violation.
"""
import argparse
import json
import math
import pathlib
import sys

sys.dont_write_bytecode = True

MAX_INPUT_BYTES = 1024 * 1024
TOKEN_BASIS = "total_input_including_cache"
STRATEGIES = ("baseline", "adaptive")
OUTCOMES = ("accepted", "rejected", "failed", "unknown")
TRUTHS = ("passed", "failed", "unknown")
ROLES = ("strong", "weak")
BINDING_VIOLATIONS = ("unverified_acceptance", "missing_verification_id", "binding_mismatch")
_HEX = set("0123456789abcdefABCDEF")

_EXPERIMENT_KEYS = ("schema_version", "experiment_id", "model_roles", "token_basis",
                    "measurement_scope")
_RUN_KEYS = ("schema_version", "run_id", "case_id", "case_revision", "trial_id", "strategy",
             "input_fingerprint", "oracle_sha256", "candidate_fingerprint", "measurement_scope",
             "token_basis", "outcome", "ground_truth", "verification", "attempt_count",
             "repair_count", "elapsed_seconds", "strong_interventions", "usage_complete",
             "measurement_source", "usage")
_RUN_OPTIONAL = ("notes",)
_VERIFICATION_KEYS = ("independent_verified", "run_id", "candidate_fingerprint", "oracle_sha256")
_ROLE_MAP_KEYS = ("strong", "weak")
_USAGE_KEYS = ("model_id", "input_tokens", "output_tokens", "cache_read_tokens")
_USAGE_OPTIONAL = ("notes",)


def _fail(message):
    raise ValueError(message)


def _object(value, name, required, optional=()):
    if not isinstance(value, dict):
        _fail(name + " must be an object")
    missing = sorted(key for key in required if key not in value)
    if missing:
        _fail(name + " missing required field(s): " + ", ".join(missing))
    allowed = set(required) | set(optional)
    unknown = sorted(repr(key) for key in value if key not in allowed)
    if unknown:
        _fail(name + " has unknown field(s): " + ", ".join(unknown))


def _text(value, name, allow_empty=False):
    if not isinstance(value, str) or (not allow_empty and not value.strip()):
        _fail(name + " must be a non-empty string")


def _hex64(value, name):
    _text(value, name)
    if len(value) != 64 or any(char not in _HEX for char in value):
        _fail(name + " must be 64 hex characters")


def _count(value, name, minimum):
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        _fail(name + " must be an integer >= " + str(minimum) + "; booleans rejected")


def _optional_count(value, name, minimum):
    if value is not None:
        _count(value, name, minimum)


def _optional_nonneg_number(value, name):
    if value is None:
        return
    if (isinstance(value, bool) or not isinstance(value, (int, float))
            or not math.isfinite(value) or value < 0):
        _fail(name + " must be a finite number >= 0 or null; booleans rejected")


def _optional_text(value, name):
    if value is not None:
        _text(value, name, allow_empty=True)


def validate_experiment(experiment):
    _object(experiment, "experiment", _EXPERIMENT_KEYS)
    _count(experiment["schema_version"], "experiment.schema_version", 0)
    if experiment["schema_version"] != 1:
        _fail("experiment.schema_version must be 1")
    _text(experiment["experiment_id"], "experiment.experiment_id")
    _text(experiment["measurement_scope"], "experiment.measurement_scope")
    _text(experiment["token_basis"], "experiment.token_basis")
    if experiment["token_basis"] != TOKEN_BASIS:
        _fail("experiment.token_basis must be '" + TOKEN_BASIS + "'")
    roles = experiment["model_roles"]
    if not isinstance(roles, dict) or not roles:
        _fail("experiment.model_roles must be a non-empty object")
    role_models = {role: [] for role in ROLES}
    for model_id, role in roles.items():
        _text(model_id, "experiment.model_roles key")
        if role not in ROLES:
            _fail("experiment.model_roles values must be 'strong' or 'weak'; got " + repr(role))
        role_models[role].append(model_id)
    return {
        "experiment_id": experiment["experiment_id"],
        "measurement_scope": experiment["measurement_scope"],
        "token_basis": experiment["token_basis"],
        "model_roles": dict(roles),
        "role_models": {role: sorted(ids) for role, ids in role_models.items()},
    }


def _validate_role_map(value, name, check):
    _object(value, name, _ROLE_MAP_KEYS)
    for role in ROLES:
        check(value[role], name + "." + role)


def _validate_verification(value):
    _object(value, "run.verification", _VERIFICATION_KEYS)
    if not isinstance(value["independent_verified"], bool):
        _fail("run.verification.independent_verified must be a boolean")
    if value["run_id"] is not None:
        _text(value["run_id"], "run.verification.run_id")
    if value["candidate_fingerprint"] is not None:
        _hex64(value["candidate_fingerprint"], "run.verification.candidate_fingerprint")
    if value["oracle_sha256"] is not None:
        _hex64(value["oracle_sha256"], "run.verification.oracle_sha256")
    return dict(value)


def _validate_usage(rows, meta):
    if not isinstance(rows, list):
        _fail("run.usage must be an array")
    known = meta["model_roles"]
    seen = set()
    normalized = []
    for index, row in enumerate(rows):
        name = "run.usage[" + str(index) + "]"
        _object(row, name, _USAGE_KEYS, _USAGE_OPTIONAL)
        _text(row["model_id"], name + ".model_id")
        if row["model_id"] not in known:
            _fail(name + ".model_id is not declared in experiment.model_roles: " + row["model_id"])
        if row["model_id"] in seen:
            _fail(name + " duplicates the row for model: " + row["model_id"])
        seen.add(row["model_id"])
        for field in ("input_tokens", "output_tokens", "cache_read_tokens"):
            _optional_count(row[field], name + "." + field, 0)
        if (row["cache_read_tokens"] is not None and row["input_tokens"] is not None
                and row["cache_read_tokens"] > row["input_tokens"]):
            _fail(name + ".cache_read_tokens exceeds input_tokens; cache is included in input,"
                         " never added again")
        _optional_text(row.get("notes"), name + ".notes")
        normalized.append({"model_id": row["model_id"], "input_tokens": row["input_tokens"],
                           "output_tokens": row["output_tokens"],
                           "cache_read_tokens": row["cache_read_tokens"],
                           "notes": row.get("notes")})
    return normalized


def validate_run(run, meta):
    _object(run, "run", _RUN_KEYS, _RUN_OPTIONAL)
    _count(run["schema_version"], "run.schema_version", 0)
    if run["schema_version"] != 1:
        _fail("run.schema_version must be 1")
    for field in ("run_id", "case_id", "case_revision", "trial_id", "measurement_scope",
                  "token_basis"):
        _text(run[field], "run." + field)
    if run["strategy"] not in STRATEGIES:
        _fail("run.strategy must be 'baseline' or 'adaptive'; got " + repr(run["strategy"]))
    if run["outcome"] not in OUTCOMES:
        _fail("run.outcome must be one of " + ", ".join(OUTCOMES))
    if run["ground_truth"] not in TRUTHS:
        _fail("run.ground_truth must be one of " + ", ".join(TRUTHS))
    _hex64(run["input_fingerprint"], "run.input_fingerprint")
    _hex64(run["oracle_sha256"], "run.oracle_sha256")
    if run["candidate_fingerprint"] is not None:
        _hex64(run["candidate_fingerprint"], "run.candidate_fingerprint")
    _count(run["attempt_count"], "run.attempt_count", 1)
    _count(run["repair_count"], "run.repair_count", 0)
    if run["repair_count"] >= run["attempt_count"]:
        _fail("run.repair_count must be < run.attempt_count")
    _optional_nonneg_number(run["elapsed_seconds"], "run.elapsed_seconds")
    _optional_count(run["strong_interventions"], "run.strong_interventions", 0)
    _optional_text(run.get("notes"), "run.notes")
    _validate_role_map(run["usage_complete"], "run.usage_complete",
                       lambda value, name: None if isinstance(value, bool) else
                       _fail(name + " must be a boolean"))
    _validate_role_map(run["measurement_source"], "run.measurement_source", _text)
    return {
        "run_id": run["run_id"], "case_id": run["case_id"], "case_revision": run["case_revision"],
        "trial_id": run["trial_id"], "strategy": run["strategy"],
        "input_fingerprint": run["input_fingerprint"], "oracle_sha256": run["oracle_sha256"],
        "candidate_fingerprint": run["candidate_fingerprint"],
        "measurement_scope": run["measurement_scope"], "token_basis": run["token_basis"],
        "outcome": run["outcome"], "ground_truth": run["ground_truth"],
        "verification": _validate_verification(run["verification"]),
        "attempt_count": run["attempt_count"], "repair_count": run["repair_count"],
        "elapsed_seconds": run["elapsed_seconds"],
        "strong_interventions": run["strong_interventions"],
        "usage_complete": dict(run["usage_complete"]),
        "measurement_source": dict(run["measurement_source"]),
        "usage": _validate_usage(run["usage"], meta),
        "notes": run.get("notes"),
    }


def _role_tokens(run, meta, role):
    """Total input+output tokens for one role, or None while unknown.

    An explicitly complete role with no recorded calls is a known zero; a missing
    row, an unknown source or any null counter stays unknown.
    """
    if not run["usage_complete"][role] or run["measurement_source"][role] == "unknown":
        return None
    models = set(meta["role_models"][role])
    total = 0
    for row in run["usage"]:
        if row["model_id"] in models:
            if row["input_tokens"] is None or row["output_tokens"] is None:
                return None
            total += row["input_tokens"] + row["output_tokens"]
    return total


def _analyze(run, meta):
    verification = run["verification"]
    kinds = []
    if run["outcome"] == "accepted":
        if run["ground_truth"] == "failed":
            kinds.append("false_acceptance")
        if not verification["independent_verified"]:
            kinds.append("unverified_acceptance")
        else:
            # verification.run_id is the verifier receipt/run id, not the logical
            # execution run_id; an accepted run needs a nonempty receipt id plus
            # fingerprints matching the run record.
            receipt_present = bool(verification["run_id"] and verification["run_id"].strip())
            fingerprints_match = (run["candidate_fingerprint"] is not None
                                  and verification["candidate_fingerprint"] == run["candidate_fingerprint"]
                                  and verification["oracle_sha256"] == run["oracle_sha256"])
            if not receipt_present:
                kinds.append("missing_verification_id")
            if not fingerprints_match:
                kinds.append("binding_mismatch")
    qualified = (run["outcome"] == "accepted" and run["ground_truth"] == "passed"
                 and verification["independent_verified"]
                 and bool(verification["run_id"])
                 and run["candidate_fingerprint"] is not None
                 and verification["candidate_fingerprint"] == run["candidate_fingerprint"]
                 and verification["oracle_sha256"] == run["oracle_sha256"])
    return {
        "run_id": run["run_id"], "strategy": run["strategy"], "case_id": run["case_id"],
        "trial_id": run["trial_id"], "outcome": run["outcome"],
        "ground_truth": run["ground_truth"], "qualified": qualified,
        "case_revision": run["case_revision"], "input_fingerprint": run["input_fingerprint"],
        "oracle_sha256": run["oracle_sha256"], "measurement_scope": run["measurement_scope"],
        "token_basis": run["token_basis"],
        "quality_violation_kinds": kinds,
        "false_rejection": run["outcome"] == "rejected" and run["ground_truth"] == "passed",
        "quality_unknown": run["ground_truth"] == "unknown",
        "attempt_count": run["attempt_count"], "repair_count": run["repair_count"],
        "strong_interventions": run["strong_interventions"],
        "elapsed_seconds": run["elapsed_seconds"],
        "measurement_source": dict(run["measurement_source"]),
        "tokens": {role: _role_tokens(run, meta, role) for role in ROLES},
    }


def _pair_reasons(baseline, adaptive, meta):
    reasons = []
    if baseline["case_revision"] != adaptive["case_revision"]:
        reasons.append("case_revision differs: baseline=" + baseline["case_revision"]
                       + " adaptive=" + adaptive["case_revision"])
    if baseline["input_fingerprint"] != adaptive["input_fingerprint"]:
        reasons.append("input_fingerprint differs between strategies")
    if baseline["oracle_sha256"] != adaptive["oracle_sha256"]:
        reasons.append("oracle_sha256 differs between strategies")
    if baseline["measurement_scope"] != adaptive["measurement_scope"]:
        reasons.append("measurement_scope differs between strategies")
    if baseline["token_basis"] != adaptive["token_basis"]:
        reasons.append("token_basis differs between strategies")
    for run, label in ((baseline, "baseline"), (adaptive, "adaptive")):
        if run["measurement_scope"] != meta["measurement_scope"]:
            reasons.append(label + " measurement_scope does not match the experiment")
        if run["token_basis"] != meta["token_basis"]:
            reasons.append(label + " token_basis does not match the experiment")
    return reasons


def _sum_or_none(values):
    total = None
    for value in values:
        if value is None:
            return None
        total = value if total is None else total + value
    return total


def _strategy_metrics(analyses, meta):
    tokens = {}
    unknown_ids = {}
    sources = {}
    aggregate_reasons = []
    bases = sorted({a["token_basis"] for a in analyses})
    scopes = sorted({a["measurement_scope"] for a in analyses})
    scope_matches = scopes == [meta["measurement_scope"]]
    for role in ROLES:
        values = [a["tokens"][role] for a in analyses]
        role_sources = sorted({a["measurement_source"][role] for a in analyses})
        role_total = _sum_or_none(values)
        if role_total is not None:
            label = role
            if len(role_sources) > 1:
                aggregate_reasons.append(label + " tokens not aggregated: mixed"
                                                   " measurement sources ("
                                         + ", ".join(role_sources) + ")")
                role_total = None
            if len(bases) > 1:
                aggregate_reasons.append(label + " tokens not aggregated: mixed token"
                                                   " basis (" + ", ".join(bases) + ")")
                role_total = None
            elif bases != [meta["token_basis"]]:
                aggregate_reasons.append(label + " tokens not aggregated: token basis differs from the experiment")
                role_total = None
            if not scope_matches:
                aggregate_reasons.append(label + " tokens not aggregated: measurement"
                                                   " scope differs within the strategy or"
                                                   " from the experiment")
                role_total = None
        tokens[role] = role_total
        unknown_ids[role] = sorted(a["run_id"] for a in analyses
                                   if a["tokens"][role] is None)
        sources[role] = role_sources
    if analyses and not scope_matches:
        aggregate_reasons.append("elapsed time and strong interventions not aggregated: measurement scope differs from the experiment")
    qualified = sum(1 for a in analyses if a["qualified"])
    run_count = len(analyses)
    metrics = {
        "run_count": run_count,
        "outcome_counts": {outcome: sum(1 for a in analyses if a["outcome"] == outcome)
                           for outcome in OUTCOMES},
        "ground_truth_counts": {truth: sum(1 for a in analyses if a["ground_truth"] == truth)
                                for truth in TRUTHS},
        "qualified_delivery_count": qualified,
        "qualified_delivery_rate": (qualified / run_count) if run_count else None,
        "false_acceptance_count": sum(1 for a in analyses if "false_acceptance"
                                      in a["quality_violation_kinds"]),
        "false_rejection_count": sum(1 for a in analyses if a["false_rejection"]),
        "unknown_quality_count": sum(1 for a in analyses if a["quality_unknown"]),
        "quality_violation_count": sum(1 for a in analyses if a["quality_violation_kinds"]),
        "attempt_count_total": sum(a["attempt_count"] for a in analyses),
        "repair_count_total": sum(a["repair_count"] for a in analyses),
        "strong_interventions_total": _sum_or_none([a["strong_interventions"] for a in analyses]) if scope_matches else None,
        "elapsed_seconds_total": _sum_or_none([a["elapsed_seconds"] for a in analyses]) if scope_matches else None,
        "tokens": tokens,
        "tokens_unknown_run_ids": unknown_ids,
        "measurement_sources": sources,
        "aggregate_reasons": aggregate_reasons,
        "cost_per_qualified_delivery": None,
    }
    if tokens["strong"] is not None and qualified:
        metrics["cost_per_qualified_delivery"] = tokens["strong"] / qualified
    return metrics


def _sources_of(strategy_metrics, role):
    return set(strategy_metrics["measurement_sources"][role])


def _sources_compatible(strategy_metrics, role):
    baseline = _sources_of(strategy_metrics["baseline"], role)
    adaptive = _sources_of(strategy_metrics["adaptive"], role)
    return len(baseline) == 1 and baseline == adaptive


def _pair_record(baseline, adaptive, meta):
    reasons = _pair_reasons(baseline, adaptive, meta)
    compatible = not reasons
    source_match = {role: baseline["measurement_source"][role]
                    == adaptive["measurement_source"][role] for role in ROLES}
    baseline_qualified = baseline["qualified"]
    adaptive_qualified = adaptive["qualified"]
    both_qualified = baseline_qualified and adaptive_qualified
    values = {
        "attempt_count": {"baseline": baseline["attempt_count"],
                          "adaptive": adaptive["attempt_count"]},
        "repair_count": {"baseline": baseline["repair_count"],
                         "adaptive": adaptive["repair_count"]},
        "strong_interventions": {"baseline": baseline["strong_interventions"],
                                 "adaptive": adaptive["strong_interventions"]},
        "elapsed_seconds": {"baseline": baseline["elapsed_seconds"],
                            "adaptive": adaptive["elapsed_seconds"]},
        "strong_tokens": {"baseline": baseline["tokens"]["strong"],
                          "adaptive": adaptive["tokens"]["strong"]},
        "weak_tokens": {"baseline": baseline["tokens"]["weak"],
                        "adaptive": adaptive["tokens"]["weak"]},
    }

    def delta(field, allowed=True):
        base, adap = values[field]["baseline"], values[field]["adaptive"]
        if not compatible:
            return None
        if not allowed:
            return None
        if base is None or adap is None:
            return None
        return adap - base

    limitations = []
    if not compatible:
        limitations.append("pair incompatible: " + "; ".join(reasons))
    if delta("strong_tokens") is None and compatible:
        if not both_qualified:
            limitations.append("strong token deltas are conditional-on-success;"
                               " this pair is not a qualified success on both sides")
        if not source_match["strong"]:
            limitations.append("strong measurement sources differ between strategies")
        if values["strong_tokens"]["baseline"] is None or values["strong_tokens"]["adaptive"] is None:
            limitations.append("strong tokens unknown on at least one side")
    if delta("weak_tokens") is None and compatible:
        if not both_qualified:
            limitations.append("weak token deltas are conditional-on-success;"
                               " this pair is not a qualified success on both sides")
        if not source_match["weak"]:
            limitations.append("weak measurement sources differ between strategies")
        if values["weak_tokens"]["baseline"] is None or values["weak_tokens"]["adaptive"] is None:
            limitations.append("weak tokens unknown on at least one side")
    if delta("strong_interventions") is None and compatible:
        limitations.append("strong_interventions unknown on at least one side")
    if delta("elapsed_seconds") is None and compatible:
        limitations.append("elapsed_seconds unknown on at least one side")
    return {
        "case_id": baseline["case_id"], "trial_id": baseline["trial_id"],
        "baseline_run_id": baseline["run_id"], "adaptive_run_id": adaptive["run_id"],
        "compatible": compatible, "incompatibility_reasons": reasons,
        "measurement_source_match": source_match,
        "baseline_qualified": baseline_qualified, "adaptive_qualified": adaptive_qualified,
        "both_qualified": both_qualified, "conditional_on_success": both_qualified,
        "values": values,
        "deltas": {
            "attempt_count": delta("attempt_count"),
            "repair_count": delta("repair_count"),
            "strong_interventions": delta("strong_interventions"),
            "elapsed_seconds": delta("elapsed_seconds"),
            "strong_tokens": delta("strong_tokens", source_match["strong"] and both_qualified),
            "weak_tokens": delta("weak_tokens", source_match["weak"] and both_qualified),
        },
        "delta_limitations": limitations,
    }


def _compare(baseline_total, adaptive_total, valid, extra_gates):
    record = {"baseline": baseline_total, "adaptive": adaptive_total, "delta": None,
              "delta_reasons": list(extra_gates)}
    if not valid:
        record["delta_reasons"].append("comparison gates failed; see validity_reasons")
        return record
    if baseline_total is None or adaptive_total is None:
        record["delta_reasons"].append("aggregate value unknown on at least one run")
        return record
    record["delta"] = adaptive_total - baseline_total
    return record


def _relative_change(compare_record, field):
    record = dict(compare_record)
    record["relative_change"] = None
    record["relative_change_reasons"] = []
    if record["delta"] is None:
        record["relative_change_reasons"].extend(record["delta_reasons"])
        return record
    baseline = record["baseline"]
    if not baseline:
        record["relative_change_reasons"].append(
            "baseline " + field + " total is 0; relative change is undefined")
        return record
    record["relative_change"] = record["delta"] / baseline
    return record


def evaluate_runs(experiment, runs):
    """Evaluate complete logical runs against a fixed experiment.

    Returns an advisory metrics report (always can_promote=false). Raises
    ValueError on malformed input: bad types or shapes, unknown model ids,
    duplicate run ids, duplicate (case_id, trial_id, strategy) keys, negative or
    boolean counts, nonfinite durations, or cache counters exceeding input.
    """
    meta = validate_experiment(experiment)
    if not isinstance(runs, list):
        _fail("runs must be an array")
    validated = []
    seen_ids = set()
    for index, item in enumerate(runs):
        run = validate_run(item, meta)
        if run["run_id"] in seen_ids:
            _fail("duplicate run_id: " + run["run_id"])
        seen_ids.add(run["run_id"])
        validated.append(run)

    groups = {}
    for run in validated:
        key = (run["case_id"], run["trial_id"])
        bucket = groups.setdefault(key, {})
        if run["strategy"] in bucket:
            _fail("duplicate strategy key for case_id=" + run["case_id"] + " trial_id="
                  + run["trial_id"] + " strategy=" + run["strategy"]
                  + "; pairing is strictly one baseline plus one adaptive, even when"
                    " case_revision differs")
        bucket[run["strategy"]] = run

    unmatched = []
    pairs = []
    analyses_by_strategy = {strategy: [] for strategy in STRATEGIES}
    for (case_id, trial_id), bucket in sorted(groups.items()):
        analyses = {strategy: _analyze(bucket[strategy], meta)
                    for strategy in STRATEGIES if strategy in bucket}
        for strategy in STRATEGIES:
            if strategy in analyses:
                analyses_by_strategy[strategy].append(analyses[strategy])
        baseline = bucket.get("baseline")
        adaptive = bucket.get("adaptive")
        if baseline is None or adaptive is None:
            missing = "baseline" if baseline is None else "adaptive"
            for strategy in STRATEGIES:
                run = bucket.get(strategy)
                if run is None:
                    continue
                reasons = ["no " + missing + " counterpart for this (case_id, trial_id)"]
                if run["measurement_scope"] != meta["measurement_scope"]:
                    reasons.append("measurement_scope does not match the experiment")
                if run["token_basis"] != meta["token_basis"]:
                    reasons.append("token_basis does not match the experiment")
                unmatched.append({"run_id": run["run_id"], "strategy": strategy,
                                  "case_id": case_id, "trial_id": trial_id,
                                  "reasons": reasons})
        else:
            pairs.append(_pair_record(analyses["baseline"], analyses["adaptive"], meta))

    per_strategy = {strategy: _strategy_metrics(analyses_by_strategy[strategy], meta)
                    for strategy in STRATEGIES}
    all_analyses = analyses_by_strategy["baseline"] + analyses_by_strategy["adaptive"]
    violations = [{"run_id": a["run_id"], "strategy": a["strategy"], "case_id": a["case_id"],
                   "trial_id": a["trial_id"], "kinds": a["quality_violation_kinds"]}
                  for a in all_analyses if a["quality_violation_kinds"]]
    false_rejections = [{"run_id": a["run_id"], "strategy": a["strategy"], "case_id": a["case_id"],
                         "trial_id": a["trial_id"]}
                        for a in all_analyses if a["false_rejection"]]
    overall = _overall(per_strategy, pairs, unmatched, all_analyses, violations)
    return {
        "schema_version": 1,
        "tool": "evaluation_metrics",
        "can_promote": False,
        "advisory_only": True,
        "generated_from": {
            "experiment_id": meta["experiment_id"],
            "model_roles": meta["model_roles"],
            "token_basis": meta["token_basis"],
            "measurement_scope": meta["measurement_scope"],
            "run_count": len(validated),
        },
        "per_strategy": per_strategy,
        "pairs": pairs,
        "unmatched_runs": unmatched,
        "quality_violations": violations,
        "false_rejections": false_rejections,
        "run_records": all_analyses,
        "overall": overall,
        "limitations": [
            "advisory metrics only; can_promote is always false and this report creates no"
            " acceptance receipts",
            "verification, ground-truth and usage declarations are input claims, not"
            " evidence authenticated by this tool",
            "no USD estimation; token counts are not billing amounts",
            "no statistical significance claim; one small cohort does not prove general savings",
        ],
    }


def _overall(per_strategy, pairs, unmatched, analyses, violations):
    reasons = []
    if unmatched:
        reasons.append(str(len(unmatched)) + " run(s) without a one-to-one counterpart: "
                       + ", ".join(sorted(entry["run_id"] for entry in unmatched)))
    incompatible = [pair for pair in pairs if not pair["compatible"]]
    if incompatible:
        reasons.append(str(len(incompatible)) + " incompatible pair(s): "
                       + ", ".join(sorted(pair["baseline_run_id"] for pair in incompatible)))
    for strategy in STRATEGIES:
        if per_strategy[strategy]["run_count"] == 0:
            reasons.append("no runs recorded for strategy '" + strategy + "'")
        elif per_strategy[strategy]["qualified_delivery_count"] == 0:
            reasons.append("no qualified deliveries for strategy '" + strategy + "';"
                           " the overall savings comparison needs at least one"
                           " qualified delivery in each strategy")
        elif per_strategy[strategy]["tokens"]["strong"] is None:
            reasons.append("strong token totals unknown for strategy '" + strategy + "'")
    binding = sorted(entry["run_id"] for entry in violations
                     if set(entry["kinds"]) & set(BINDING_VIOLATIONS))
    if binding:
        reasons.append("accepted runs without a current verified binding: " + ", ".join(binding))
    false_accepts = sorted(entry["run_id"] for entry in violations
                           if "false_acceptance" in entry["kinds"])
    if false_accepts:
        reasons.append("false acceptances (accepted but ground truth failed): "
                       + ", ".join(false_accepts))
    unknown_quality = sorted(a["run_id"] for a in analyses if a["quality_unknown"])
    if unknown_quality:
        reasons.append("runs with unknown ground-truth quality: " + ", ".join(unknown_quality))
    rates = {strategy: per_strategy[strategy]["qualified_delivery_rate"]
             for strategy in STRATEGIES}
    if rates["baseline"] is None or rates["adaptive"] is None:
        reasons.append("qualified delivery rate unavailable")
    elif rates["adaptive"] < rates["baseline"]:
        reasons.append("qualified delivery rate decreased under adaptive: "
                       + repr(rates["adaptive"]) + " < " + repr(rates["baseline"]))
    strong_gates = []
    if not _sources_compatible(per_strategy, "strong"):
        reasons.append("strong measurement sources differ between strategies or are mixed"
                       " within one strategy")
        strong_gates.append("strong measurement sources are not comparable")
    valid = not reasons

    strong = _compare(per_strategy["baseline"]["tokens"]["strong"],
                      per_strategy["adaptive"]["tokens"]["strong"], valid, strong_gates)
    weak_gates = []
    weak_valid = valid and _sources_compatible(per_strategy, "weak")
    if valid and not _sources_compatible(per_strategy, "weak"):
        weak_gates.append("weak measurement sources are not comparable")
    weak = _compare(per_strategy["baseline"]["tokens"]["weak"],
                    per_strategy["adaptive"]["tokens"]["weak"], weak_valid, weak_gates)
    elapsed = _compare(per_strategy["baseline"]["elapsed_seconds_total"],
                       per_strategy["adaptive"]["elapsed_seconds_total"], valid, [])
    interventions = _compare(per_strategy["baseline"]["strong_interventions_total"],
                             per_strategy["adaptive"]["strong_interventions_total"], valid, [])
    return {
        "comparison_valid": valid,
        "validity_reasons": reasons,
        "strong_tokens": _relative_change(strong, "strong token"),
        "weak_tokens": weak,
        "elapsed_seconds": elapsed,
        "strong_interventions": interventions,
        "qualified_delivery_rate": rates,
        "cost_per_qualified_delivery": {
            strategy: per_strategy[strategy]["cost_per_qualified_delivery"]
            for strategy in STRATEGIES},
        "caveats": [
            "per-pair token deltas are conditional-on-success and exclude failure costs;"
            " aggregate totals never do",
            "no USD estimation and no statistical significance claim",
        ],
    }


def reject_duplicates(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key: " + key)
        result[key] = value
    return result


def read_input(path):
    raw = pathlib.Path(path).read_bytes()
    if len(raw) > MAX_INPUT_BYTES:
        raise ValueError("evaluation input exceeds 1 MiB: " + pathlib.Path(path).name)
    return json.loads(raw.decode("utf-8-sig"), object_pairs_hook=reject_duplicates,
                      parse_constant=lambda value: (_ for _ in ()).throw(
                          ValueError("nonfinite JSON value: " + value)))


def parse_payload(payload):
    _object(payload, "input", ("experiment", "runs"))
    return payload["experiment"], payload["runs"]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=pathlib.Path, required=True,
                        help="JSON file holding {experiment, runs}")
    parser.add_argument("--out", type=pathlib.Path, required=True,
                        help="new JSON report path; an existing file is never overwritten")
    args = parser.parse_args(argv)
    try:
        experiment, runs = parse_payload(read_input(args.input))
        output = args.out
        if output.exists():
            raise ValueError("output already exists; refusing to overwrite: " + str(output))
        report = evaluate_runs(experiment, runs)
        encoded = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
        output.parent.mkdir(parents=True, exist_ok=True)
        with output.open("x", encoding="utf-8") as stream:
            stream.write(encoded)
        print(json.dumps({"experiment_id": report["generated_from"]["experiment_id"],
                          "runs": report["generated_from"]["run_count"],
                          "comparison_valid": report["overall"]["comparison_valid"],
                          "can_promote": False}, sort_keys=True))
        return 0
    except (ValueError, TypeError, OSError) as error:
        print("evaluation input error: " + str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
