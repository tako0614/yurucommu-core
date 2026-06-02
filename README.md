# Yurucommu

This page has been reset for Takosumi v1. Takosumi installs a **Source** (Git, prepared archive, or local source) and records an **Installation** plus append-only **Deployment** entries. Source display metadata comes from generic repository information such as Git URL, ref, commit, tag, and package metadata.

## Current Flow

1. Choose a Git URL/ref or a prepared source archive.
2. Run install dry-run and review the returned InstallPlan, changes, warnings, and `planSnapshotDigest`.
3. Apply with the reviewed expected guard. Git sources use `expected.commit` + `expected.planSnapshotDigest`; prepared sources use `expected.sourceDigest` + `expected.planSnapshotDigest`.
4. Deployment dry-run/apply uses the same source guard plus `expected.currentDeploymentId` to prevent stale approvals.
5. Provider materialization, credentials, OIDC clients, billing, domains, Terraform/OpenTofu/Helm state, and PlatformService inventory belong to the operator distribution.

## Takos Boundary

Takos owns product UI, chat, agent, memory, spaces, Git hosting, bundled app launcher metadata, file-handler metadata, and MCP-facing product metadata. Takosumi owns Source / Installation / Deployment records. Takosumi or another operator distribution owns account-plane policy and provider bindings.

## API Shape

```json
{
  "spaceId": "space_1",
  "source": {
    "kind": "git",
    "url": "https://github.com/example/app.git",
    "ref": "main"
  }
}
```

Apply requests add the expected guard returned by dry-run. Takos product routes should call the Takosumi installer or Takosumi account-plane install flow instead of exposing a separate deployment proxy.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi specification](https://takosumi.com/docs/reference/core-spec)
- [Takosumi installer API](https://takosumi.com/docs/reference/installer-api)
