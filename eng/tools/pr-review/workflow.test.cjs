// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { dispatchReadyReviews, prepareReview } = require("./review-request.cjs");

const sha = "a".repeat(40);
const nextSha = "b".repeat(40);
const progress = "mgmt-review-in-progress";
const statusContext = "mgmt-review/dispatch";
const bot = { id: 7, login: "github-actions[bot]", type: "Bot" };

function fixture() {
  const state = {
    context: {
      eventName: "check_suite",
      actor: bot.login,
      ref: "refs/heads/main",
      repo: { owner: "Azure", repo: "azure-sdk-for-go" },
      payload: {
        repository: { id: 1, full_name: "Azure/azure-sdk-for-go", default_branch: "main" },
        check_suite: { id: 100, status: "completed", head_sha: sha },
      },
    },
    pr: {
      number: 42,
      state: "open",
      draft: false,
      base: { repo: { id: 1 } },
      head: { repo: { id: 2 }, sha },
      labels: [],
    },
    files: [{ filename: "sdk/resourcemanager/compute/armcompute/client.go" }],
    checkRuns: [
      { id: 1, name: "go - pullrequest", status: "completed", conclusion: "success", completed_at: "2026-10-19T19:01:00Z" },
      { id: 2, name: "Verify Links", status: "completed", conclusion: "success", completed_at: "2026-10-19T19:00:30Z" },
    ],
    statuses: [],
    permission: "write",
    calls: { dispatches: [], additions: [], removals: [], actors: [], statuses: [], logs: [] },
  };
  state.associated = [structuredClone(state.pr)];
  state.core = {
    info: (message) => state.calls.logs.push(message),
    error: (message) => state.calls.logs.push(message),
  };
  state.github = {
    rest: {
      actions: {
        createWorkflowDispatch: async (request) => state.calls.dispatches.push(request),
      },
      checks: {
        listForRef: async ({ ref }) => {
          assert.equal(ref, state.pr.head.sha);
          return { data: { check_runs: structuredClone(state.checkRuns) } };
        },
      },
      repos: {
        getCollaboratorPermissionLevel: async ({ username }) => {
          state.calls.actors.push(username);
          return { data: { permission: state.permission } };
        },
        listPullRequestsAssociatedWithCommit: async ({ commit_sha }) => {
          assert.equal(commit_sha, sha);
          return { data: structuredClone(state.associated) };
        },
        listCommitStatusesForRef: async () => ({ data: structuredClone(state.statuses) }),
        createCommitStatus: async (request) => {
          state.calls.statuses.push(request);
          state.statuses.unshift({ context: request.context, state: request.state });
        },
      },
      pulls: {
        get: async ({ pull_number }) => {
          assert.equal(pull_number, 42);
          return { data: structuredClone(state.pr) };
        },
        listFiles: async ({ pull_number }) => {
          assert.equal(pull_number, 42);
          return { data: structuredClone(state.files) };
        },
      },
      issues: {
        addLabels: async (request) => {
          state.calls.additions.push(request);
          for (const name of request.labels) {
            if (!state.pr.labels.some((l) => l.name === name)) state.pr.labels.push({ name });
          }
        },
        removeLabel: async (request) => {
          state.calls.removals.push(request);
          state.pr.labels = state.pr.labels.filter((l) => l.name !== request.name);
        },
      },
    },
    paginate: async (method, parameters) => {
      const { data } = await method(parameters);
      if (Array.isArray(data)) return data;
      return data.check_runs ?? data.jobs ?? [];
    },
  };
  return state;
}

function worker(automatic = true) {
  const state = fixture();
  state.context.eventName = "workflow_dispatch";
  state.context.actor = automatic ? bot.login : "maintainer";
  state.context.payload.sender = automatic ? bot : { id: 3, login: "maintainer", type: "User" };
  state.context.payload.inputs = {
    item_number: "42",
    head_sha: automatic ? sha : "",
  };
  return state;
}

test("dispatches mgmt-review when all expected CI checks complete on a mgmt SDK PR", async () => {
  const state = fixture();
  await dispatchReadyReviews(state);
  assert.deepEqual(state.calls.dispatches, [{
    ...state.context.repo,
    workflow_id: "mgmt-review.lock.yml",
    ref: "main",
    inputs: { item_number: "42", head_sha: sha },
  }]);
  assert.equal(state.calls.statuses[0].state, "pending");
  assert.equal(state.calls.statuses[0].context, statusContext);
});

test("dispatches even when a completed CI check failed", async () => {
  const state = fixture();
  state.checkRuns[0].conclusion = "failure";
  await dispatchReadyReviews(state);
  assert.equal(state.calls.dispatches.length, 1);
});

test("ignores excluded checks such as checkenforcer and self", async () => {
  const state = fixture();
  state.checkRuns.push(
    { id: 3, name: "https://aka.ms/azsdk/checkenforcer", status: "in_progress", conclusion: null },
    { id: 4, name: "mgmt-review", status: "in_progress", conclusion: null },
    { id: 5, name: "Mgmt Review Auto Dispatch", status: "queued", conclusion: null },
  );
  await dispatchReadyReviews(state);
  assert.equal(state.calls.dispatches.length, 1);
});

for (const [name, mutate] of [
  ["required check missing", (s) => s.checkRuns.pop()],
  ["required check still in_progress", (s) => { s.checkRuns[0].status = "in_progress"; s.checkRuns[0].conclusion = null; }],
  ["other non-excluded check still queued", (s) => s.checkRuns.push({ id: 9, name: "CodeQL", status: "queued", conclusion: null })],
  ["non-mgmt PR", (s) => { s.files = [{ filename: "sdk/azcore/client.go" }]; }],
  ["draft PR", (s) => { s.associated[0].draft = true; }],
  ["already pending for head SHA", (s) => { s.statuses = [{ context: statusContext, state: "pending" }]; }],
  ["already dispatched/succeeded for head SHA", (s) => { s.statuses = [{ context: statusContext, state: "success" }]; }],
]) {
  test(`dispatcher skips when ${name}`, async () => {
    const state = fixture();
    mutate(state);
    await dispatchReadyReviews(state);
    assert.equal(state.calls.dispatches.length, 0);
  });
}

test("new commit SHA triggers a fresh dispatch after CI completes", async () => {
  const state = fixture();
  await dispatchReadyReviews(state);
  assert.equal(state.calls.dispatches.length, 1);

  state.pr.head.sha = nextSha;
  state.associated[0].head.sha = nextSha;
  state.context.payload.check_suite.head_sha = nextSha;
  state.statuses = [];
  state.github.rest.repos.listPullRequestsAssociatedWithCommit = async ({ commit_sha }) => {
    assert.equal(commit_sha, nextSha);
    return { data: structuredClone(state.associated) };
  };
  await dispatchReadyReviews(state);
  assert.equal(state.calls.dispatches.length, 2);
  assert.equal(state.calls.dispatches[1].inputs.head_sha, nextSha);
});

test("dispatcher marks status error when createWorkflowDispatch fails", async () => {
  const state = fixture();
  state.github.rest.actions.createWorkflowDispatch = async () => { throw new Error("Dispatch failed"); };
  await assert.rejects(dispatchReadyReviews(state), /Dispatch failed/);
  assert.equal(state.calls.statuses.at(-1).state, "error");
});

test("dispatcher and worker only run trusted default-branch code", async () => {
  const dispatcher = fixture();
  dispatcher.context.ref = "refs/heads/untrusted";
  await assert.rejects(dispatchReadyReviews(dispatcher), /default branch/);
  const dispatch = worker();
  dispatch.context.ref = "refs/heads/untrusted";
  await assert.rejects(prepareReview(dispatch, "mgmt-review"), /default branch/);
});

for (const permission of ["admin", "maintain", "write", "triage", "read", "none"]) {
  test(`manual review authorization checks ${permission} access`, async () => {
    const state = worker(false);
    state.permission = permission;
    if (["admin", "maintain", "write"].includes(permission)) {
      const res = await prepareReview(state, "mgmt-review");
      assert.deepEqual(res, { number: 42, headSha: sha });
    } else {
      await assert.rejects(prepareReview(state, "mgmt-review"), /needs repository write/);
    }
  });
}

test("worker validates bot dispatch, claims in-progress label, and marks status success", async () => {
  const state = worker(true);
  assert.deepEqual(await prepareReview(state, "mgmt-review"), { number: 42, headSha: sha });
  assert.deepEqual(state.pr.labels, [{ name: progress }]);
  assert.equal(state.calls.statuses[0].state, "success");
});

test("worker rejects bot dispatch without head_sha or with incomplete CI", async () => {
  const noSha = worker(true);
  noSha.context.payload.inputs.head_sha = "";
  await assert.rejects(prepareReview(noSha, "mgmt-review"), /must include head_sha/);

  const incomplete = worker(true);
  incomplete.checkRuns[0].status = "in_progress";
  assert.equal(await prepareReview(incomplete, "mgmt-review"), undefined);
  assert.equal(incomplete.calls.additions.length, 0);
});

const workflows = path.resolve(__dirname, "..", "..", "..", ".github", "workflows");
const text = (name) => readFileSync(path.join(workflows, name), "utf8").replace(/\r\n/g, "\n");

test("dispatches mgmt-review when triggered by workflow_run after check_suite", async () => {
  const state = fixture();
  state.context.eventName = "workflow_run";
  state.context.payload.workflow_run = { id: 200, status: "completed", head_sha: sha };
  delete state.context.payload.check_suite;
  await dispatchReadyReviews(state);
  assert.equal(state.calls.dispatches.length, 1);
});

test("auto-dispatch workflow runs trusted code with per-SHA concurrency", () => {
  const dispatcher = text("mgmt-review-auto-dispatch.yml");
  assert.match(dispatcher, /permissions: \{\}/);
  assert.match(dispatcher, /ref: \$\{\{ github\.sha \}\}/);
  assert.match(dispatcher, /group: mgmt-review-dispatch-\$\{\{ github\.event\.check_suite\.head_sha \|\| github\.event\.workflow_run\.head_sha \}\}/);
});

test("management review workflows do not subscribe to the legacy PR target event", () => {
  for (const file of ["mgmt-review-auto-dispatch.yml", "mgmt-review.md", "mgmt-review.lock.yml"]) {
    assert.doesNotMatch(text(file), /^  pull_request_target:/m, file);
  }
});

test("reviewer preserves pending requests in the workflow-level concurrency queue", () => {
  for (const file of ["mgmt-review.md", "mgmt-review.lock.yml"]) {
    const concurrency = text(file).match(/^concurrency:\n((?:[ \t]+[^\n]*\n)+)/m)?.[1];
    assert.ok(concurrency, `${file} has workflow-level concurrency`);
    assert.match(concurrency, /^  group: "?gh-aw-\$\{\{ github.workflow \}\}-\$\{\{ github.event.inputs.item_number \}\}"?$/m);
    assert.match(concurrency, /^  cancel-in-progress: false$/m);
    assert.match(concurrency, /^  queue: max$/m);
  }
});

test("compiled reviewer retains validated targets in both agent and publisher configs", () => {
  const source = text("mgmt-review.md");
  const compiled = text("mgmt-review.lock.yml");
  assert.match(source, /bots: \[github-actions\]/);
  assert.match(source, /cancel-in-progress: false/);
  assert.match(source, /do not check out or execute PR code/);
  assert.match(compiled, /^  agent:\n(?:    name:[^\n]*\n)?    needs:\n(?:      - [\w-]+\n)*      - validate_request\n/m);
  assert.match(compiled, /^  safe_outputs:\n(?:    name:[^\n]*\n)?    needs:\n(?:      - [\w-]+\n)*      - validate_request\n/m);
  const config = (key) => JSON.parse(JSON.parse(
    compiled.match(new RegExp(`^\\s+${key}: (.+)$`, "m"))[1],
  ));
  const agent = config("GH_AW_SAFE_OUTPUTS_CONFIG");
  const publisher = config("GH_AW_SAFE_OUTPUTS_HANDLER_CONFIG");
  for (const handler of ["add_comment", "add_labels", "remove_labels"]) {
    assert.equal(agent[handler].target, "${{ needs.validate_request.outputs.pr_number }}");
    assert.deepEqual(agent[handler], publisher[handler]);
  }
  assert.deepEqual(agent.add_labels.allowed, ["mgmt-review-analyzed"]);
  assert.deepEqual(agent.remove_labels.allowed, ["mgmt-review-in-progress"]);
  const safeOutputs = compiled.slice(compiled.indexOf("\n  safe_outputs:\n"));
  assert.ok(safeOutputs.indexOf("Reject stale review outputs") < safeOutputs.indexOf("Process Safe Outputs"));
});

test("collector credentials stay outside the agent and detection environments", () => {
  const source = text("mgmt-review.md");
  const compiled = text("mgmt-review.lock.yml");
  const excluded = source.match(/^excluded-env:\n((?:  - [^\n]+\n)+)/m)?.[1];
  assert.ok(excluded, "source declares credential exclusions");
  const commands = compiled.split("\n").filter((line) => line.includes("--env-all"));
  assert.equal(commands.length, 2, "checks both agent and detection commands");
  for (const name of ["GH_AW_OTLP_ENDPOINTS", "OTEL_EXPORTER_OTLP_HEADERS"]) {
    assert.match(excluded, new RegExp(`^  - ${name}$`, "m"));
    for (const command of commands) {
      assert.match(command, new RegExp(`--exclude-env ${name}(?:\\s|$)`));
    }
    assert.match(compiled, new RegExp(`^  ${name}: .*secrets.GH_AW_DEFAULT_OTLP_HEADERS`, "m"),
      "trusted exporters retain collector credentials");
  }
});

test("the actual safe-output guard cleans up rejected reviews without consuming new requests", async (t) => {
  const source = text("mgmt-review.md");
  const script = source.split("    - name: Reject stale review outputs\n")[1]
    .split("  threat-detection:")[0].split("        script: |\n")[1]
    .split("\n").map((line) => line.slice(10)).join("\n");
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const guard = new AsyncFunction("github", "context", "process", "core", script);
  const process = { env: { REVIEW_PR_NUMBER: "42", REVIEW_HEAD_SHA: sha } };
  const run = (state) => guard(state.github, state.context, process, state.core);

  await t.test("current head proceeds without removing labels", async () => {
    const state = fixture();
    state.pr.labels = [{ name: "other-label" }, { name: progress }];
    await run(state);
    assert.deepEqual(state.pr.labels, [{ name: "other-label" }, { name: progress }]);
    assert.equal(state.calls.removals.length, 0);
  });

  for (const [name, mutate] of [
    ["changed head", (state) => state.pr.head.sha = nextSha],
    ["closed PR", (state) => state.pr.state = "closed"],
  ]) {
    await t.test(name, async () => {
      const state = fixture();
      state.pr.labels = [{ name: "other-label" }, { name: progress }];
      mutate(state);
      await assert.rejects(run(state), /No review outputs/);
      assert.deepEqual(state.pr.labels, [{ name: "other-label" }]);
      assert.deepEqual(state.calls.removals, [{
        ...state.context.repo,
        issue_number: 42,
        name: progress,
      }]);
    });
  }

  await t.test("already-absent in-progress label still rejects stale output", async () => {
    const state = fixture();
    state.pr.labels = [{ name: "other-label" }];
    state.pr.head.sha = nextSha;
    state.github.rest.issues.removeLabel = async (request) => {
      state.calls.removals.push(request);
      throw Object.assign(new Error("Label not found"), { status: 404 });
    };
    await assert.rejects(run(state), /No review outputs/);
    assert.deepEqual(state.pr.labels, [{ name: "other-label" }]);
    assert.deepEqual(state.calls.removals.map((request) => request.name), [progress]);
    assert.ok(state.calls.logs.includes("The in-progress label was already removed."));
  });

  await t.test("cleanup failures are surfaced and no other labels are touched", async () => {
    const state = fixture();
    state.pr.labels = [{ name: "other-label" }, { name: progress }];
    state.pr.head.sha = nextSha;
    state.github.rest.issues.removeLabel = async (request) => {
      state.calls.removals.push(request);
      throw Object.assign(new Error("Label cleanup denied"), { status: 403 });
    };
    await assert.rejects(run(state), /Label cleanup denied/);
    assert.deepEqual(state.pr.labels, [{ name: "other-label" }, { name: progress }]);
    assert.deepEqual(state.calls.removals.map((request) => request.name), [progress]);
  });
});
