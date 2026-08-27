import { Link, Outlet, useLocation } from 'react-router-dom';

const STEPS = ['Account', 'League', 'Plan', 'Ready'] as const;

function stepForPathname(pathname: string): number {
  if (pathname.endsWith('/league')) return 1;
  if (pathname.endsWith('/plan')) return 2;
  if (pathname.endsWith('/ready')) return 3;
  return 1;
}

/**
 * The post-signup connect flow's shell: a four-step rail (Account → League → Plan → Ready).
 * "Account" is always shown complete — the route is auth-guarded once Phase 4 lands, so reaching
 * any step proves that step happened.
 */
export function OnboardingLayout() {
  const location = useLocation();
  const current = stepForPathname(location.pathname);

  return (
    <section className="onboarding" aria-label="Set up your league">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Setup</p>
          <h2>Connect your league</h2>
        </div>
      </div>
      <ol className="onboarding-rail">
        {STEPS.map((label, index) => (
          <li
            key={label}
            className="onboarding-step"
            data-state={index < current ? 'done' : index === current ? 'current' : 'todo'}
            aria-current={index === current ? 'step' : undefined}
          >
            {index < current || index === 0 ? label : `${index + 1}. ${label}`}
          </li>
        ))}
      </ol>

      <Outlet />
    </section>
  );
}

/** Step 3 is copy-only in beta — no tier logic ships until a paid tier is a real decision. */
export function OnboardingPlan() {
  return (
    <div className="onboarding-panel">
      <h3>Your plan</h3>
      <p>Free while in beta. Everything you just set up stays exactly as it is.</p>
      <Link to="/onboarding/ready" className="primary-button">Continue</Link>
    </div>
  );
}

/** Final step: hand off to the league hub — the new home for everything league-shaped. */
export function OnboardingReady() {
  return (
    <div className="onboarding-panel">
      <h3>You&apos;re set</h3>
      <p>Your league is connected. Track its draft live whenever things kick off.</p>
      <Link to="/leagues" className="primary-button">Go to My Leagues</Link>
    </div>
  );
}
