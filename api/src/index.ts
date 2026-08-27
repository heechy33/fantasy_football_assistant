// Azure Functions v4 programming model: functions self-register via `app.http(...)`
// when their module is imported. This file is the single entry point (see
// `main` in package.json) that pulls every function module in, so registration
// is explicit and greppable instead of relying on directory scanning.

import './functions/health.js';
import './functions/leagues.js';
import './functions/drafts.js';
