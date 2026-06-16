# Yurucommu

This page has been reset for Takosumi v1. Takosumi installs a Git-hosted OpenTofu Capsule and records an **Installation**, **Run**, **StateSnapshot**, **OutputSnapshot**, and **Deployment** ledger. Source display metadata comes from generic repository information such as Git URL, ref, commit, tag, module path, and OpenTofu outputs.

## Current Flow

1. Choose a Git URL/ref and module path, or a prepared immutable source.
2. Create a `plan` type Run and review required providers, policy decision, plan artifact, and `planDigest`.
3. Apply with the expected guard from the reviewed `plan` Run. Git sources use source commit/digest plus the reviewed `planDigest` and plan artifact digest; successful apply records StateSnapshot, OutputSnapshot, and Deployment.
4. Update/destroy applies also guard the current Deployment pointer to prevent stale approvals.
5. Provider materialization, credentials, OIDC clients, billing, domains, OpenTofu state, and platform service inventory belong to the operator distribution.

## Takos Boundary

Takos owns product UI, chat, agent, memory, spaces, Git hosting, bundled app launcher metadata, file-handler metadata, and MCP-facing product metadata. Takosumi records Installation / Run / StateSnapshot / OutputSnapshot / Deployment records. Takosumi or another operator distribution owns account-plane policy, Connections, Installation provider connection policy, and credential resolution.

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

Apply requests add the expected guard returned by the reviewed `plan` Run. Takos product routes should call the Takosumi installer or Takosumi account-plane install flow instead of exposing a separate deployment proxy.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi model](https://takosumi.com/docs/reference/model)
- [Takosumi Deploy Control API](https://takosumi.com/docs/reference/deploy-control-api)
