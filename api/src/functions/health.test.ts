import { describe, expect, it } from 'vitest';
import type { HttpRequest, InvocationContext } from '@azure/functions';
import { health } from './health.js';

describe('health', () => {
  it('responds 200 with service identity and a timestamp', async () => {
    const response = await health({} as HttpRequest, {} as InvocationContext);

    expect(response.status).toBe(200);
    expect(response.jsonBody).toMatchObject({
      status: 'ok',
      service: 'ffa-api',
    });
    expect(typeof (response.jsonBody as { time: unknown }).time).toBe('string');
    expect(() => new Date((response.jsonBody as { time: string }).time)).not.toThrow();
  });
});
