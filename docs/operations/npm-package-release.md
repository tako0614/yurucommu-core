# Core / API npm package release

`@takosjp/yurucommu-core` and `@takosjp/yurucommu-api` are one immutable
package family. The sole writer is `bun run deploy -- yurucommu-package-family`
in this repository. It publishes only those two npm packages; it does not
deploy a Worker, service, site, or database.

## Authentication paths

- Local operator publication retains `npm whoami` preflight and the operator's
  existing npm authentication and 2FA requirements.
- The optional GitHub Actions route is only
  `.github/workflows/npm-package-release.yml`, started manually with
  `workflow_dispatch` from `main`. The `publish` job runs on a GitHub-hosted
  runner under the `npm-release` environment with `id-token: write`. npm CLI
  version 11.5.1 or newer on Node 22.14.0 or newer uses native trusted
  publishing. `npm whoami` does not work with OIDC; the owning entrypoint checks
  this exact job context instead. It does not accept a generic CI bypass flag
  or an npm token.
- Do not disable account 2FA or remove local publishing access. Do not create
  npm automation/granular tokens or place credentials in GitHub secrets for
  this workflow.

An npm package administrator must separately add a GitHub Actions trusted
publisher on **each** package's npm settings. Use organization/user
`tako0614`, repository `yurucommu-core`, workflow filename
`npm-package-release.yml` (filename only), environment `npm-release`, and
allow direct `npm publish` for each connection. Verify both settings before
the first workflow run. These registry settings cannot be established merely
by merging the workflow. Configure the GitHub `npm-release` environment and
its desired reviewer/protection rules separately; the workflow references it
but cannot establish those rules. Keep the workflow on `main`; it rejects
other dispatch refs.

## Prepare and run

1. Review and commit the package source and lockfile, make the clean
   `v<version>` tag point at that exact full commit, and confirm both package
   manifests have the same version. Use a new version for changed bytes.
2. On the GitHub Actions **Manual npm package family release** workflow,
   select `main` and enter that exact `release_tag` and 40-character
   `expected_sha`. There is no push, tag, PR, or schedule publication trigger.
3. The workflow checks tag-to-commit identity before executing repository
   code, installs the pinned release toolchain without a dependency cache,
   then calls the owning deploy entrypoint. That entrypoint runs the full
   owner gate, packs both packages once, tests those exact tarballs as a
   consumer, records both SHA-512 integrities, publishes absent versions,
   compares already-published versions byte-for-byte for safe resume, and
   tests a fresh consumer of both registry versions.
4. Preserve the workflow's non-secret candidate/result output and compare
   the registry versions and integrities. A timeout or partial family publish
   is indeterminate: inspect both npm versions before any explicit exact-byte
   resume. A wrong immutable version requires a new patch release; never
   unpublish or overwrite it as an automatic recovery step.

The same owner command remains available to an authorized local operator.
Neither a green check nor a GitHub environment alone authorizes publication.

References: [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/),
[GitHub Actions runner variables](https://docs.github.com/en/actions/reference/workflows-and-actions/variables).
