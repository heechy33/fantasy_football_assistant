import { CosmosClient, type Container } from '@azure/cosmos';

/**
 * Lazy client: constructing `CosmosClient` at module load would crash every Function's cold
 * start (including `health`, which imports nothing from here) whenever the app settings are
 * unset — e.g. this repo's default dev environment, which runs the Sleeper track with no
 * persistence at all (CLAUDE.md's $0/month, Cosmos-only-when-needed stance). Constructing on
 * first actual use means only `leagues`/`drafts` requests need the setting configured.
 */
let client: CosmosClient | null = null;

function getClient(): CosmosClient {
  if (!client) {
    const endpoint = process.env.COSMOS_ENDPOINT;
    const key = process.env.COSMOS_KEY;
    if (!endpoint || !key) {
      throw new Error('COSMOS_ENDPOINT/COSMOS_KEY app settings are not configured.');
    }
    client = new CosmosClient({ endpoint, key });
  }
  return client;
}

const DATABASE_ID = process.env.COSMOS_DATABASE ?? 'ffa';

function container(id: string): Container {
  return getClient().database(DATABASE_ID).container(id);
}

/** `leagues`/`drafts` containers, both partitioned on `/userId` (infra/main.bicep) — every query
 * here is a single-partition point lookup or a partition-scoped list, never a cross-partition
 * fan-out. Container ids come from the app settings `infra/main.bicep` provisions
 * (`COSMOS_LEAGUES_CONTAINER`/`COSMOS_DRAFTS_CONTAINER`), falling back to the same literal names
 * used there so local dev works without setting them explicitly. */
export function leaguesContainer(): Container {
  return container(process.env.COSMOS_LEAGUES_CONTAINER ?? 'leagues');
}

export function draftsContainer(): Container {
  return container(process.env.COSMOS_DRAFTS_CONTAINER ?? 'drafts');
}

/** Test-only: forces the next call to reconstruct the client (e.g. after stubbing env vars). */
export function __resetCosmosClient(): void {
  client = null;
}
