output "takos_app" {
  value = {
    name    = "yurucommu"
    version = "2.0.0"

    compute = {
      web = {
        kind      = "worker"
        readiness = "/readyz"
        # Inject the install's resolved public URL into the worker env.
        #
        # APP_URL is a HARD readiness precondition (see src/backend/index.ts
        # collectMissingRequiredBindings) AND the ActivityPub origin used to
        # mint actor / object ids, so it must be the install's REAL routed
        # hostname, not a value an operator hand-edits after the fact. The
        # routed hostname is only known at apply time, so the Capsule cannot
        # bake it as a literal `env` entry. Instead the worker self-consumes
        # its own `launcher` interface.ui.surface publication (routeRef = "root") and the
        # deploy pipeline resolves that publication's `url` output to the
        # group/install hostname and injects it as APP_URL. This is the same
        # ServiceExport/consume URL-injection mechanism the platform uses for
        # cross-app endpoints, applied to the workload's own root route.
        consume = [
          {
            publication = "launcher"
            inject = {
              env = {
                url = "APP_URL"
              }
            }
          },
          # Auto-provision "Sign in with Takosumi Accounts": consume the
          # accounts-plane `identity.oidc` capability so a `tofu apply`
          # materializes a PUBLIC OIDC client for this install (auto client_id +
          # redirect_uri derived from the routed hostname) and injects the
          # issuer + client_id into the worker env. The worker reads those
          # (getOidcIssuerUrl / getOidcClientCredentials) and offers the provider
          # from the start — no operator-typed secret or hand-registered
          # redirect. The materialized client is PUBLIC (PKCE-only, no secret),
          # which the worker accepts; password-bootstrap auth (auth_password_hash
          # below) remains the fallback when no accounts plane is wired.
          {
            publication = "identity.oidc"
            inject = {
              env = {
                issuerUrl = "TAKOSUMI_ACCOUNTS_ISSUER_URL"
                clientId  = "TAKOSUMI_ACCOUNTS_CLIENT_ID"
              }
            }
          },
        ]
        triggers = {
          queues = [
            {
              binding           = "DELIVERY_QUEUE"
              deadLetterQueue   = "DELIVERY_DLQ"
              maxBatchSize      = 10
              maxRetries        = 3
              maxWaitTimeMs     = 1000
              retryDelaySeconds = 0
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
        bindings = {
          web = "DB"
        }
      }
      media = {
        type = "object-store"
        bindings = {
          web = "MEDIA"
        }
      }
      kv = {
        type = "key-value"
        bindings = {
          web = "KV"
        }
      }
      delivery_queue = {
        type = "queue"
        bindings = {
          web = "DELIVERY_QUEUE"
        }
        queue = {
          deadLetterQueue = "DELIVERY_DLQ"
          maxRetries      = 3
        }
      }
      delivery_dlq = {
        type = "queue"
        bindings = {
          web = "DELIVERY_DLQ"
        }
        queue = {
          maxRetries = 1
        }
      }
      encryption_key = {
        type     = "secret"
        bind     = "ENCRYPTION_KEY"
        to       = ["web"]
        generate = true
      }
      session_hash_salt = {
        type     = "secret"
        bind     = "YURUCOMMU_SESSION_HASH_SALT"
        to       = ["web"]
        generate = true
      }
      # Bootstrap auth method so a fresh `tofu apply` satisfies the worker
      # readiness AUTH_METHOD gate (see src/backend/index.ts: readiness passes
      # when any of AUTH_PASSWORD_HASH / Google / X / Accounts-OIDC is present).
      # Without this, a fresh auto-install would 503 /readyz with no auth
      # provider configured and be unusable until an operator manually set an
      # auth secret. Generating AUTH_PASSWORD_HASH makes the password auth
      # method "present" so the install comes up ready out of the box. The
      # worker now treats a generated single-token AUTH_PASSWORD_HASH (a
      # colon-less value, i.e. not the `salt:hash` PBKDF2 form) as a BOOTSTRAP
      # shared secret: the operator logs in for the first time by entering this
      # generated value as the password (constant-time compared — see
      # lib/crypto.ts verifyBootstrapOrPassword), then should rotate to a real
      # password or promote to Accounts OIDC / OAuth. So a fresh `tofu apply`
      # install is both ready AND loginnable out of the box.
      auth_password_hash = {
        type     = "secret"
        bind     = "AUTH_PASSWORD_HASH"
        to       = ["web"]
        generate = true
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
          description = "Your own self-hosted ActivityPub SNS — posts, messaging, and stories, where the communities you inhabit are your reach."
          category    = "social"
          sortOrder   = 50
        }
        spec = {
          launcher = true
        }
      },
    ]

    env = {}

  }
}

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
