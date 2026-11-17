// Vercel "Ignored Build Step" (vercel.json → ignoreCommand): decides whether a push is built. Exit 0 = skip, 1 = build.
// Every deployment Vercel keeps counts toward the plan's storage (Hobby: 10 GB of function code), and this app built a
// full deployment for every push to every branch. So:
//   - only main (production) and dev (the dev site, Preview) are built; work, Dependabot and pull-request branches are
//     not (vercel.json also turns off automatic deployments for the usual ones: git.deploymentEnabled);
//   - a push that changes only documentation, tests, CI or the mobile app is not built.
// A redeploy (same commit, e.g. after changing a variable) and anything this script cannot tell are always built.
// Plain CommonJS: it runs before `npm install`, so it cannot use tsx or any package.
"use strict";
const { execFileSync } = require("node:child_process");

const BUILT_BRANCHES = ["main", "dev"];

// Files that are not part of the web app: a push that changes only these needs no new deployment.
const NOT_DEPLOYED = [
  /^docs\//, /^tests\//, /^e2e\//, /^mobile\//, /^\.github\//, /^\.claude\//, /^docker\//,
  /^[^/]+\.md$/i, // README, CHANGELOG, SECURITY, AGENTS… at the top level
  /^Dockerfile$/, /^docker-compose\.ya?ml$/, /^render\.yaml$/, /^vitest\.config\.mts$/, /^\.env\.example$/, /^\.dockerignore$/,
];
const isDeployed = (file) => !NOT_DEPLOYED.some((re) => re.test(file));

/** changedFiles: the files changed since the branch's last deployment, or null when unknown. */
function decide(env, changedFiles) {
  const branch = env.VERCEL_GIT_COMMIT_REF || "";
  if (!branch) return { build: true, reason: "not a git push (deployed through the API or CLI)" };
  if (!BUILT_BRANCHES.includes(branch)) return { build: false, reason: `only main and dev are deployed, not ${branch}` };
  if (changedFiles && changedFiles.length && !changedFiles.some(isDeployed)) {
    const shown = changedFiles.slice(0, 3).join(", ") + (changedFiles.length > 3 ? "…" : "");
    return { build: false, reason: `only docs, tests, CI or the mobile app changed (${shown})` };
  }
  return { build: true, reason: changedFiles && changedFiles.length ? "the app changed" : "a new branch, a redeploy, or the changes are unknown" };
}

/** Files changed since this branch's last successful deployment (Vercel gives its commit), or null. */
function changedSinceLastDeployment(env) {
  const prev = env.VERCEL_GIT_PREVIOUS_SHA;
  if (!prev) return null;
  try {
    return execFileSync("git", ["diff", "--name-only", prev, "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .split("\n")
      .filter(Boolean);
  } catch {
    return null; // that commit is not in Vercel's shallow clone: build, to be safe
  }
}

module.exports = { decide, changedSinceLastDeployment, isDeployed, BUILT_BRANCHES };

if (require.main === module) {
  const d = decide(process.env, changedSinceLastDeployment(process.env));
  console.log(`[ignore-build] ${d.build ? "building" : "skipping"}: ${d.reason}`);
  process.exit(d.build ? 1 : 0);
}
