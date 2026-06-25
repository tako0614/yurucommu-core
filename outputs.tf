output "takosumi_release" {
  value = {
    post_apply = [
      {
        id                = "activate"
        executor          = "operator"
        command           = ["bun", "run", "app:activate"]
        working_directory = "."
      },
    ]
  }
}

output "service_exports" {
  description = "Takosumi Service Graph exports projected from OpenTofu outputs without resource descriptors."
  value = [
    {
      name         = "launcher"
      capabilities = ["interface.ui.surface"]
      endpoints = [
        {
          name       = "default"
          protocol   = "https"
          pathPrefix = "/"
        }
      ]
      metadata = {
        title       = "Yurucommu"
        description = "Your own self-hosted ActivityPub SNS — posts, messaging, and stories, where the communities you inhabit are your reach."
        category    = "social"
      }
      visibility = "space"
    },
  ]
}

output "service_bindings" {
  description = "Runtime service grants requested by Yurucommu without Takos-specific resource descriptors."
  value = [
    {
      name = "web_launcher"
      target = {
        kind = "workload"
        name = "web"
        metadata = {
          componentKind = "worker"
        }
      }
      selector = {
        name         = "launcher"
        producer     = "self"
        capabilities = ["interface.ui.surface"]
      }
      grant_request = {
        scopes   = []
        audience = ["web"]
        env      = ["APP_URL"]
        metadata = {
          inject = {
            env = {
              url = "APP_URL"
            }
          }
        }
      }
    },
    {
      name = "web_identity_oidc"
      target = {
        kind = "workload"
        name = "web"
        metadata = {
          componentKind = "worker"
        }
      }
      selector = {
        name         = "identity.oidc"
        capabilities = ["identity.oidc"]
      }
      grant_request = {
        scopes   = ["openid", "profile", "email"]
        audience = ["web"]
        env = [
          "TAKOSUMI_ACCOUNTS_ISSUER_URL",
          "TAKOSUMI_ACCOUNTS_CLIENT_ID",
        ]
        metadata = {
          sourceRef = "takosumi.identity.oidc"
        }
      }
    },
  ]
}

output "cloudflare_account_id" {
  description = "Cloudflare account id used for the Yurucommu backing resources, or null when Cloudflare resource provisioning is disabled."
  value       = local.cloudflare_resources_enabled ? var.cloudflare_account_id : null
}

output "cloudflare_d1_database_id" {
  description = "D1 database id for the DB binding, or null when Cloudflare resource provisioning is disabled."
  value       = try(cloudflare_d1_database.database[0].id, null)
}

output "cloudflare_d1_database_name" {
  description = "D1 database name for the DB binding."
  value       = local.d1_database_name
}

output "cloudflare_r2_bucket_name" {
  description = "R2 bucket name for the MEDIA binding."
  value       = local.r2_media_bucket
}

output "cloudflare_kv_namespace_id" {
  description = "Workers KV namespace id for the KV binding, or null when Cloudflare resource provisioning is disabled."
  value       = try(cloudflare_workers_kv_namespace.kv[0].id, null)
}

output "cloudflare_queue_names" {
  description = "Cloudflare Queue names for the delivery queue bindings."
  value = {
    delivery     = local.delivery_queue_name
    delivery_dlq = local.delivery_dlq_name
  }
}

output "cloudflare_binding_summary" {
  description = "Non-secret binding names and backing resource names used by the Yurucommu Worker artifact activation command."
  value = {
    db = {
      binding       = "DB"
      database_name = local.d1_database_name
      database_id   = try(cloudflare_d1_database.database[0].id, null)
    }
    media = {
      binding     = "MEDIA"
      bucket_name = local.r2_media_bucket
    }
    kv = {
      binding      = "KV"
      namespace_id = try(cloudflare_workers_kv_namespace.kv[0].id, null)
    }
    queues = {
      delivery = {
        binding = "DELIVERY_QUEUE"
        name    = local.delivery_queue_name
      }
      delivery_dlq = {
        binding = "DELIVERY_DLQ"
        name    = local.delivery_dlq_name
      }
    }
  }
}
