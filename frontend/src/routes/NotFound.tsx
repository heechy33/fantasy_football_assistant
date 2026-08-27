import { Link } from 'react-router-dom';
import { APP_NAME } from '../components/TopNav';

export function NotFound() {
  return (
    <section className="draft-room-empty">
      <div className="section-heading">
        <div>
          <p className="eyebrow">404</p>
          <h2>Page not found</h2>
        </div>
      </div>
      <p>That URL doesn&apos;t exist.</p>
      <Link to="/" className="primary-button">Back to {APP_NAME}</Link>
    </section>
  );
}
