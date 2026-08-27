// Fantasy Football Co-Pilot — infra for the $0/month footprint described in
// PLAN.md: Static Web Apps Free plan + Cosmos DB free tier.
//
// Cosmos's free tier (1000 RU/s + 25GB, account lifetime) can ONLY be enabled
// at account creation and is one-per-subscription — `enableFreeTier: true`
// below is the whole reason this file exists rather than clicking through the
// portal. Get this right the first time.
//
// Deploy:
//   az login
//   az group create -n ffa-rg -l eastus2
//   az deployment group create -g ffa-rg -f infra/main.bicep \
//       -p yahooClientId=... yahooClientSecret=... credEncryptionKey=$(openssl rand -base64 32)
//
// Then wire GitHub Actions deployment (one-time, manual — Bicep doesn't do the
// GitHub OAuth link that the portal's "create with GitHub" wizard does):
//   az staticwebapp secrets list -n <appName> -g ffa-rg --query "properties.apiKey" -o tsv
//   -> save as the AZURE_STATIC_WEB_APPS_API_TOKEN secret in the GitHub repo
//      (Settings > Secrets and variables > Actions). .github/workflows/deploy.yml
//      expects that exact secret name.

@description('Base name used to derive resource names. Must be globally unique for the Static Web App.')
param appName string = 'ffa-${uniqueString(resourceGroup().id)}'

@description('Region for the Static Web App. Only a subset of regions support SWA — see az staticwebapp locations.')
param location string = 'eastus2'

@description('Region for Cosmos DB. Can differ from the SWA region; pick the one closer to you.')
param cosmosLocation string = location

@secure()
@description('Yahoo OAuth2 client ID. Leave blank to fill in later via `az staticwebapp appsettings set`.')
param yahooClientId string = ''

@secure()
@description('Yahoo OAuth2 client secret.')
param yahooClientSecret string = ''

@secure()
@description('Symmetric key (base64) used to AES-GCM seal ESPN/Yahoo credentials at rest. Generate with `openssl rand -base64 32`.')
param credEncryptionKey string = ''

@description('Clerk issuer URL (e.g. https://your-app.clerk.accounts.dev), used by api/src/auth/verifyClerkJwt.ts to fetch the JWKS and validate the `iss` claim. Not a secret — the Clerk secret key itself is set separately via `az staticwebapp appsettings set`, never committed or added as a Bicep param.')
param clerkIssuer string = ''

var cosmosAccountName = toLower('${appName}-cosmos')
var cosmosDatabaseName = 'ffa'
var cosmosUsersContainerName = 'users'
var cosmosLeaguesContainerName = 'leagues'
var cosmosDraftsContainerName = 'drafts'

resource staticSite 'Microsoft.Web/staticSites@2023-12-01' = {
  name: appName
  location: location
  sku: {
    name: 'Free'
    tier: 'Free'
  }
  properties: {
    // Not linking a `repositoryUrl` here on purpose: Bicep-driven GitHub
    // linking requires a PAT embedded in the template, which we don't want
    // committed anywhere. Deploys instead go through the GitHub Actions
    // workflow using the deployment token pulled post-creation (see header).
    buildProperties: {
      appLocation: 'frontend'
      apiLocation: 'api'
      outputLocation: 'dist'
    }
  }
}

resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' = {
  name: cosmosAccountName
  location: cosmosLocation
  kind: 'GlobalDocumentDB'
  properties: {
    // The load-bearing line. One free-tier account per subscription; cannot
    // be turned on after the account exists.
    enableFreeTier: true
    databaseAccountOfferType: 'Standard'
    consistencyPolicy: {
      defaultConsistencyLevel: 'Session'
    }
    locations: [
      {
        locationName: cosmosLocation
        failoverPriority: 0
        isZoneRedundant: false
      }
    ]
    // Deliberately no `capabilities: [{ name: 'EnableServerless' }]` — the
    // free tier is unavailable on serverless accounts (verified in PLAN.md).
  }
}

resource cosmosDatabase 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-05-15' = {
  parent: cosmosAccount
  name: cosmosDatabaseName
  properties: {
    resource: {
      id: cosmosDatabaseName
    }
    // Shared database-level throughput so it stays inside the free 1000 RU/s
    // pool as more containers get added (waivers/trades in Track B) instead
    // of each container claiming its own minimum.
    options: {
      throughput: 400
    }
  }
}

resource cosmosUsersContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: cosmosDatabase
  name: cosmosUsersContainerName
  properties: {
    resource: {
      id: cosmosUsersContainerName
      // Matches UserRecord.userId in shared/types.d.ts (Clerk's `sub` claim
      // since the 2026-08-25/26 priority change replaced SWA's built-in auth
      // with Clerk) — every read/write is a single-partition point lookup by
      // the signed-in user.
      partitionKey: {
        paths: ['/userId']
        kind: 'Hash'
      }
    }
  }
}

// SavedLeague/SavedDraft (shared/types.d.ts) — same partition-key shape and rationale as
// cosmosUsersContainer above, added for Phase 5's saved-leagues-and-drafts persistence
// (DECISIONS.md, 2026-08-26). Both live inside the same shared 400 RU/s database throughput.
resource cosmosLeaguesContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: cosmosDatabase
  name: cosmosLeaguesContainerName
  properties: {
    resource: {
      id: cosmosLeaguesContainerName
      partitionKey: {
        paths: ['/userId']
        kind: 'Hash'
      }
    }
  }
}

resource cosmosDraftsContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: cosmosDatabase
  name: cosmosDraftsContainerName
  properties: {
    resource: {
      id: cosmosDraftsContainerName
      partitionKey: {
        paths: ['/userId']
        kind: 'Hash'
      }
    }
  }
}

resource appSettings 'Microsoft.Web/staticSites/config@2023-12-01' = {
  parent: staticSite
  name: 'appsettings'
  properties: {
    COSMOS_ENDPOINT: cosmosAccount.properties.documentEndpoint
    COSMOS_KEY: cosmosAccount.listKeys().primaryMasterKey
    COSMOS_DATABASE: cosmosDatabaseName
    COSMOS_USERS_CONTAINER: cosmosUsersContainerName
    COSMOS_LEAGUES_CONTAINER: cosmosLeaguesContainerName
    COSMOS_DRAFTS_CONTAINER: cosmosDraftsContainerName
    CLERK_ISSUER: clerkIssuer
    CRED_ENCRYPTION_KEY: credEncryptionKey
    YAHOO_CLIENT_ID: yahooClientId
    YAHOO_CLIENT_SECRET: yahooClientSecret
    YAHOO_REDIRECT_URI: 'https://${staticSite.properties.defaultHostname}/api/yahoo/callback'
  }
}

output staticWebAppUrl string = 'https://${staticSite.properties.defaultHostname}'
output staticWebAppName string = staticSite.name
output cosmosAccountName string = cosmosAccount.name
output yahooRedirectUri string = 'https://${staticSite.properties.defaultHostname}/api/yahoo/callback'
