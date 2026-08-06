import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';

// Proves the SWA -> managed Functions wiring end to end (Phase 0 exit
// criterion). Real endpoints (draft-init, draft-picks, ...) land in later
// phases behind the ProviderAdapter interface in shared/types.d.ts.
export async function health(
  _req: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  return {
    status: 200,
    jsonBody: {
      status: 'ok',
      service: 'ffa-api',
      time: new Date().toISOString(),
    },
  };
}

app.http('health', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'health',
  handler: health,
});
