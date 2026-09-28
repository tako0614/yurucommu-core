const EXPECTED_REPOSITORY = "tako0614/yurucommu-core";
const EXPECTED_WORKFLOW = ".github/workflows/npm-package-release.yml";
const EXPECTED_ENVIRONMENT = "npm-release";

function versionAtLeast(actual, minimum) {
  const parts = actual.replace(/^v/u, "").split(".").map(Number);
  const floor = minimum.split(".").map(Number);
  return (
    parts.length >= 3 &&
    parts.slice(0, 3).every(Number.isInteger) &&
    parts
      .slice(0, 3)
      .reduce(
        (result, part, index) => result || Math.sign(part - floor[index]),
        0,
      ) >= 0
  );
}

export function assertTrustedPublishingContext(
  env,
  { nodeVersion, npmVersion, commit, tag },
) {
  const expected = {
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REPOSITORY: EXPECTED_REPOSITORY,
    GITHUB_SERVER_URL: "https://github.com",
    GITHUB_REF: "refs/heads/main",
    GITHUB_WORKFLOW_REF: `${EXPECTED_REPOSITORY}/${EXPECTED_WORKFLOW}@refs/heads/main`,
    GITHUB_JOB: "publish",
    RUNNER_ENVIRONMENT: "github-hosted",
    YURUCOMMU_NPM_RELEASE_ENVIRONMENT: EXPECTED_ENVIRONMENT,
    YURUCOMMU_EXPECTED_RELEASE_SHA: commit,
    YURUCOMMU_EXPECTED_RELEASE_TAG: tag,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (env[key] !== value) {
      throw new Error(`npm OIDC publication requires ${key}=${value}`);
    }
  }
  if (
    !env.ACTIONS_ID_TOKEN_REQUEST_URL ||
    !env.ACTIONS_ID_TOKEN_REQUEST_TOKEN
  ) {
    throw new Error(
      "npm OIDC publication requires GitHub's job-scoped id-token permission",
    );
  }
  if (
    env.NODE_AUTH_TOKEN ||
    env.NPM_TOKEN ||
    env.npm_config__authToken ||
    env.NPM_CONFIG__AUTHTOKEN ||
    env.NPM_CONFIG_USERCONFIG ||
    env.npm_config_userconfig ||
    env.NPM_CONFIG_GLOBALCONFIG ||
    env.npm_config_globalconfig
  ) {
    throw new Error("npm OIDC publication refuses token-based npm credentials");
  }
  if (
    !versionAtLeast(nodeVersion, "22.14.0") ||
    !versionAtLeast(npmVersion, "11.5.1")
  ) {
    throw new Error(
      "npm OIDC publication requires Node >=22.14.0 and npm >=11.5.1",
    );
  }
  return "trusted-oidc";
}

export function npmPublishAuthenticationMode(env, versions) {
  if (env.GITHUB_ACTIONS === undefined) return "local-whoami";
  return assertTrustedPublishingContext(env, versions);
}
