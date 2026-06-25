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

locals {
  cloudflare_resources_enabled = var.enable_cloudflare_resources
  resource_prefix              = var.project_name

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
