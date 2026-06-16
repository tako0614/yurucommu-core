output "takos_app" {
  value = {
    name    = "yurucommu"
    version = "1.0.0"

    compute = {
      web = {
        kind      = "worker"
        readiness = "/readyz"
        triggers = {
          queues = [
            {
              binding          = "DELIVERY_QUEUE"
              deadLetterQueue  = "DELIVERY_DLQ"
              maxBatchSize     = 10
              maxRetries       = 3
              maxWaitTimeMs    = 1000
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
          description = "Self-hosted ActivityPub community social app for small communities."
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
