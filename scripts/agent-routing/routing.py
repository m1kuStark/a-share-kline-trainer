"""Deterministic advisory routing. No model calls, commands, or acceptance proofs."""
import re

POLICY_VERSION = "routing-shadow-1"
ROUTES = {
    "mechanical": ("glm_direct", "execute_contract"),
    "uncertain": ("glm_scout", "collect_evidence"),
    "requires_design": ("gpt_plan_glm_execute", "plan_contract"),
    "designed": ("gpt_plan_glm_execute", "execute_contract"),
    "continuous_judgment": ("gpt_direct", "take_over"),
}
DOMAINS = {"public_api", "database_schema", "concurrency", "security",
           "core_abstraction", "verification_policy"}
EVENTS = {"failure", "repair_failed", "environment_failure", "replan",
          "scout_completed", "execution_started", "verification_passed"}
RISK_PATHS = {
    "server/src/db.ts": "database_schema",
    "server/src/api.ts": "public_api",
    "web/src/api.ts": "public_api",
    "server/src/index.ts": "concurrency",
    "scripts/runtime/**": "concurrency",
    "scripts/release/launcher.cjs": "concurrency",
    "scripts/agent-routing/**": "verification_policy",
    "scripts/worktree/**": "verification_policy",
    "scripts/verify-candidate.ts": "verification_policy",
    ".github/**": "verification_policy",
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def text(value):
    return isinstance(value, str) and bool(value.strip())


def strings(value, nonempty=False):
    return isinstance(value, list) and all(text(x) for x in value) and (
        not nonempty or bool(value))


def relative_path(value):
    if not text(value):
        return False
    value = value.replace("\\", "/")
    return (not value.startswith("/") and ":" not in value and
            not any(part in ("", ".", "..") for part in value.split("/")))


def matches(path, pattern):
    # Match repo-relative globs, with * confined to one path segment.
    pattern = re.escape(pattern.replace("\\", "/"))
    pattern = pattern.replace(r"\*\*/", "(?:.*/)?").replace(r"\*\*", ".*")
    pattern = pattern.replace(r"\*", "[^/]*").replace(r"\?", "[^/]")
    return re.fullmatch(pattern, path.replace("\\", "/")) is not None


def validate_contract(value):
    require(isinstance(value, dict), "contract must be an object")
    require(type(value.get("schema_version")) is int and value["schema_version"] == 1,
            "unsupported contract schema_version")
    require(text(value.get("task_id")), "task_id is required")
    require(type(value.get("contract_revision")) is int and value["contract_revision"] > 0,
            "contract_revision must be a positive integer")
    require(re.fullmatch(r"[a-f0-9]{40,64}", value.get("base_commit", "")) is not None,
            "base_commit must be a full commit hash")
    require(text(value.get("goal")), "goal is required")
    for name in ("acceptance_criteria", "invariants", "allowed_paths"):
        require(strings(value.get(name), True), name + " must be nonempty")
    for name in ("forbidden_paths", "approved_changes", "semantic_scopes",
                 "context_refs", "known_risks", "forbidden_changes"):
        require(strings(value.get(name)), name + " must be a string array")
    for path in value["allowed_paths"] + value["forbidden_paths"]:
        require(relative_path(path), "scope must be repo-relative: " + str(path))
    require(set(value["approved_changes"]) <= DOMAINS, "unknown approved_changes")
    require(value.get("task_shape") in ROUTES, "unknown task_shape")
    require(value.get("oracle") in {"reliable", "unknown", "missing"}, "unknown oracle")
    require(value.get("verification_profile") is None or text(value["verification_profile"]),
            "verification_profile must be a name or null")
    require(value["oracle"] != "reliable" or text(value.get("verification_profile")),
            "reliable oracle requires verification_profile")
    budgets = value.get("budgets")
    require(isinstance(budgets, dict), "budgets is required")
    for name in ("scout_rounds", "same_failure_repairs", "total_attempts",
                 "environment_retries"):
        require(type(budgets.get(name)) is int and budgets[name] > 0,
                name + " must be a positive integer")
    require(budgets["same_failure_repairs"] <= 2, "at most two same-cause repairs")
    return value


def validate_report(value):
    require(isinstance(value, dict), "report must be an object")
    require(type(value.get("schema_version")) is int and value["schema_version"] == 1,
            "unsupported report schema_version")
    require(text(value.get("task_id")), "report task_id required")
    require(type(value.get("contract_revision")) is int and value["contract_revision"] > 0,
            "report contract_revision invalid")
    for name in ("base_commit", "observed_commit"):
        require(re.fullmatch(r"[a-f0-9]{40,64}", value.get(name, "")) is not None,
                "report " + name + " invalid")
    require(value.get("status") in {"completed", "partial", "failed", "needs_replan"},
            "unknown report status")
    require(value.get("assessment") in {"local_execution", "needs_design",
                                       "continuous_judgment", "unknown"}, "unknown assessment")
    require(type(value.get("needs_replan")) is bool, "needs_replan must be boolean")
    for name in ("assumptions", "uninspected_areas", "unexpected_findings",
                 "requested_scope", "reported_changes", "artifacts"):
        require(strings(value.get(name)), name + " must be a string array")
    require(set(value["reported_changes"]) <= DOMAINS, "unknown reported_changes")
    require(isinstance(value.get("facts"), list), "facts must be an array")
    for fact in value["facts"]:
        require(isinstance(fact, dict) and text(fact.get("statement")), "fact statement required")
        require(relative_path(fact.get("path")), "fact path must be repo-relative")
        require(type(fact.get("line")) is int and fact["line"] > 0, "fact line invalid")
        require(re.fullmatch(r"[a-f0-9]{64}", fact.get("sha256", "")) is not None,
                "fact sha256 required")
    require(isinstance(value.get("tests"), list), "tests must be an array")
    for test in value["tests"]:
        require(isinstance(test, dict) and text(test.get("command")), "test command required")
        require(test.get("exit_code") is None or type(test["exit_code"]) is int,
                "test exit_code must be an integer or null")
        require(text(test.get("artifact")), "test artifact reference required")
    return value


def _history(events, task_id):
    require(isinstance(events, list), "history must be an array")
    seen, result = {}, []
    for event in events:
        require(isinstance(event, dict) and text(event.get("event_id")) and
                text(event.get("task_id")) and event.get("kind") in EVENTS, "invalid history event")
        if event["kind"] in {"failure", "repair_failed"}:
            require(text(event.get("failure_fingerprint")), "failure fingerprint required")
        key = (event["task_id"], event["event_id"])
        require(key not in seen or seen[key] == event, "conflicting duplicate history event")
        if key not in seen and event["task_id"] == task_id:
            result.append(event)
        seen[key] = event
    return result


def decide(contract, observed, report=None, history=None, active=None):
    c = validate_contract(contract)
    require(isinstance(observed, dict) and strings(observed.get("changed_paths")),
            "Git observation with changed_paths required")
    for name in ("head", "tree"):
        require(re.fullmatch(r"[a-f0-9]{40,64}", observed.get(name, "")) is not None,
                "Git observation " + name + " invalid")
    require(all(relative_path(p) for p in observed["changed_paths"]), "invalid Git path")
    if report is not None:
        validate_report(report)
    events = _history([] if history is None else history, c["task_id"])
    route, action = ROUTES[c["task_shape"]]
    reasons, missing = [], []

    def choose(new_route, new_action, reason):
        nonlocal route, action
        route, action = new_route, new_action
        reasons.append(reason)

    violations = [p for p in observed["changed_paths"]
                  if not any(matches(p, a) for a in c["allowed_paths"])
                  or any(matches(p, f) for f in c["forbidden_paths"])]
    domains = {domain for pattern, domain in RISK_PATHS.items()
               if any(matches(path, pattern) for path in observed["changed_paths"])}
    if report:
        domains.update(report["reported_changes"])
    if violations:
        choose("gpt_plan_glm_execute", "replan_contract", "scope_violation")
    if domains - set(c["approved_changes"]):
        choose("gpt_plan_glm_execute", "replan_contract", "unapproved_semantic_change")
    for other in active or []:
        validate_contract(other)
        if other["task_id"] != c["task_id"] and (
                set(other["semantic_scopes"]) & set(c["semantic_scopes"])):
            choose("gpt_plan_glm_execute", "coordinate_ownership", "semantic_ownership_overlap")
            break
    if c["oracle"] != "reliable":
        choose("gpt_plan_glm_execute", "define_oracle", "oracle_not_reliable")

    if report:
        stale = (report["task_id"] != c["task_id"] or
                 report["contract_revision"] != c["contract_revision"] or
                 report["base_commit"] != c["base_commit"] or
                 report["observed_commit"] != observed["head"] or
                 bool(observed.get("invalid_fact_refs")) or
                 bool(observed.get("worktree_dirty")))
        if stale:
            choose("gpt_plan_glm_execute", "recollect_evidence", "stale_report")
        if report["needs_replan"] or report["status"] == "needs_replan" or (
                report["requested_scope"] or report["unexpected_findings"]):
            choose("gpt_plan_glm_execute", "replan_contract", "new_findings")
        if report["assessment"] == "needs_design":
            choose("gpt_plan_glm_execute", "plan_contract", "scout_requires_design")
        if not report["facts"]:
            missing.append("facts")
        missing += report["uninspected_areas"] + report["assumptions"]
        if not reasons and c["task_shape"] == "mechanical" and (
                missing or report["status"] != "completed" or report["assessment"] == "unknown"):
            choose("glm_scout", "collect_evidence", "incomplete_evidence")
        if (not reasons and not missing and c["task_shape"] == "uncertain" and
                report["status"] == "completed" and report["assessment"] == "local_execution"):
            choose("glm_direct", "execute_contract", "scout_localized")
        if report["assessment"] == "continuous_judgment":
            choose("gpt_direct", "take_over", "continuous_judgment")
    elif c["task_shape"] == "uncertain":
        missing.append("scout_report")

    counts = {kind: sum(e["kind"] == kind for e in events) for kind in EVENTS}
    if route == "glm_scout" and counts["scout_completed"] >= c["budgets"]["scout_rounds"]:
        choose("gpt_plan_glm_execute", "resolve_unknowns", "scout_budget_exhausted")
    consecutive, last = 0, None
    env_failures = 0
    for event in events:
        if event["kind"] == "verification_passed":
            consecutive, last, env_failures = 0, None, 0
        elif event["kind"] == "repair_failed":
            fingerprint = event["failure_fingerprint"]
            consecutive = consecutive + 1 if last == fingerprint else 1
            last = fingerprint
        elif event["kind"] == "environment_failure":
            env_failures += 1
    if env_failures >= c["budgets"]["environment_retries"]:
        action = "waiting_environment"
        reasons.append("environment_budget_exhausted")
    if counts["replan"] >= 2:
        choose("gpt_direct", "take_over", "repeated_unknowns")
    if consecutive >= c["budgets"]["same_failure_repairs"]:
        choose("gpt_direct", "take_over", "same_failure_repairs_exhausted")
    if counts["execution_started"] >= c["budgets"]["total_attempts"]:
        choose("gpt_direct", "take_over", "task_budget_exhausted")
    if c["task_shape"] == "continuous_judgment":
        choose("gpt_direct", "take_over", "continuous_judgment")
    return {
        "schema_version": 1, "policy_version": POLICY_VERSION, "mode": "shadow",
        "task_id": c["task_id"], "contract_revision": c["contract_revision"],
        "observed_commit": observed["head"], "observed_tree": observed["tree"],
        "route": route, "next_action": action,
        "reason_codes": sorted(set(reasons)) or ["contract_" + c["task_shape"]],
        "scope_violations": sorted(violations),
        "observed_risk_domains": sorted(domains),
        "missing_evidence": missing, "verification_status": "not_evaluated",
        "can_dispatch": False, "can_promote": False,
    }
