import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <header className="navbar">
      <Link to="/" className="navbar-brand">
        Project Doctor AI
      </Link>
      <nav className="navbar-links">
        {user ? (
          <>
            <Link to="/dashboard">Dashboard</Link>
            <Link to="/projects/new">New Analysis</Link>
            <span className="navbar-user">{user.name}</span>
            <button type="button" onClick={handleLogout} className="btn-link">
              Log out
            </button>
          </>
        ) : (
          <>
            <Link to="/login">Log in</Link>
            <Link to="/register" className="btn-primary-sm">
              Sign up
            </Link>
          </>
        )}
      </nav>
    </header>
  );
}
