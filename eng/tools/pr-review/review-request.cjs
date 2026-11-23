// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

const excludedCheckPrefixes = ["mgmt-review", "Mgmt Review Auto Dispatch"];
const excludedCheckNames = new Set(["https://aka.ms/azsdk/checkenforcer"]);
const reviewers = {
  "mgmt-review": {
    workflow: "mgmt-review.lock.yml",
    inProgressLabel: "mgmt-review-in-progress",
    statusContext: "mgmt-review/dispatch",
    requiredChecks: ["go - pullrequest", "Verify Links"],
    pathPrefixes: ["sdk/resourcemanager/"],
  },
};

function positiveInteger(value, name) {
  const text = String(value ?? "");
  const number = Number(text);
  if (!/^[1-9]\d*$/.test(text) || !Number.isSafeInteger(number)) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return number;
}

function commitSha(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{40}$/i.test(value)) {
    throw new Error("head_sha must be a full commit SHA.");
  }
  return value.toLowerCase();
}

function requireDefaultBranch(context) {
  const defaultBranch = context.payload.repository.default_branch;
  if (!defaultBranch || context.ref !== `refs/heads/${defaultBranch}`) {
    throw new Error("Review routing and execution must run from the default branch.");
  }
}

async function getAuthorizedReviewers(github, context, actor) {
  if (typeof actor?.login !== "string" || !actor.login) {
    throw new Error("The review request has no originating actor.");
  }
  if (actor.type === "Bot") {
    const allowed = Object.entries(reviewers)
      .filter(([, reviewer]) => reviewer.bots?.includes(actor.login))
      .map(([id]) => id);
    if (allowed.length === 0) {
      throw new Error(`${actor.login} is not authorized to request any reviewer.`);
    }
    return new Set(allowed);
  }
  const { data } = await github.rest.repos.getCollaboratorPermissionLevel({
    ...context.repo,
    username: actor.login,
  });
  if (!["admin", "maintain", "write"].includes(data.permission)) {
    throw new Error(
      `${actor.login} needs repository write, maintain, or admin access to request a review.`,
    );
  }
  return new Set(Object.keys(reviewers));
}

async function requireReviewerPermission(github, context, actor, reviewerId) {
  const allowed = await getAuthorizedReviewers(github, context, actor);
  if (!allowed.has(reviewerId)) {
    throw new Error(`${actor.login} is not authorized to request ${reviewerId}.`);
  }
}

function hasLabel(pr, name) {
  return pr.labels.some((label) => (typeof label === "string" ? label : label.name) === name);
}

function isExcludedCheck(name) {
  if (!name) return false;
  if (excludedCheckNames.has(name)) return true;
  return excludedCheckPrefixes.some((prefix) => name.startsWith(prefix));
}

function checkRunTimestamp(run) {
  const raw = run.completed_at || run.started_at || "";
  const time = Date.parse(raw);
  return Number.isFinite(time) ? time : 0;
}

async function areChecksCompleted({ github, context }, headSha, requiredChecks) {
  const runs = await github.paginate(github.rest.checks.listForRef, {
    ...context.repo,
    ref: headSha,
    per_page: 100,
  });
  const latest = new Map();
  for (const run of runs) {
    const prev = latest.get(run.name);
    if (
      !prev ||
      checkRunTimestamp(run) > checkRunTimestamp(prev) ||
      (checkRunTimestamp(run) === checkRunTimestamp(prev) && (run.id ?? 0) > (prev.id ?? 0))
    ) {
      latest.set(run.name, run);
    }
  }
  for (const name of requiredChecks) {
    const run = latest.get(name);
    if (!run) {
      return { ready: false, reason: `Required check "${name}" has not been reported yet.` };
    }
    if (String(run.status).toLowerCase() !== "completed") {
      return { ready: false, reason: `Required check "${name}" is still ${run.status}.` };
    }
  }
  for (const [name, run] of latest.entries()) {
    if (isExcludedCheck(name)) continue;
    if (String(run.status).toLowerCase() !== "completed") {
      return { ready: false, reason: `Check "${name}" is still ${run.status}.` };
    }
  }
  return { ready: true };
}

async function isMgmtSdkPr(github, context, prNumber, pathPrefixes) {
  const files = await github.paginate(github.rest.pulls.listFiles, {
    ...context.repo,
    pull_number: prNumber,
    per_page: 100,
  });
  return files.some((file) =>
    pathPrefixes.some((prefix) => file.filename?.startsWith(prefix)),
  );
}

async function getLatestCommitStatus(github, context, headSha, statusContext) {
  const { data: statuses } = await github.rest.repos.listCommitStatusesForRef({
    ...context.repo,
    ref: headSha,
    per_page: 100,
  });
  return statuses.find((status) => status.context === statusContext);
}

async function setCommitStatus(github, context, headSha, statusContext, state, description) {
  await github.rest.repos.createCommitStatus({
    ...context.repo,
    sha: headSha,
    state,
    context: statusContext,
    description: description.slice(0, 140),
  });
}

async function getCurrentPullRequest({ github, context, core }, number, headSha, { requireNonDraft = false } = {}) {
  const { data: pr } = await github.rest.pulls.get({
    ...context.repo,
    pull_number: number,
  });
  if (pr.number !== number || pr.base.repo.id !== context.payload.repository.id) {
    throw new Error("The review target does not belong to this repository.");
  }
  if (
    pr.state !== "open" ||
    !pr.head.repo ||
    (requireNonDraft && pr.draft) ||
    (headSha && pr.head.sha !== headSha)
  ) {
    core.info(
      `Skipping PR #${number}: the request is stale, closed, draft, or its head repository is unavailable.`,
    );
    return undefined;
  }
  commitSha(pr.head.sha);
  return pr;
}

async function dispatchReadyReviews({ github, context, core }) {
  requireDefaultBranch(context);
  if (context.eventName !== "check_suite") {
    throw new Error("The review dispatcher requires a check_suite event.");
  }
  const suite = context.payload.check_suite;
  if (!suite || suite.status !== "completed") {
    core.info("Skipping check_suite: suite is not completed.");
    return;
  }
  const headSha = commitSha(suite.head_sha);
  const associatedPRs = await github.paginate(
    github.rest.repos.listPullRequestsAssociatedWithCommit,
    {
      ...context.repo,
      commit_sha: headSha,
      per_page: 100,
    },
  );
  const candidates = associatedPRs.filter(
    (pr) =>
      pr.state === "open" &&
      !pr.draft &&
      pr.base.repo.id === context.payload.repository.id &&
      pr.head.sha === headSha,
  );
  if (candidates.length === 0) {
    core.info(`No open non-draft PR matches head ${headSha}; nothing to dispatch.`);
    return;
  }
  if (candidates.length > 1) {
    throw new Error(
      "Multiple open PRs match this commit; use a manual reviewer dispatch.",
    );
  }
  const pr = candidates[0];

  const results = await Promise.allSettled(
    Object.entries(reviewers).map(async ([reviewerId, reviewer]) => {
      if (!(await isMgmtSdkPr(github, context, pr.number, reviewer.pathPrefixes))) {
        core.info(`Skipping ${reviewerId} for PR #${pr.number}: no management SDK files changed.`);
        return;
      }
      const readiness = await areChecksCompleted({ github, context }, headSha, reviewer.requiredChecks);
      if (!readiness.ready) {
        core.info(`Skipping ${reviewerId} for PR #${pr.number}: ${readiness.reason}`);
        return;
      }
      const latestStatus = await getLatestCommitStatus(github, context, headSha, reviewer.statusContext);
      if (latestStatus && (latestStatus.state === "pending" || latestStatus.state === "success")) {
        core.info(
          `Skipping ${reviewerId} for PR #${pr.number}: already ${latestStatus.state} for ${headSha}.`,
        );
        return;
      }
      await setCommitStatus(
        github,
        context,
        headSha,
        reviewer.statusContext,
        "pending",
        `Dispatching ${reviewerId} for PR #${pr.number}.`,
      );
      try {
        await github.rest.actions.createWorkflowDispatch({
          ...context.repo,
          workflow_id: reviewer.workflow,
          ref: context.payload.repository.default_branch,
          inputs: {
            item_number: String(pr.number),
            head_sha: headSha,
          },
        });
        core.info(`Dispatched ${reviewer.workflow} for PR #${pr.number} at ${headSha}.`);
      } catch (error) {
        await setCommitStatus(
          github,
          context,
          headSha,
          reviewer.statusContext,
          "error",
          `Failed to dispatch ${reviewerId}: ${error.message}`,
        ).catch(() => {});
        throw error;
      }
    }),
  );
  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length > 0) {
    const errors = failures.map((result) => result.reason);
    for (const error of errors) core.error(error.message);
    throw new AggregateError(errors, errors.map((error) => error.message).join("; "));
  }
}

async function claimReview({ github, context, core }, pr, reviewer) {
  if (hasLabel(pr, reviewer.inProgressLabel)) {
    return true;
  }
  await github.rest.issues.addLabels({
    ...context.repo,
    issue_number: pr.number,
    labels: [reviewer.inProgressLabel],
  });
  const current = await getCurrentPullRequest(
    { github, context, core },
    pr.number,
    pr.head.sha,
  );
  if (!current) {
    await github.rest.issues
      .removeLabel({
        ...context.repo,
        issue_number: pr.number,
        name: reviewer.inProgressLabel,
      })
      .catch((error) => {
        if (error.status !== 404) throw error;
      });
    return false;
  }
  return true;
}

async function prepareReview({ github, context, core }, reviewerId) {
  requireDefaultBranch(context);
  if (context.eventName !== "workflow_dispatch" || !Object.hasOwn(reviewers, reviewerId)) {
    throw new Error("A known reviewer must be invoked through workflow_dispatch.");
  }
  const reviewer = reviewers[reviewerId];
  const inputs = context.payload.inputs;
  const number = positiveInteger(inputs.item_number, "item_number");
  let headSha = inputs.head_sha ? commitSha(inputs.head_sha) : undefined;
  const isBotDispatch = context.actor === "github-actions[bot]";

  if (isBotDispatch) {
    if (!headSha) {
      throw new Error("Automated reviewer dispatches must include head_sha.");
    }
  } else {
    await requireReviewerPermission(
      github,
      context,
      { login: context.actor, type: context.payload.sender?.type },
      reviewerId,
    );
  }

  const pr = await getCurrentPullRequest(
    { github, context, core },
    number,
    headSha,
    { requireNonDraft: isBotDispatch },
  );
  if (!pr) return undefined;
  headSha = pr.head.sha;

  if (isBotDispatch) {
    if (!(await isMgmtSdkPr(github, context, number, reviewer.pathPrefixes))) {
      core.info(`Skipping PR #${number}: no management SDK files changed.`);
      return undefined;
    }
    const readiness = await areChecksCompleted({ github, context }, headSha, reviewer.requiredChecks);
    if (!readiness.ready) {
      core.info(`Skipping PR #${number}: ${readiness.reason}`);
      return undefined;
    }
  }

  if (!(await claimReview({ github, context, core }, pr, reviewer))) return undefined;
  await setCommitStatus(
    github,
    context,
    headSha,
    reviewer.statusContext,
    "success",
    `Started ${reviewerId} for PR #${number}.`,
  ).catch((error) => {
    core.info(`Unable to update commit status for PR #${number}: ${error.message}`);
  });
  core.info(`Starting ${reviewerId} for PR #${number} at ${headSha}.`);
  return { number, headSha };
}

module.exports = { dispatchReadyReviews, prepareReview, areChecksCompleted };
