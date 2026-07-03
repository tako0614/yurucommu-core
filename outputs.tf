output "takosumi_release" {
  value = {
    post_apply = concat(
      local.cloudflare_worker_enabled ? [
        {
          id                = "migrate"
          executor          = "runner"
          command           = ["bun", "run", "takosumi:release", "--", "--migrations-only"]
          working_directory = "."
        },
      ] : [],
      local.cloudflare_worker_enabled ? [] : [
        {
          id                = "release"
          executor          = "operator"
          command           = ["bun", "run", "takosumi:release"]
          working_directory = "."
        },
      ],
    )
    pre_destroy = local.cloudflare_worker_enabled ? [] : [
      {
        id                = "release-destroy"
        executor          = "operator"
        command           = ["bun", "run", "takosumi:release", "--", "--destroy"]
        working_directory = "."
      },
    ]
  }
}

output "worker_name" {
  description = "Cloudflare Worker name used when enable_cloudflare_worker_script is true."
  value       = local.worker_name
}

output "worker_managed_by_opentofu" {
  description = "True when the Worker script, bindings, assets, queue consumers, and workers.dev enablement are managed by OpenTofu."
  value       = local.cloudflare_worker_enabled
}

output "cloudflare_worker_script_id" {
  description = "OpenTofu-managed Cloudflare Worker script ID, or null when enable_cloudflare_worker_script is false."
  value       = try(cloudflare_workers_script.worker[0].id, null)
}

output "cloudflare_worker_route_id" {
  description = "OpenTofu-managed Cloudflare Worker route ID, or null when cloudflare_route_zone_id/cloudflare_route_pattern are not set."
  value       = try(cloudflare_workers_route.worker[0].id, null)
}

output "launch_url" {
  description = "Public URL for the published Yurucommu instance, when the Capsule has enough hostname input to derive it."
  value       = local.launch_url
}

output "url" {
  description = "Alias for launch_url for generic Takosumi public URL smoke checks."
  value       = local.launch_url
}

output "app_deployment" {
  description = "Installable app declaration consumed from tofu output -json by Takos/Takosumi install flows."
  value = {
    contractVersion = 1
    name            = "yurucommu"
    version         = "2.0.0"

    compute = {
      web = {
        kind      = "worker"
        readiness = "/healthz"
        triggers = {
          queues = [
            {
              binding         = "DELIVERY_QUEUE"
              deadLetterQueue = "delivery_dlq"
              maxBatchSize    = 10
              maxRetries      = 3
              maxWaitTimeMs   = 1000
            },
            {
              binding       = "DELIVERY_DLQ"
              maxBatchSize  = 10
              maxRetries    = 1
              maxWaitTimeMs = 60000
            },
          ]
        }
      }
    }

    resources = {
      database = {
        type = "sql"
        bind = "DB"
        to   = ["web"]
      }
      media = {
        type = "object-store"
        bind = "MEDIA"
        to   = ["web"]
      }
      kv = {
        type = "key-value"
        bind = "KV"
        to   = ["web"]
      }
      delivery = {
        type = "queue"
        bind = "DELIVERY_QUEUE"
        to   = ["web"]
        queue = {
          deadLetterQueue = "delivery_dlq"
          maxRetries      = 3
        }
      }
      delivery_dlq = {
        type = "queue"
        bind = "DELIVERY_DLQ"
        to   = ["web"]
        queue = {
          maxRetries = 1
        }
      }
    }

    routes = [
      {
        id     = "root"
        target = "web"
        path   = "/"
      },
    ]

    publish = [
      {
        name      = "launcher"
        publisher = "web"
        type      = "interface.ui.surface"
        outputs = {
          url = {
            kind     = "url"
            routeRef = "root"
          }
        }
        display = {
          title       = "Yurucommu"
          description = "Self-hosted ActivityPub social app for posts, messaging, stories, and small communities."
          category    = "social"
        }
        spec = {
          launcher = true
        }
      },
    ]

    env = {
      APP_URL = local.launch_url != null ? local.launch_url : ""
    }
  }
}


output "service_exports" {
  description = "OpenTofu output projection for launch and endpoint metadata without Takosumi-specific resource descriptors."
  value = [
    {
      name         = "launcher"
      capabilities = ["interface.ui.surface"]
      endpoints = [
        {
          name       = "default"
          protocol   = "https"
          pathPrefix = "/"
          url        = local.launch_url
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
    worker = {
      name       = local.worker_name
      launch_url = local.launch_url
    }
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
