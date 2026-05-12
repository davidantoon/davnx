# project.json Examples

## Minimal Setup

```json
{
  "name": "my-service",
  "targets": {
    "build": {
      "executor": "@davnx/webpack:build",
      "dependsOn": ["^build"],
      "options": {
        "entryFile": "./src/main.ts",
        "tsConfigFile": "./tsconfig.app.json"
      }
    },
    "serve": {
      "executor": "@davnx/webpack:serve",
      "options": {
        "entryFile": "./src/main.ts",
        "tsConfigFile": "./tsconfig.app.json"
      }
    }
  }
}
```

## With Workers and OrgScopes

```json
{
  "name": "service",
  "targets": {
    "build": {
      "executor": "@davnx/webpack:build",
      "dependsOn": ["^build"],
      "options": {
        "entryFile": "./src/main.ts",
        "tsConfigFile": "./tsconfig.app.json",
        "workers": [
          { "name": "worker", "entryPath": "./src/workers/main.ts" }
        ],
        "orgScopes": ["@myorg"]
      }
    },
    "serve": {
      "executor": "@davnx/webpack:serve",
      "options": {
        "entryFile": "./src/main.ts",
        "tsConfigFile": "./tsconfig.app.json",
        "workers": [
          { "name": "worker", "entryPath": "./src/workers/main.ts" }
        ],
        "orgScopes": ["@myorg"],
        "gateway": {
          "middleware": "./gateway-middleware.js"
        }
      }
    }
  }
}
```

## Multiple Serve Targets (Different Environments)

```json
{
  "name": "service",
  "targets": {
    "serve": {
      "executor": "@davnx/webpack:serve",
      "options": {
        "entryFile": "./src/main.ts",
        "tsConfigFile": "./tsconfig.app.json",
        "orgScopes": ["@myorg"],
        "gateway": { "middleware": "./gateway-middleware.js" }
      }
    },
    "serve:staging": {
      "executor": "@davnx/webpack:serve",
      "options": {
        "entryFile": "./src/main.ts",
        "tsConfigFile": "./tsconfig.app.json",
        "orgScopes": ["@myorg"],
        "configEnv": "staging",
        "outputPath": "dist/apps/service-staging",
        "gateway": { "middleware": "./staging-middleware.js" }
      }
    }
  }
}
```

## Full-Featured Configuration

```json
{
  "name": "service",
  "targets": {
    "build": {
      "executor": "@davnx/webpack:build",
      "dependsOn": ["^build"],
      "options": {
        "entryFile": "./src/main.ts",
        "tsConfigFile": "./tsconfig.app.json",
        "workers": [
          { "name": "queue-processor", "entryPath": "./src/workers/queue-processor.ts" },
          { "name": "event-listener", "entryPath": "./src/workers/event-listener.ts" }
        ],
        "orgScopes": ["@myorg", "@shared/common"],
        "bundlePackages": ["lodash"],
        "runtimeDependencies": ["pg", "redis"],
        "memoryLimit": 16384,
        "generatePackageJson": true
      }
    },
    "serve": {
      "executor": "@davnx/webpack:serve",
      "options": {
        "entryFile": "./src/main.ts",
        "tsConfigFile": "./tsconfig.app.json",
        "workers": [
          { "name": "queue-processor", "entryPath": "./src/workers/queue-processor.ts" },
          { "name": "event-listener", "entryPath": "./src/workers/event-listener.ts" }
        ],
        "orgScopes": ["@myorg", "@shared/common"],
        "bundlePackages": ["lodash"],
        "childCount": 2,
        "servePrefix": "my-service",
        "serviceName": "my-service",
        "gateway": { "middleware": "./gateway-middleware.js" }
      }
    },
    "preview": {
      "executor": "nx:run-commands",
      "options": {
        "command": "node --enable-source-maps dist/apps/service/main.js"
      }
    }
  }
}
```
