import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { TeamsPage } from './components/TeamsPage';
import { AuthProvider } from './auth/AuthProvider';
import { RequireAuth } from './auth/RequireAuth';
import { SignInRoute, SignUpRoute } from './routes/AuthRoute';
import { AppLayout } from './routes/AppLayout';
import { DraftGuideRoute } from './routes/DraftGuideRoute';
import { DraftRoomRoute } from './routes/DraftRoomRoute';
import { LandingRoute } from './routes/LandingRoute';
import { NotFound } from './routes/NotFound';
import { OnboardingLayout, OnboardingPlan, OnboardingReady } from './routes/onboarding/OnboardingLayout';
import { OnboardingLeague } from './routes/onboarding/OnboardingLeague';
import { DraftSessionProvider } from './session/DraftSessionProvider';
import './App.css';

/**
 * Route tree. The structural constraint that shapes it: `DraftSessionProvider` owns the live poll
 * and ESPN bridge, so it MUST sit above `<Routes>` — inside a route element it would unmount on
 * navigation and silently kill a live draft (guarded by routes/routes.test.tsx's provider-
 * persistence test). `AuthProvider` sits alongside it, also above `<Routes>`, so a signed-out
 * visitor's local draft session keeps rehydrating even while `/draft` redirects them to sign in
 * (see RequireAuth's doc) — signing in and landing back on `/draft` finds it exactly as they left it.
 *
 * `/draft`, `/teams`, and `/onboarding/*` are account-required (DECISIONS.md, 2026-08-25/26):
 * `RequireAuth` gates them and sends a signed-out visitor to `/sign-in` with a return-to.
 */
export function AppRoutes() {
  return (
    <AuthProvider>
      <DraftSessionProvider>
        <Routes>
          <Route element={<AppLayout />}>
            <Route index element={<LandingRoute />} />
            <Route path="draft-guide" element={<DraftGuideRoute />} />
            <Route path="sign-in" element={<SignInRoute />} />
            <Route path="sign-up" element={<SignUpRoute />} />
            <Route element={<RequireAuth />}>
              <Route path="draft" element={<DraftRoomRoute />} />
              <Route path="teams" element={<TeamsPage />} />
              <Route path="onboarding" element={<OnboardingLayout />}>
                <Route index element={<OnboardingLeague />} />
                <Route path="league" element={<OnboardingLeague />} />
                <Route path="plan" element={<OnboardingPlan />} />
                <Route path="ready" element={<OnboardingReady />} />
              </Route>
            </Route>
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </DraftSessionProvider>
    </AuthProvider>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}

