import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import api from '../api/client';
import LoadingSpinner from '../components/LoadingSpinner.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import EmptyState from '../components/EmptyState.jsx';

export default function ProjectDetail() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [project, setProject] = useState(null);
  const [diagnoses, setDiagnoses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState(null);

  const load = useCallback(async () => {
    try {
      const [projectRes, diagnosesRes] = await Promise.all([
        api.get(`/projects/${id}`),
        api.get(`/projects/${id}/diagnoses`),
      ]);
      setProject(projectRes.data.data.project);
      setDiagnoses(diagnosesRes.data.data.diagnoses);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const handleRunDiagnosis = async () => {
    setRunning(true);
    setRunError(null);
    try {
      const res = await api.post(`/projects/${id}/diagnoses`);
      navigate(`/diagnoses/${res.data.data.diagnosis._id}`);
    } catch (err) {
      if (err.status === 409) {
        setRunError('A diagnosis is already running for this project. Please wait for it to finish.');
      } else {
        setRunError(err.message);
      }
      setRunning(false);
    }
  };

  if (loading) return <LoadingSpinner label="Loading project..." />;
  if (error) return <ErrorBanner message={error} />;
  if (!project) return null;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>{project.name}</h1>
          {project.description && <p className="muted">{project.description}</p>}
        </div>
        <button
          type="button"
          className="btn-primary"
          onClick={handleRunDiagnosis}
          disabled={running}
        >
          {running ? 'Analyzing... this can take a minute' : 'Run AI diagnosis'}
        </button>
      </div>

      <ErrorBanner message={runError} />

      <section>
        <h2>Files ({project.files?.length ?? 0})</h2>
        <ul className="file-list">
          {project.files?.map((f) => (
            <li key={f.path}>
              <code>{f.path}</code>
              {f.language && <span className="muted"> · {f.language}</span>}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Diagnosis history</h2>
        {diagnoses.length === 0 ? (
          <EmptyState
            title="No diagnoses yet"
            description="Run the AI diagnosis to get a health score and actionable findings."
          />
        ) : (
          <ul className="diagnosis-list">
            {diagnoses.map((d) => (
              <li key={d._id}>
                <Link to={`/diagnoses/${d._id}`} className="diagnosis-list-link">
                  <span>
                    Health score {d.healthScore}/100 — {new Date(d.createdAt).toLocaleString()}
                  </span>
                  {d.status !== 'completed' && (
                    <span className={`status-badge status-${d.status === 'deterministic_only' ? 'deterministic' : 'failed'}`}>
                      {d.status === 'deterministic_only' ? 'Deterministic-only' : 'Failed'}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
