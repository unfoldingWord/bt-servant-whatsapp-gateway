import { describe, expect, it } from 'vitest';
import ciYml from '../../.github/workflows/ci.yml?raw';
import stagingYml from '../../.github/workflows/deploy-staging.yml?raw';
import prodYml from '../../.github/workflows/deploy.yml?raw';

/**
 * Branching model (develop = integration, main = release):
 * - CI runs for both branches.
 * - Staging deploys only from develop, and never from a PR branch.
 * - Production deploys only from a v* release tag that is on main.
 */
describe('workflow triggers follow the develop/main branching model', () => {
  it('CI runs on push and pull_request for develop and main', () => {
    const onBlock = ciYml.slice(ciYml.indexOf('\non:'), ciYml.indexOf('\njobs:'));
    expect(onBlock).toMatch(/push:\s*\n\s*branches: \[main, develop\]/);
    expect(onBlock).toMatch(/pull_request:\s*\n\s*branches: \[main, develop\]/);
  });

  it('Release Source passes the PR head branch via env, never interpolated into run:', () => {
    // github.head_ref is chosen by the PR author; inlining it into a run:
    // script is a script-injection vector.
    // The release-source job runs up to the next top-level job key.
    const jobStart = ciYml.indexOf('\n  release-source:');
    const nextJob = ciYml.slice(jobStart + 1).search(/\n {2}[a-z][\w-]*:\n/);
    const jobBlock = ciYml.slice(jobStart, jobStart + 1 + nextJob);
    expect(jobBlock).toContain('HEAD_REF: ${{ github.head_ref }}');
    expect(jobBlock).toContain('case "$HEAD_REF" in');
    const runAt = jobBlock.indexOf('run: |');
    expect(runAt).toBeGreaterThan(-1);
    expect(jobBlock.slice(runAt)).not.toContain('github.head_ref');
    expect(ciYml).not.toMatch(/=\s*"\$\{\{\s*github\.head_ref/);
  });

  it('staging deploys from develop only and has no pull_request trigger', () => {
    const onBlock = stagingYml.slice(stagingYml.indexOf('\non:'), stagingYml.indexOf('\njobs:'));
    expect(onBlock).not.toContain('pull_request');
    expect(onBlock).toMatch(/workflow_run:[\s\S]*branches: \[develop\]/);
    expect(stagingYml).not.toContain("github.event_name == 'pull_request'");
  });

  it('staging deploys only after CI runs triggered by a push, not by a PR whose head is develop', () => {
    // A release PR (develop → main) runs CI with head branch develop, which the
    // workflow_run branch filter also matches; without this, every merge into
    // develop deployed staging twice while a release PR was open.
    expect(stagingYml).toContain("github.event.workflow_run.event == 'push'");
  });

  it('production refuses to deploy anything but a v* tag on main, before any deploy step', () => {
    const guardAt = prodYml.indexOf('name: Require a release tag on main');
    expect(guardAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(prodYml.indexOf('wrangler-action'));
    expect(prodYml).toContain('refs/tags/v*)');
    expect(prodYml).toContain('git merge-base --is-ancestor "$GITHUB_SHA" origin/main');
    expect(prodYml).toMatch(/fetch-depth: 0/);
  });
});
