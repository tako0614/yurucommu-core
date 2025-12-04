import { Hono } from "hono";
import type {
  PublicAccountBindings as Bindings,
  Variables,
} from "@takos/platform/server";
import { ok, fail } from "@takos/platform/server";
import { auth } from "../middleware/auth";
import takosProfile from "../../../takos-profile.json";
import { loadAppManifest, createInMemoryAppSource, type AppDefinitionSource } from "@takos/platform/app/manifest-loader";

// Static manifest files bundled at build time for validation
import takosAppJson from "../../../takos-app.json";
import screensCoreJson from "../../../app/views/screens-core.json";
import insertCoreJson from "../../../app/views/insert-core.json";

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
 * GET /-/core/app-manifest/validation
 *
 * Returns validation status of the current App Manifest
 */
coreRecoveryRoutes.get("/-/core/app-manifest/validation", auth, async (c) => {
  if (!requireAuthenticated(c)) {
    return fail(c, "authentication required", 403);
  }

  const env = c.env as Bindings;

  try {
    // Check if app_manifest_validation table exists and has data
    const validationResult = await env.DB.prepare(
      `SELECT * FROM app_manifest_validation ORDER BY validated_at DESC LIMIT 1`
    ).first().catch(() => null);

    if (!validationResult) {
      return ok(c, {
        status: "unknown",
        message: "No validation results found. App Manifest validation may not have been run.",
        errors: [],
        warnings: [],
        validated_at: null,
      });
    }

    // Parse JSON fields stored in database
    const result = validationResult as Record<string, unknown>;
    return ok(c, {
      status: result.status,
      message: result.message,
      errors: typeof result.errors === "string" ? JSON.parse(result.errors) : (result.errors || []),
      warnings: typeof result.warnings === "string" ? JSON.parse(result.warnings) : (result.warnings || []),
      validated_at: result.validated_at,
      manifest_version: result.manifest_version,
      schema_version: result.schema_version,
    });
  } catch (error: any) {
    // Table might not exist yet
    return ok(c, {
      status: "unknown",
      message: "Validation table not configured. This is expected for new installations.",
      errors: [],
      warnings: [],
      validated_at: null,
    });
  }
});

/**
 * POST /-/core/validate-manifest
 *
 * Trigger validation of the current App Manifest
 */
coreRecoveryRoutes.post("/-/core/validate-manifest", auth, async (c) => {
  if (!requireAuthenticated(c)) {
    return fail(c, "authentication required", 403);
  }

  const env = c.env as Bindings;

  try {
    // Create manifest source from bundled static files
    const source = createStaticManifestSource();

    // Load and validate the manifest
    const result = await loadAppManifest({
      rootDir: ".",
      source,
    });

    const errors = result.issues?.filter((issue) => issue.severity === "error") || [];
    const warnings = result.issues?.filter((issue) => issue.severity === "warning") || [];
    const validatedAt = new Date().toISOString();

    const status = errors.length > 0 ? "error" : (warnings.length > 0 ? "warning" : "valid");
    const message = errors.length > 0
      ? `App Manifest validation failed with ${errors.length} error(s)`
      : (warnings.length > 0
        ? `App Manifest validation passed with ${warnings.length} warning(s)`
        : "App Manifest validation passed");

    const validationResult = {
      status,
      message,
      errors: errors.map((e) => `${e.file ? `[${e.file}] ` : ""}${e.message}`),
      warnings: warnings.map((w) => `${w.file ? `[${w.file}] ` : ""}${w.message}`),
      validated_at: validatedAt,
      manifest_version: result.manifest?.version || null,
      schema_version: result.manifest?.schemaVersion || null,
      route_count: result.manifest?.routes?.length || 0,
      screen_count: result.manifest?.views?.screens?.length || 0,
    };

    // Store validation result in database for GET endpoint to read
    try {
      await env.DB.prepare(
        `INSERT OR REPLACE INTO app_manifest_validation
         (id, status, message, errors, warnings, validated_at, manifest_version, schema_version)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        validationResult.status,
        validationResult.message,
        JSON.stringify(validationResult.errors),
        JSON.stringify(validationResult.warnings),
        validationResult.validated_at,
        validationResult.manifest_version,
        validationResult.schema_version,
      ).run();
    } catch (dbError) {
      // Table might not exist yet - this is non-fatal for validation
      console.warn("Failed to store validation result:", dbError);
    }

    return ok(c, validationResult);
  } catch (error: any) {
    return fail(c, `Manifest validation failed: ${error.message}`, 500);
  }
});

/**
 * Create manifest source from bundled static files
 * Used in Cloudflare Workers environment where filesystem access is unavailable
 */
function createStaticManifestSource(): AppDefinitionSource {
  const files: Record<string, string> = {
    "takos-app.json": JSON.stringify(takosAppJson),
    "app/views/screens-core.json": JSON.stringify(screensCoreJson),
    "app/views/insert-core.json": JSON.stringify(insertCoreJson),
  };

  return createInMemoryAppSource(files);
}

/**
 * GET /-/core/config
 *
 * Returns current configuration (wrapper for config export)
 */
coreRecoveryRoutes.get("/-/core/config", auth, async (c) => {
  if (!requireAuthenticated(c)) {
    return fail(c, "authentication required", 403);
  }

  const env = c.env as any;

  return ok(c, {
    distro: {
      name: takosProfile.name,
      version: takosProfile.version,
    },
    instance: {
      domain: env.INSTANCE_DOMAIN || "localhost",
      name: env.INSTANCE_NAME || takosProfile.display_name,
    },
    features: {
      registration_enabled: env.REGISTRATION_ENABLED === "true",
      ai_enabled: env.AI_ENABLED === "true",
      push_enabled: !!env.FCM_SERVER_KEY,
    },
  });
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
      <h2>App Manifest Validation</h2>
      <p style="color: #718096; margin-bottom: 16px;">
        Check the current App definition for errors.
      </p>
      <div id="manifest-container" class="loading">Loading...</div>
      <button class="btn" onclick="validateManifest()" style="margin-top: 16px;">
        Run Validation
      </button>
    </div>

    <div class="card">
      <h2>Configuration Management</h2>
      <div id="config-container" class="loading">Loading...</div>
      <div style="margin-top: 16px;">
        <button class="btn btn-secondary" onclick="downloadConfig()">
          Download Configuration
        </button>
        <label class="btn btn-secondary" style="margin-left: 8px; cursor: pointer;">
          Import Configuration
          <input type="file" id="config-file" accept=".json" style="display: none;" onchange="importConfig(event)">
        </label>
      </div>
    </div>

    <div class="card">
      <h2>Actions</h2>
      <button class="btn btn-secondary" onclick="window.location.href='/-/app/workspaces'">
        Go to App Workspaces
      </button>
      <button class="btn btn-secondary" onclick="window.location.href='/ai/proposals'" style="margin-left: 8px;">
        AI Proposals
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

    async function loadManifestValidation() {
      try {
        const response = await fetch('/-/core/app-manifest/validation');
        const data = await response.json();

        if (!data.ok) {
          document.getElementById('manifest-container').innerHTML =
            '<div style="color: #e53e3e;">Failed to load validation status</div>';
          return;
        }

        const result = data.result;
        const statusClass = result.status === 'valid' ? 'status-ok' :
                           result.status === 'error' ? 'status-error' : '';

        let html = \`
          <div class="status-item">
            <span class="status-label">Status</span>
            <span class="status-value \${statusClass}">\${result.status}</span>
          </div>
          <div class="status-item">
            <span class="status-label">Message</span>
            <span class="status-value">\${result.message}</span>
          </div>
        \`;

        if (result.errors && result.errors.length > 0) {
          html += '<div style="margin-top: 12px; color: #e53e3e;"><strong>Errors:</strong><ul style="margin: 8px 0; padding-left: 20px;">';
          result.errors.forEach(err => {
            html += \`<li>\${err}</li>\`;
          });
          html += '</ul></div>';
        }

        if (result.warnings && result.warnings.length > 0) {
          html += '<div style="margin-top: 12px; color: #d69e2e;"><strong>Warnings:</strong><ul style="margin: 8px 0; padding-left: 20px;">';
          result.warnings.forEach(warn => {
            html += \`<li>\${warn}</li>\`;
          });
          html += '</ul></div>';
        }

        if (result.validated_at) {
          html += \`<div style="margin-top: 12px; font-size: 13px; color: #a0aec0;">Last validated: \${new Date(result.validated_at).toLocaleString()}</div>\`;
        }

        document.getElementById('manifest-container').innerHTML = html;
      } catch (error) {
        document.getElementById('manifest-container').innerHTML =
          '<div style="color: #e53e3e;">Error: ' + error.message + '</div>';
      }
    }

    async function validateManifest() {
      try {
        const response = await fetch('/-/core/validate-manifest', { method: 'POST' });
        const data = await response.json();

        if (data.ok) {
          alert('Validation completed: ' + data.result.status);
          loadManifestValidation();
        } else {
          alert('Validation failed: ' + (data.error || 'Unknown error'));
        }
      } catch (error) {
        alert('Error: ' + error.message);
      }
    }

    async function loadConfig() {
      try {
        const response = await fetch('/-/core/config');
        const data = await response.json();

        if (!data.ok) {
          document.getElementById('config-container').innerHTML =
            '<div style="color: #e53e3e;">Failed to load configuration</div>';
          return;
        }

        const config = data.result;
        const html = \`
          <div class="status-item">
            <span class="status-label">Distro</span>
            <span class="status-value">\${config.distro.name} v\${config.distro.version}</span>
          </div>
          <div class="status-item">
            <span class="status-label">Instance Domain</span>
            <span class="status-value">\${config.instance.domain}</span>
          </div>
          <div class="status-item">
            <span class="status-label">Instance Name</span>
            <span class="status-value">\${config.instance.name}</span>
          </div>
          <div class="status-item">
            <span class="status-label">Registration</span>
            <span class="status-value">\${config.features.registration_enabled ? 'Enabled' : 'Disabled'}</span>
          </div>
          <div class="status-item">
            <span class="status-label">AI Features</span>
            <span class="status-value">\${config.features.ai_enabled ? 'Enabled' : 'Disabled'}</span>
          </div>
          <div class="status-item">
            <span class="status-label">Push Notifications</span>
            <span class="status-value">\${config.features.push_enabled ? 'Enabled' : 'Disabled'}</span>
          </div>
        \`;

        document.getElementById('config-container').innerHTML = html;
      } catch (error) {
        document.getElementById('config-container').innerHTML =
          '<div style="color: #e53e3e;">Error: ' + error.message + '</div>';
      }
    }

    async function downloadConfig() {
      try {
        const response = await fetch('/-/config/export');
        const data = await response.json();

        if (!data.ok) {
          alert('Failed to export configuration');
          return;
        }

        const blob = new Blob([JSON.stringify(data.result.config, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'takos-config.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (error) {
        alert('Error: ' + error.message);
      }
    }

    async function importConfig(event) {
      const file = event.target.files[0];
      if (!file) return;

      try {
        const text = await file.text();
        const config = JSON.parse(text);

        if (!confirm('Are you sure you want to import this configuration? This will overwrite existing settings.')) {
          return;
        }

        const response = await fetch('/-/config/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(config),
        });
        const data = await response.json();

        if (data.ok) {
          alert('Configuration imported successfully!');
          loadConfig();
        } else {
          alert('Import failed: ' + (data.error || 'Unknown error'));
        }
      } catch (error) {
        alert('Error: ' + error.message);
      }

      // Reset file input
      event.target.value = '';
    }

    // Load data on page load
    loadStatus();
    loadRevisions();
    loadManifestValidation();
    loadConfig();
  </script>
</body>
</html>`;
}

export default coreRecoveryRoutes;
