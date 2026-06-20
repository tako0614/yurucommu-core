output "takos_app" {
  value = {
    name    = "yurucommu"
    version = "1.0.0"

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
        # its own `launcher` UiSurface publication (routeRef = "root") and the
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
        type       = "sql"
        migrations = "migrations"
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
        type      = "UiSurface"
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
