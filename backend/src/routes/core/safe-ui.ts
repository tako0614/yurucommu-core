/**
 * Core Safe UI Routes
 *
 * Provides App-independent minimal UI for recovery and system management
 * (PLAN.md 5.4.13: Core Safe UI / Recovery Mode)
 *
 * Reserved paths: /-/core/*
 */

import { Router } from "itty-router";
import type { IRequest } from "itty-router";
import { getAuthContext, requireUser } from "../../lib/auth-context";
import type { Env } from "../../index";

export function createCoreSafeUIRouter(env: Env) {
  const router = Router({ base: "/-/core" });

  /**
   * GET /-/core/
   * Core Safe UI landing page
   */
  router.get("/", async (req: IRequest) => {
    const ctx = await getAuthContext(req, env);

    if (!ctx.isAuthenticated) {
      return new Response(renderLoginPage(), {
        headers: { "Content-Type": "text/html" },
      });
    }

    return new Response(renderDashboard(), {
      headers: { "Content-Type": "text/html" },
    });
  });

  /**
   * GET /-/core/config
   * View current takos-config.json
   */
  router.get("/config", async (req: IRequest) => {
    const ctx = await getAuthContext(req, env);
    requireUser(ctx);

    // TODO: Load actual config from KV or environment
    const config = {
      schema_version: "1.0",
      distro: {
        name: "takos-oss",
        version: "0.1.0",
      },
      instance: {
        domain: env.DOMAIN || "localhost",
      },
    };

    return new Response(renderConfigPage(config), {
      headers: { "Content-Type": "text/html" },
    });
  });

  /**
   * GET /-/core/revisions
   * View AppRevision history
   */
  router.get("/revisions", async (req: IRequest) => {
    const ctx = await getAuthContext(req, env);
    requireUser(ctx);

    // TODO: Load actual revisions from DB
    const revisions = [
      {
        id: "rev_20251203_001",
        createdAt: new Date().toISOString(),
        author: { type: "human", name: "Owner" },
        message: "Initial setup",
        active: true,
      },
    ];

    return new Response(renderRevisionsPage(revisions), {
      headers: { "Content-Type": "text/html" },
    });
  });

  /**
   * POST /-/core/revisions/:id/rollback
   * Rollback to a specific AppRevision
   */
  router.post("/revisions/:id/rollback", async (req: IRequest) => {
    const ctx = await getAuthContext(req, env);
    requireUser(ctx);

    const revisionId = req.params?.id;

    // TODO: Implement actual rollback logic
    console.log(`[CoreSafeUI] Rollback to revision: ${revisionId}`);

    return Response.json({ success: true, message: `Rolled back to ${revisionId}` });
  });

  /**
   * GET /-/core/validation
   * View App Manifest validation results
   */
  router.get("/validation", async (req: IRequest) => {
    const ctx = await getAuthContext(req, env);
    requireUser(ctx);

    // TODO: Run actual validation
    const validationResult = {
      valid: true,
      issues: [],
      manifest: {
        schema_version: "1.0",
        version: "1.0.0",
      },
    };

    return new Response(renderValidationPage(validationResult), {
      headers: { "Content-Type": "text/html" },
    });
  });

  return router;
}

/**
 * HTML Templates (Minimal Safe UI)
 */

function renderLoginPage(): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Core Safe UI - Login</title>
  <style>
    body { font-family: sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
    h1 { color: #333; }
    form { margin-top: 20px; }
    label { display: block; margin-top: 10px; font-weight: bold; }
    input { width: 100%; padding: 8px; margin-top: 5px; border: 1px solid #ccc; border-radius: 4px; }
    button { margin-top: 20px; padding: 10px 20px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer; }
    button:hover { background: #0056b3; }
    .warning { background: #fff3cd; border: 1px solid #ffc107; padding: 10px; margin-top: 20px; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>🔐 Core Safe UI</h1>
  <p>This is the App-independent recovery interface for takos.</p>

  <div class="warning">
    <strong>⚠️ Notice:</strong> This interface is for emergency recovery only.
    Use the regular UI for normal operations.
  </div>

  <form method="POST" action="/auth/login">
    <label for="password">Owner Password:</label>
    <input type="password" id="password" name="password" required>
    <button type="submit">Login</button>
  </form>
</body>
</html>
  `;
}

function renderDashboard(): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Core Safe UI - Dashboard</title>
  <style>
    body { font-family: sans-serif; max-width: 800px; margin: 50px auto; padding: 20px; }
    h1 { color: #333; }
    .nav { list-style: none; padding: 0; }
    .nav li { margin: 15px 0; }
    .nav a { display: block; padding: 15px; background: #f8f9fa; border: 1px solid #dee2e6; border-radius: 4px; text-decoration: none; color: #212529; }
    .nav a:hover { background: #e2e6ea; }
    .warning { background: #fff3cd; border: 1px solid #ffc107; padding: 10px; margin-top: 20px; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>🛡️ Core Safe UI Dashboard</h1>

  <div class="warning">
    <strong>⚠️ Recovery Mode:</strong> You are in the App-independent safe interface.
  </div>

  <ul class="nav">
    <li><a href="/-/core/config">📋 View Configuration (takos-config.json)</a></li>
    <li><a href="/-/core/revisions">📜 AppRevision History & Rollback</a></li>
    <li><a href="/-/core/validation">✅ App Manifest Validation</a></li>
    <li><a href="/">🏠 Return to Main UI</a></li>
  </ul>
</body>
</html>
  `;
}

function renderConfigPage(config: any): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Core Safe UI - Configuration</title>
  <style>
    body { font-family: sans-serif; max-width: 800px; margin: 50px auto; padding: 20px; }
    h1 { color: #333; }
    pre { background: #f8f9fa; padding: 15px; border: 1px solid #dee2e6; border-radius: 4px; overflow-x: auto; }
    .actions { margin-top: 20px; }
    button { padding: 10px 20px; margin-right: 10px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer; }
    button:hover { background: #0056b3; }
    .back { background: #6c757d; }
    .back:hover { background: #5a6268; }
  </style>
</head>
<body>
  <h1>📋 Configuration</h1>
  <h2>Current takos-config.json</h2>
  <pre>${JSON.stringify(config, null, 2)}</pre>

  <div class="actions">
    <button onclick="downloadConfig()">⬇️ Download</button>
    <button class="back" onclick="location.href='/-/core/'">⬅️ Back</button>
  </div>

  <script>
    function downloadConfig() {
      const config = ${JSON.stringify(config)};
      const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'takos-config.json';
      a.click();
      URL.revokeObjectURL(url);
    }
  </script>
</body>
</html>
  `;
}

function renderRevisionsPage(revisions: any[]): string {
  const rows = revisions
    .map(
      (rev) => `
    <tr>
      <td>${rev.id}</td>
      <td>${new Date(rev.createdAt).toLocaleString()}</td>
      <td>${rev.author.type} ${rev.author.name || ""}</td>
      <td>${rev.message || "-"}</td>
      <td>${rev.active ? "✅ Active" : ""}</td>
      <td>
        ${!rev.active ? `<button onclick="rollback('${rev.id}')">↩️ Rollback</button>` : ""}
      </td>
    </tr>
  `
    )
    .join("");

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Core Safe UI - AppRevisions</title>
  <style>
    body { font-family: sans-serif; max-width: 1000px; margin: 50px auto; padding: 20px; }
    h1 { color: #333; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
    th, td { padding: 10px; text-align: left; border: 1px solid #dee2e6; }
    th { background: #f8f9fa; font-weight: bold; }
    button { padding: 5px 10px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer; }
    button:hover { background: #0056b3; }
    .back { margin-top: 20px; padding: 10px 20px; background: #6c757d; }
    .back:hover { background: #5a6268; }
  </style>
</head>
<body>
  <h1>📜 AppRevision History</h1>
  <table>
    <thead>
      <tr>
        <th>Revision ID</th>
        <th>Created At</th>
        <th>Author</th>
        <th>Message</th>
        <th>Status</th>
        <th>Actions</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>

  <button class="back" onclick="location.href='/-/core/'">⬅️ Back</button>

  <script>
    async function rollback(revisionId) {
      if (!confirm('Rollback to ' + revisionId + '?')) return;

      const res = await fetch('/-/core/revisions/' + revisionId + '/rollback', { method: 'POST' });
      const data = await res.json();

      if (data.success) {
        alert('Rollback successful! Reloading...');
        location.reload();
      } else {
        alert('Rollback failed: ' + data.message);
      }
    }
  </script>
</body>
</html>
  `;
}

function renderValidationPage(result: any): string {
  const issuesHtml =
    result.issues.length === 0
      ? '<p style="color: green;">✅ No issues found.</p>'
      : result.issues.map((issue: any) => `<li>${issue.level.toUpperCase()}: ${issue.message} (${issue.location || "N/A"})</li>`).join("");

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Core Safe UI - Validation</title>
  <style>
    body { font-family: sans-serif; max-width: 800px; margin: 50px auto; padding: 20px; }
    h1 { color: #333; }
    .status { padding: 15px; border-radius: 4px; margin-top: 20px; }
    .status.valid { background: #d4edda; border: 1px solid #c3e6cb; color: #155724; }
    .status.invalid { background: #f8d7da; border: 1px solid #f5c6cb; color: #721c24; }
    pre { background: #f8f9fa; padding: 15px; border: 1px solid #dee2e6; border-radius: 4px; overflow-x: auto; }
    ul { margin-top: 10px; }
    button { margin-top: 20px; padding: 10px 20px; background: #6c757d; color: white; border: none; border-radius: 4px; cursor: pointer; }
    button:hover { background: #5a6268; }
  </style>
</head>
<body>
  <h1>✅ App Manifest Validation</h1>

  <div class="status ${result.valid ? "valid" : "invalid"}">
    <strong>${result.valid ? "✅ Valid" : "❌ Invalid"}</strong>
  </div>

  <h2>Issues</h2>
  <ul>${issuesHtml}</ul>

  <h2>Current Manifest</h2>
  <pre>${JSON.stringify(result.manifest, null, 2)}</pre>

  <button onclick="location.href='/-/core/'">⬅️ Back</button>
</body>
</html>
  `;
}
