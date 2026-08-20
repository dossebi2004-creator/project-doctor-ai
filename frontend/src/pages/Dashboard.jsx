import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';
import LoadingSpinner from '../components/LoadingSpinner.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import EmptyState from '../components/EmptyState.jsx';

const STATUS_LABEL = {
  pending: 'Pending',
  analyzing: 'Analyzing…',
  completed: 'Completed',
  failed: 'Failed',
};

export default function Dashboard() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await api.get('/projects');
        if (!cancelled) setProjects(res.data.data.projects);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <LoadingSpinner label="Loading your projects..." />;

  return (
    <div className="page">
      <div className="page-header">
        <h1>Your projects</h1>
        <Link to="/projects/new" className="btn-primary">
          + New analysis
        </Link>
      </div>

      <ErrorBanner message={error} />

      {!error && projects.length === 0 && (
        <EmptyState
          title="No projects yet"
          description="Submit a repository URL, paste code, or upload files to get your first AI diagnosis."
          action={
            <Link to="/projects/new" className="btn-primary">
              Start your first analysis
            </Link>
          }
        />
      )}

      <div className="project-grid">
        {projects.map((project) => (
          <Link to={`/projects/${project._id}`} key={project._id} className="project-card">
            <div className="project-card-header">
              <h3>{project.name}</h3>
              <span className={`status-badge status-${project.status}`}>
                {STATUS_LABEL[project.status] || project.status}
              </span>
            </div>
            {project.description && <p>{project.description}</p>}
            <p className="project-card-meta">
              {project.files?.length ?? 0} file(s) &middot;{' '}
              {new Date(project.createdAt).toLocaleDateString()}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
