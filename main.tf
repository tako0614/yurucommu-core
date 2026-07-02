terraform {
  required_version = ">= 1.5"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
    http = {
      source  = "hashicorp/http"
      version = "~> 3.5"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.7"
    }
  }
}

variable "enable_cloudflare_resources" {
  description = "Provision Yurucommu Cloudflare backing resources with the existing cloudflare/cloudflare provider."
  type        = bool
  default     = false
}

variable "cloudflare_account_id" {
  description = "Cloudflare account id used when enable_cloudflare_resources is true."
  type        = string
  default     = ""

  validation {
    condition     = !var.enable_cloudflare_resources || trimspace(var.cloudflare_account_id) != ""
    error_message = "cloudflare_account_id is required when enable_cloudflare_resources is true."
  }
}

variable "project_name" {
  description = "Prefix for Yurucommu backing resource names."
  type        = string
  default     = "yurucommu"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,50}[a-z0-9]$", var.project_name))
    error_message = "project_name must be 3-52 lowercase letters, numbers, or hyphens, and start/end with an alphanumeric character."
  }
}

variable "worker_name" {
  description = "Cloudflare Worker name used when enable_cloudflare_worker_script is true. Defaults to project_name."
  type        = string
  default     = ""

  validation {
    condition     = trimspace(var.worker_name) == "" || can(regex("^[a-z][a-z0-9-]{1,50}[a-z0-9]$", var.worker_name))
    error_message = "worker_name must be empty or 3-52 lowercase letters, numbers, or hyphens, and start/end with an alphanumeric character."
  }
}

variable "app_url" {
  description = "Canonical public URL for the published Yurucommu instance. When empty, launch_url is derived from worker_name and cloudflare_workers_subdomain."
  type        = string
  default     = ""

  validation {
    condition     = trimspace(var.app_url) == "" || can(regex("^https://[^[:space:]]+$", var.app_url))
    error_message = "app_url must be empty or an https URL."
  }
}

variable "encryption_key" {
  description = "Sensitive Yurucommu encryption key injected as the ENCRYPTION_KEY Worker secret. Leave empty when the runtime is not managed by this OpenTofu module."
  type        = string
  default     = ""
  sensitive   = true

  validation {
    condition     = trimspace(var.encryption_key) == "" || can(regex("^[a-f0-9]{64}$", trimspace(var.encryption_key)))
    error_message = "encryption_key must be empty or a 64-character lowercase hex key."
  }
}

variable "auth_password_hash" {
  description = "Optional bootstrap password hash/token injected as AUTH_PASSWORD_HASH. Takosumi installs may instead use the Takosumi Accounts OIDC variables."
  type        = string
  default     = ""
  sensitive   = true
}

variable "takosumi_accounts_issuer_url" {
  description = "Optional Takosumi Accounts OIDC issuer URL used as a public auth method for auto-provisioned Capsules."
  type        = string
  default     = ""

  validation {
    condition     = trimspace(var.takosumi_accounts_issuer_url) == "" || can(regex("^https://[^[:space:]]+$", trimspace(var.takosumi_accounts_issuer_url)))
    error_message = "takosumi_accounts_issuer_url must be empty or an https URL."
  }
}

variable "takosumi_accounts_client_id" {
  description = "Optional Takosumi Accounts public OIDC client id used with takosumi_accounts_issuer_url."
  type        = string
  default     = ""
}

variable "cloudflare_workers_subdomain" {
  description = "Cloudflare workers.dev subdomain used to derive launch_url for Worker-dev deployments."
  type        = string
  default     = ""

  validation {
    condition     = trimspace(var.cloudflare_workers_subdomain) == "" || can(regex("^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$", var.cloudflare_workers_subdomain))
    error_message = "cloudflare_workers_subdomain must be empty or a valid workers.dev subdomain label."
  }
}

variable "enable_cloudflare_worker_script" {
  description = "Deploy the Yurucommu Worker script, bindings, queue consumers, route, and optional workers.dev enablement through OpenTofu."
  type        = bool
  default     = false
}

variable "worker_bundle_path" {
  description = "Local path to the prebuilt Worker module JS file used when worker_bundle_url is empty."
  type        = string
  default     = "dist/takos-worker.js"
}

variable "worker_bundle_url" {
  description = "Optional HTTPS URL for a prebuilt Worker module JS artifact. When set, OpenTofu downloads this artifact and verifies worker_bundle_sha256 before upload."
  type        = string
  default     = ""

  validation {
    condition     = trimspace(var.worker_bundle_url) == "" || can(regex("^https://[^[:space:]]+$", trimspace(var.worker_bundle_url)))
    error_message = "worker_bundle_url must be empty or an https URL."
  }
}

variable "worker_bundle_sha256" {
  description = "Expected SHA-256 of the Worker module JS. Accepts lowercase hex or sha256:<hex>. Required when worker_bundle_url is set; optional for local worker_bundle_path."
  type        = string
  default     = ""

  validation {
    condition     = trimspace(var.worker_bundle_sha256) == "" || can(regex("^(sha256:)?[a-f0-9]{64}$", trimspace(var.worker_bundle_sha256)))
    error_message = "worker_bundle_sha256 must be empty, a lowercase 64-character hex SHA-256 digest, or sha256:<hex>."
  }
}

variable "worker_main_module" {
  description = "Module name used as the Cloudflare Worker main module when uploading worker_bundle_path."
  type        = string
  default     = "worker.js"
}

variable "worker_assets_directory" {
  description = "Static assets directory uploaded with the Worker when enable_worker_assets is true. The default artifact embeds assets, so this is normally only needed for direct Cloudflare local builds."
  type        = string
  default     = "dist"
}

variable "enable_worker_assets" {
  description = "Upload worker_assets_directory as Cloudflare Workers static assets with the Worker script. Remote worker_bundle_url artifacts are expected to embed assets, so this is ignored when worker_bundle_url is set."
  type        = bool
  default     = false
}

variable "enable_workers_dev_subdomain" {
  description = "Enable the Worker on the account's workers.dev subdomain when enable_cloudflare_worker_script is true."
  type        = bool
  default     = true
}

variable "cloudflare_route_zone_id" {
  description = "Optional Cloudflare zone id used to create a Worker route. For Takosumi Cloud compat this is the virtual zone id."
  type        = string
  default     = ""
}

variable "cloudflare_route_pattern" {
  description = "Optional Worker route pattern, for example example.com/* or my-app.app.takos.jp/*."
  type        = string
  default     = ""

  validation {
    condition     = trimspace(var.cloudflare_route_pattern) == "" || can(regex("^[^[:space:]]+/\\*$", trimspace(var.cloudflare_route_pattern)))
    error_message = "cloudflare_route_pattern must be empty or a Worker route pattern ending in /*."
  }
}

variable "worker_compatibility_date" {
  description = "Cloudflare Workers compatibility date for the OpenTofu-managed Worker script."
  type        = string
  default     = "2026-04-01"
}

variable "worker_compatibility_flags" {
  description = "Cloudflare Workers compatibility flags for the OpenTofu-managed Worker script."
  type        = set(string)
  default     = ["nodejs_compat", "global_fetch_strictly_public"]
}

locals {
  cloudflare_resources_enabled  = var.enable_cloudflare_resources
  cloudflare_worker_enabled     = local.cloudflare_resources_enabled && var.enable_cloudflare_worker_script
  cloudflare_route_enabled      = local.cloudflare_worker_enabled && trimspace(var.cloudflare_route_zone_id) != "" && trimspace(var.cloudflare_route_pattern) != ""
  worker_bundle_url             = trimspace(var.worker_bundle_url)
  worker_bundle_uses_url        = local.cloudflare_worker_enabled && local.worker_bundle_url != ""
  worker_bundle_sha256_input    = trimspace(var.worker_bundle_sha256)
  worker_bundle_expected_sha256 = startswith(local.worker_bundle_sha256_input, "sha256:") ? replace(local.worker_bundle_sha256_input, "sha256:", "") : local.worker_bundle_sha256_input
  worker_bundle_local_path      = startswith(var.worker_bundle_path, "/") ? var.worker_bundle_path : "${path.module}/${var.worker_bundle_path}"
  worker_bundle_body            = local.worker_bundle_uses_url ? data.http.worker_bundle[0].response_body : null
  worker_bundle_content_sha256  = local.cloudflare_worker_enabled ? (local.worker_bundle_uses_url ? sha256(data.http.worker_bundle[0].response_body) : filesha256(local.worker_bundle_local_path)) : null
  worker_assets_enabled         = local.cloudflare_worker_enabled && var.enable_worker_assets && !local.worker_bundle_uses_url
  resource_prefix               = var.project_name
  worker_name                   = trimspace(var.worker_name) != "" ? trimspace(var.worker_name) : local.resource_prefix
  workers_dev_url               = trimspace(var.cloudflare_workers_subdomain) != "" ? "https://${local.worker_name}.${trimspace(var.cloudflare_workers_subdomain)}.workers.dev" : null
  launch_url                    = trimspace(var.app_url) != "" ? trimspace(var.app_url) : local.workers_dev_url
  provided_encryption_key       = trimspace(var.encryption_key)
  provided_auth_password_hash   = trimspace(var.auth_password_hash)
  has_takosumi_accounts_oidc    = trimspace(var.takosumi_accounts_issuer_url) != "" && trimspace(var.takosumi_accounts_client_id) != ""
  effective_encryption_key      = local.provided_encryption_key != "" ? local.provided_encryption_key : random_id.encryption_key.hex
  effective_auth_password_hash  = local.provided_auth_password_hash != "" ? local.provided_auth_password_hash : (local.has_takosumi_accounts_oidc ? "" : try(random_id.bootstrap_auth_token[0].hex, ""))

  d1_database_name    = "${local.resource_prefix}-db"
  r2_media_bucket     = "${local.resource_prefix}-media"
  kv_namespace_title  = "${local.resource_prefix}-kv"
  delivery_queue_name = "${local.resource_prefix}-delivery"
  delivery_dlq_name   = "${local.resource_prefix}-delivery-dlq"
}

resource "random_id" "encryption_key" {
  byte_length = 32

  keepers = {
    project_name = local.resource_prefix
  }
}

resource "random_id" "bootstrap_auth_token" {
  count       = local.provided_auth_password_hash == "" && !local.has_takosumi_accounts_oidc ? 1 : 0
  byte_length = 32

  keepers = {
    project_name = local.resource_prefix
  }
}

data "http" "worker_bundle" {
  count = local.worker_bundle_uses_url ? 1 : 0
  url   = local.worker_bundle_url

  request_headers = {
    Accept = "application/javascript, text/javascript, application/octet-stream"
  }
}

resource "cloudflare_d1_database" "database" {
  count      = local.cloudflare_resources_enabled ? 1 : 0
  account_id = var.cloudflare_account_id
  name       = local.d1_database_name
}

resource "cloudflare_r2_bucket" "media" {
  count      = local.cloudflare_resources_enabled ? 1 : 0
  account_id = var.cloudflare_account_id
  name       = local.r2_media_bucket
}

resource "cloudflare_workers_kv_namespace" "kv" {
  count      = local.cloudflare_resources_enabled ? 1 : 0
  account_id = var.cloudflare_account_id
  title      = local.kv_namespace_title
}

resource "cloudflare_queue" "delivery" {
  count      = local.cloudflare_resources_enabled ? 1 : 0
  account_id = var.cloudflare_account_id
  queue_name = local.delivery_queue_name
}

resource "cloudflare_queue" "delivery_dlq" {
  count      = local.cloudflare_resources_enabled ? 1 : 0
  account_id = var.cloudflare_account_id
  queue_name = local.delivery_dlq_name
}

resource "cloudflare_workers_script" "worker" {
  count               = local.cloudflare_worker_enabled ? 1 : 0
  account_id          = var.cloudflare_account_id
  script_name         = local.worker_name
  content             = local.worker_bundle_uses_url ? local.worker_bundle_body : null
  content_file        = local.worker_bundle_uses_url ? null : local.worker_bundle_local_path
  content_sha256      = local.worker_bundle_content_sha256
  main_module         = var.worker_main_module
  compatibility_date  = var.worker_compatibility_date
  compatibility_flags = var.worker_compatibility_flags

  assets = local.worker_assets_enabled ? {
    directory = var.worker_assets_directory
    config = {
      run_worker_first   = true
      not_found_handling = "single-page-application"
    }
  } : null

  bindings = concat(
    [
      {
        type        = "d1"
        name        = "DB"
        database_id = cloudflare_d1_database.database[0].id
      },
      {
        type         = "kv_namespace"
        name         = "KV"
        namespace_id = cloudflare_workers_kv_namespace.kv[0].id
      },
      {
        type        = "r2_bucket"
        name        = "MEDIA"
        bucket_name = cloudflare_r2_bucket.media[0].name
      },
      {
        type       = "queue"
        name       = "DELIVERY_QUEUE"
        queue_name = cloudflare_queue.delivery[0].queue_name
      },
      {
        type       = "queue"
        name       = "DELIVERY_DLQ"
        queue_name = cloudflare_queue.delivery_dlq[0].queue_name
      },
      {
        type = "plain_text"
        name = "APP_URL"
        text = local.launch_url != null ? local.launch_url : ""
      },
      {
        type = "plain_text"
        name = "DELIVERY_QUEUE_NAME"
        text = cloudflare_queue.delivery[0].queue_name
      },
      {
        type = "plain_text"
        name = "DELIVERY_DLQ_NAME"
        text = cloudflare_queue.delivery_dlq[0].queue_name
      },
    ],
    [
      {
        type = "secret_text"
        name = "ENCRYPTION_KEY"
        text = local.effective_encryption_key
      },
    ],
    local.effective_auth_password_hash != "" ? [
      {
        type = "secret_text"
        name = "AUTH_PASSWORD_HASH"
        text = local.effective_auth_password_hash
      },
    ] : [],
    local.has_takosumi_accounts_oidc ? [
      {
        type = "plain_text"
        name = "TAKOSUMI_ACCOUNTS_ISSUER_URL"
        text = trimspace(var.takosumi_accounts_issuer_url)
      },
      {
        type = "plain_text"
        name = "TAKOSUMI_ACCOUNTS_CLIENT_ID"
        text = trimspace(var.takosumi_accounts_client_id)
      },
    ] : [],
  )

  lifecycle {
    precondition {
      condition     = !local.worker_bundle_uses_url || (local.worker_bundle_expected_sha256 != "" && local.worker_bundle_expected_sha256 == local.worker_bundle_content_sha256)
      error_message = "worker_bundle_sha256 is required for worker_bundle_url and must match the downloaded artifact."
    }

    precondition {
      condition     = local.worker_bundle_uses_url || local.worker_bundle_expected_sha256 == "" || local.worker_bundle_expected_sha256 == local.worker_bundle_content_sha256
      error_message = "worker_bundle_sha256 does not match worker_bundle_path."
    }
  }
}

resource "cloudflare_queue_consumer" "delivery" {
  count             = local.cloudflare_worker_enabled ? 1 : 0
  account_id        = var.cloudflare_account_id
  queue_id          = cloudflare_queue.delivery[0].queue_id
  script_name       = cloudflare_workers_script.worker[0].script_name
  type              = "worker"
  dead_letter_queue = cloudflare_queue.delivery_dlq[0].queue_name

  settings = {
    batch_size       = 10
    max_retries      = 3
    max_wait_time_ms = 1000
  }
}

resource "cloudflare_queue_consumer" "delivery_dlq" {
  count       = local.cloudflare_worker_enabled ? 1 : 0
  account_id  = var.cloudflare_account_id
  queue_id    = cloudflare_queue.delivery_dlq[0].queue_id
  script_name = cloudflare_workers_script.worker[0].script_name
  type        = "worker"

  settings = {
    batch_size       = 10
    max_retries      = 1
    max_wait_time_ms = 60000
  }
}

resource "cloudflare_workers_script_subdomain" "worker" {
  count            = local.cloudflare_worker_enabled && var.enable_workers_dev_subdomain ? 1 : 0
  account_id       = var.cloudflare_account_id
  script_name      = cloudflare_workers_script.worker[0].script_name
  enabled          = true
  previews_enabled = false
}

resource "cloudflare_workers_route" "worker" {
  count   = local.cloudflare_route_enabled ? 1 : 0
  zone_id = trimspace(var.cloudflare_route_zone_id)
  pattern = trimspace(var.cloudflare_route_pattern)
  script  = cloudflare_workers_script.worker[0].script_name
}
