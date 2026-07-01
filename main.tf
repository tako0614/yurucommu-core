terraform {
  required_version = ">= 1.5"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
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
  description = "Cloudflare Worker name used by the Takosumi post-apply release command. Defaults to project_name."
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
  description = "Deploy the Yurucommu Worker script, bindings, static assets, queue consumers, and workers.dev enablement through OpenTofu. Build the bundle before apply."
  type        = bool
  default     = false
}

variable "worker_bundle_path" {
  description = "Path to the prebuilt Worker module JS file used when enable_cloudflare_worker_script is true."
  type        = string
  default     = "dist/worker.js"
}

variable "worker_bundle_sha256" {
  description = "Optional expected hex SHA-256 of worker_bundle_path. OpenTofu validates it before uploading when set."
  type        = string
  default     = ""

  validation {
    condition     = trimspace(var.worker_bundle_sha256) == "" || can(regex("^[a-f0-9]{64}$", trimspace(var.worker_bundle_sha256)))
    error_message = "worker_bundle_sha256 must be empty or a lowercase 64-character hex SHA-256 digest."
  }
}

variable "worker_main_module" {
  description = "Module name used as the Cloudflare Worker main module when uploading worker_bundle_path."
  type        = string
  default     = "worker.js"
}

variable "worker_assets_directory" {
  description = "Static assets directory uploaded with the Worker when enable_worker_assets is true."
  type        = string
  default     = "dist"
}

variable "enable_worker_assets" {
  description = "Upload worker_assets_directory as Cloudflare Workers static assets with the Worker script."
  type        = bool
  default     = true
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
  cloudflare_resources_enabled = var.enable_cloudflare_resources
  cloudflare_worker_enabled    = local.cloudflare_resources_enabled && var.enable_cloudflare_worker_script
  cloudflare_route_enabled     = local.cloudflare_worker_enabled && trimspace(var.cloudflare_route_zone_id) != "" && trimspace(var.cloudflare_route_pattern) != ""
  resource_prefix              = var.project_name
  worker_name                  = trimspace(var.worker_name) != "" ? trimspace(var.worker_name) : local.resource_prefix
  workers_dev_url              = trimspace(var.cloudflare_workers_subdomain) != "" ? "https://${local.worker_name}.${trimspace(var.cloudflare_workers_subdomain)}.workers.dev" : null
  launch_url                   = trimspace(var.app_url) != "" ? trimspace(var.app_url) : local.workers_dev_url

  d1_database_name    = "${local.resource_prefix}-db"
  r2_media_bucket     = "${local.resource_prefix}-media"
  kv_namespace_title  = "${local.resource_prefix}-kv"
  delivery_queue_name = "${local.resource_prefix}-delivery"
  delivery_dlq_name   = "${local.resource_prefix}-delivery-dlq"
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
  content_file        = var.worker_bundle_path
  content_sha256      = filesha256(var.worker_bundle_path)
  main_module         = var.worker_main_module
  compatibility_date  = var.worker_compatibility_date
  compatibility_flags = var.worker_compatibility_flags

  assets = var.enable_worker_assets ? {
    directory = var.worker_assets_directory
    config = {
      run_worker_first   = true
      not_found_handling = "single-page-application"
    }
  } : null

  bindings = [
    {
      type = "d1"
      name = "DB"
      id   = cloudflare_d1_database.database[0].id
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
      text = coalesce(local.launch_url, "")
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
  ]

  lifecycle {
    precondition {
      condition     = trimspace(var.worker_bundle_sha256) == "" || trimspace(var.worker_bundle_sha256) == filesha256(var.worker_bundle_path)
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
