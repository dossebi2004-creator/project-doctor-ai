import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="page empty-state">
      <h1>404</h1>
      <p>The page you&apos;re looking for doesn&apos;t exist.</p>
      <Link to="/dashboard" className="btn-primary">
        Back to dashboard
      </Link>
    </div>
  );
}
