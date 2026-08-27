import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const containerMock = vi.fn(() => 'the-container');
const databaseMock = vi.fn(() => ({ container: containerMock }));
vi.mock('@azure/cosmos', () => ({
  CosmosClient: vi.fn(function CosmosClient(this: { database: typeof databaseMock }) {
    this.database = databaseMock;
  }),
}));

const { leaguesContainer, draftsContainer, __resetCosmosClient } = await import('./cosmos.js');

beforeEach(() => {
  __resetCosmosClient();
  vi.clearAllMocks();
  delete process.env.COSMOS_ENDPOINT;
  delete process.env.COSMOS_KEY;
});

afterEach(() => {
  delete process.env.COSMOS_ENDPOINT;
  delete process.env.COSMOS_KEY;
});

describe('cosmos client', () => {
  it('throws a clear error when COSMOS_ENDPOINT/COSMOS_KEY are not configured', () => {
    expect(() => leaguesContainer()).toThrow(/COSMOS_ENDPOINT/);
  });

  it('resolves the leagues and drafts containers once configured', () => {
    process.env.COSMOS_ENDPOINT = 'https://example.documents.azure.com';
    process.env.COSMOS_KEY = 'key';

    expect(leaguesContainer()).toBe('the-container');
    expect(containerMock).toHaveBeenCalledWith('leagues');

    expect(draftsContainer()).toBe('the-container');
    expect(containerMock).toHaveBeenCalledWith('drafts');
  });
});
