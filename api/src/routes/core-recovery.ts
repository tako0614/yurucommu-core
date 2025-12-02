import { Hono } from "hono";
import type {
  PublicAccountBindings as Bindings,
  Variables,
} from "@takos/platform/server";
import { ok, fail } from "@takos/platform/server";
import { auth } from "../middleware/auth";
import takosProfile from "../../../takos-profile.json";

const coreRecoveryRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

/**
 * Core Safe UI / Recovery Mode
 *
 * This provides a minimal recovery interface when the App Layer is broken.
 * These endpoints are part of the Core Kernel and cannot be overridden by App definitions.
 *
 * Purpose:
 * - Allow users to recover when App Manifest is invalid
 * - Provide direct access to AppRevision management
 * - Enable emergency rollback without depending on App Layer UI
 */

const requireAuthenticated = (c: any): boolean => {
  const sessionUser = (c.get("sessionUser") as any) || (c.get("user") as any) || null;
  return !!sessionUser?.id;
};

/**
 * GET /-/core/
 *
 * Returns minimal HTML recovery UI
 */
coreRecoveryRoutes.get("/-/core/", auth, async (c) => {
  if (!requireAuthenticated(c)) {
    return c.html(getLoginPageHtml(), 401);
  }

  const html = getRecoveryPageHtml();
  return c.html(html);
});

/**
 * GET /-/core/status
 *
 * Returns node status and basic diagnostics
 */
coreRecoveryRoutes.get("/-/core/status", auth, async (c) => {
  if (!requireAuthenticated(c)) {
    return fail(c, "authentication required", 403);
  }

  const env = c.env as Bindings;

  // Check database connectivity
  let dbStatus = "unknown";
  try {
    if (env.DB) {
      await env.DB.prepare("SELECT 1").first();
      dbStatus = "ok";
    } else {
      dbStatus = "not_configured";
    }
  } catch (error: any) {
    dbStatus = "error";
  }

  // Check storage connectivity
  let storageStatus = "unknown";
  try {
    if (env.MEDIA) {
      storageStatus = "configured";
    } else {
      storageStatus = "not_configured";
    }
  } catch (error: any) {
    storageStatus = "error";
  }

  return ok(c, {
    node: {
      distro_name: takosProfile.name,
      distro_version: takosProfile.version,
      core_version: takosProfile.base.core_version,
    },
    status: {
      database: dbStatus,
      storage: storageStatus,
      recovery_mode: true,
    },
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /-/core/app-revisions
 *
 * Lists available AppRevisions for rollback
 */
coreRecoveryRoutes.get("/-/core/app-revisions", auth, async (c) => {
  if (!requireAuthenticated(c)) {
    return fail(c, "authentication required", 403);
  }

  const env = c.env as Bindings;

  try {
    const revisions = await env.DB.prepare(
      `SELECT id, description, created_at, status
       FROM app_revisions
       ORDER BY created_at DESC
       LIMIT 20`
    ).all();

    const activeState = await env.DB.prepare(
      `SELECT active_revision_id FROM app_state LIMIT 1`
    ).first();

    return ok(c, {
      revisions: revisions.results || [],
      active_revision_id: activeState ? (activeState as any).active_revision_id : null,
    });
  } catch (error: any) {
    return fail(c, `Failed to fetch revisions: ${error.message}`, 500);
  }
});

/**
 * POST /-/core/app-revisions/:id/activate
 *
 * Emergency rollback to a specific AppRevision
 */
coreRecoveryRoutes.post("/-/core/app-revisions/:id/activate", auth, async (c) => {
  if (!requireAuthenticated(c)) {
    return fail(c, "authentication required", 403);
  }

  const env = c.env as Bindings;
  const revisionId = c.req.param("id");

  try {
    // Verify revision exists
    const revision = await env.DB.prepare(
      `SELECT id, status FROM app_revisions WHERE id = ?`
    ).bind(revisionId).first();

    if (!revision) {
      return fail(c, "Revision not found", 404);
    }

    // Update app_state to activate this revision
    await env.DB.prepare(
      `UPDATE app_state SET active_revision_id = ?, updated_at = ?`
    ).bind(revisionId, new Date().toISOString()).run();

    return ok(c, {
      message: "Revision activated successfully",
      revision_id: revisionId,
      note: "Server restart may be required for changes to take effect",
    });
  } catch (error: any) {
    return fail(c, `Failed to activate revision: ${error.message}`, 500);
  }
});

/**
 * POST /-/core/logout
 *
 * Logout from recovery mode
 */
coreRecoveryRoutes.post("/-/core/logout", auth, async (c) => {
  if (!requireAuthenticated(c)) {
    return fail(c, "authentication required", 403);
  }

  // Clear session cookie
  c.header("Set-Cookie", `takos_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);

  return ok(c, { message: "Logged out successfully" });
});

/**
 * Minimal HTML for login page
 */
function getLoginPageHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Core Recovery - Login Required</title>
  <style>
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      padding: 16px;
    }
    .container {
      background: white;
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.1);
      padding: 40px;
      max-width: 400px;
      width: 100%;
    }
    h1 {
      margin: 0 0 8px;
      font-size: 24px;
      color: #1a202c;
    }
    p {
      color: #718096;
      margin: 0 0 24px;
    }
    .error {
      background: #fed7d7;
      color: #c53030;
      padding: 12px;
      border-radius: 6px;
      margin-bottom: 16px;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🔒 Core Recovery Mode</h1>
    <p>Authentication required</p>
    <div class="error">
      <strong>Authentication Required</strong><br>
      Please log in with your password to access the recovery interface.
    </div>
    <p style="font-size: 14px; color: #a0aec0;">
      To log in, use <code>POST /auth/login</code> with your password.
    </p>
  </div>
</body>
</html>`;
}

/**
 * Minimal HTML for recovery UI
 */
function getRecoveryPageHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Core Recovery Mode</title>
  <style>
    * {
      box-sizing: border-box;
    }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: #f7fafc;
      margin: 0;
      padding: 16px;
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
    }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 24px;
      border-radius: 12px;
      margin-bottom: 24px;
    }
    .header h1 {
      margin: 0 0 8px;
      font-size: 28px;
    }
    .header p {
      margin: 0;
      opacity: 0.9;
    }
    .alert {
      background: #fff3cd;
      border: 1px solid #ffeaa7;
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 24px;
    }
    .alert-title {
      font-weight: 600;
      margin-bottom: 8px;
    }
    .card {
      background: white;
      border-radius: 12px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.05);
      padding: 24px;
      margin-bottom: 24px;
    }
    .card h2 {
      margin: 0 0 16px;
      font-size: 20px;
      color: #1a202c;
    }
    .status-item {
      display: flex;
      justify-content: space-between;
      padding: 12px 0;
      border-bottom: 1px solid #e2e8f0;
    }
    .status-item:last-child {
      border-bottom: none;
    }
    .status-label {
      color: #718096;
    }
    .status-value {
      font-weight: 500;
      color: #1a202c;
    }
    .status-ok {
      color: #38a169;
    }
    .status-error {
      color: #e53e3e;
    }
    .btn {
      background: #667eea;
      color: white;
      border: none;
      padding: 12px 24px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.2s;
    }
    .btn:hover {
      background: #5a67d8;
    }
    .btn-secondary {
      background: #718096;
    }
    .btn-secondary:hover {
      background: #4a5568;
    }
    .btn-danger {
      background: #e53e3e;
    }
    .btn-danger:hover {
      background: #c53030;
    }
    .revision-list {
      list-style: none;
      padding: 0;
      margin: 0;
    }
    .revision-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      margin-bottom: 8px;
    }
    .revision-item.active {
      border-color: #667eea;
      background: #f0f4ff;
    }
    .revision-info {
      flex: 1;
    }
    .revision-id {
      font-family: 'Courier New', monospace;
      font-size: 13px;
      color: #718096;
    }
    .revision-date {
      font-size: 13px;
      color: #a0aec0;
    }
    .loading {
      text-align: center;
      padding: 40px;
      color: #718096;
    }
    code {
      background: #edf2f7;
      padding: 2px 6px;
      border-radius: 4px;
      font-family: 'Courier New', monospace;
      font-size: 13px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🛠️ Core Recovery Mode</h1>
      <p>Emergency management interface for ${takosProfile.display_name}</p>
    </div>

    <div class="alert">
      <div class="alert-title">⚠️ Recovery Mode Active</div>
      <p>This interface provides direct access to Core Kernel functions when the App Layer is unavailable or broken.</p>
    </div>

    <div class="card">
      <h2>Node Status</h2>
      <div id="status-container" class="loading">Loading...</div>
    </div>

    <div class="card">
      <h2>App Revisions</h2>
      <p style="color: #718096; margin-bottom: 16px;">
        Roll back to a previous AppRevision if the current one is broken.
      </p>
      <div id="revisions-container" class="loading">Loading...</div>
    </div>

    <div class="card">
      <h2>Actions</h2>
      <button class="btn btn-secondary" onclick="window.location.href='/-/app/workspaces'">
        Go to App Workspaces
      </button>
      <button class="btn btn-secondary" onclick="window.location.href='/-/config/export'" style="margin-left: 8px;">
        Export Configuration
      </button>
      <button class="btn btn-danger" onclick="logout()" style="margin-left: 8px;">
        Logout
      </button>
    </div>
  </div>

  <script>
    async function loadStatus() {
      try {
        const response = await fetch('/-/core/status');
        const data = await response.json();

        if (!data.ok) {
          document.getElementById('status-container').innerHTML =
            '<div style="color: #e53e3e;">Failed to load status</div>';
          return;
        }

        const statusHtml = \`
          <div class="status-item">
            <span class="status-label">Distro</span>
            <span class="status-value">\${data.result.node.distro_name} v\${data.result.node.distro_version}</span>
          </div>
          <div class="status-item">
            <span class="status-label">Core Version</span>
            <span class="status-value">\${data.result.node.core_version}</span>
          </div>
          <div class="status-item">
            <span class="status-label">Database</span>
            <span class="status-value \${data.result.status.database === 'ok' ? 'status-ok' : 'status-error'}">
              \${data.result.status.database}
            </span>
          </div>
          <div class="status-item">
            <span class="status-label">Storage</span>
            <span class="status-value \${data.result.status.storage === 'configured' ? 'status-ok' : 'status-error'}">
              \${data.result.status.storage}
            </span>
          </div>
        \`;

        document.getElementById('status-container').innerHTML = statusHtml;
      } catch (error) {
        document.getElementById('status-container').innerHTML =
          '<div style="color: #e53e3e;">Error: ' + error.message + '</div>';
      }
    }

    async function loadRevisions() {
      try {
        const response = await fetch('/-/core/app-revisions');
        const data = await response.json();

        if (!data.ok) {
          document.getElementById('revisions-container').innerHTML =
            '<div style="color: #e53e3e;">Failed to load revisions</div>';
          return;
        }

        const revisions = data.result.revisions;
        const activeId = data.result.active_revision_id;

        if (revisions.length === 0) {
          document.getElementById('revisions-container').innerHTML =
            '<p style="color: #718096;">No revisions found.</p>';
          return;
        }

        const revisionsHtml = '<ul class="revision-list">' +
          revisions.map(rev => {
            const isActive = rev.id === activeId;
            return \`
              <li class="revision-item \${isActive ? 'active' : ''}">
                <div class="revision-info">
                  <div class="revision-id">\${rev.id} \${isActive ? '(active)' : ''}</div>
                  <div class="revision-date">\${new Date(rev.created_at).toLocaleString()}</div>
                  <div>\${rev.description || 'No description'}</div>
                </div>
                \${!isActive ? \`
                  <button class="btn btn-secondary" onclick="activateRevision('\${rev.id}')">
                    Activate
                  </button>
                \` : ''}
              </li>
            \`;
          }).join('') +
        '</ul>';

        document.getElementById('revisions-container').innerHTML = revisionsHtml;
      } catch (error) {
        document.getElementById('revisions-container').innerHTML =
          '<div style="color: #e53e3e;">Error: ' + error.message + '</div>';
      }
    }

    async function activateRevision(revisionId) {
      if (!confirm('Are you sure you want to activate this revision? This will change the active App definition.')) {
        return;
      }

      try {
        const response = await fetch(\`/-/core/app-revisions/\${revisionId}/activate\`, {
          method: 'POST',
        });
        const data = await response.json();

        if (data.ok) {
          alert('Revision activated successfully! Please refresh the page.');
          loadRevisions();
        } else {
          alert('Failed to activate revision: ' + (data.error || 'Unknown error'));
        }
      } catch (error) {
        alert('Error: ' + error.message);
      }
    }

    async function logout() {
      try {
        await fetch('/-/core/logout', { method: 'POST' });
        window.location.href = '/';
      } catch (error) {
        alert('Logout failed: ' + error.message);
      }
    }

    // Load data on page load
    loadStatus();
    loadRevisions();
  </script>
</body>
</html>`;
}

export default coreRecoveryRoutes;
