import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../api/client';
import LoadingSpinner from '../components/LoadingSpinner.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import EmptyState from '../components/EmptyState.jsx';

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'];

export default function DiagnosisReport() {
  const { id } = useParams();
  const [diagnosis, setDiagnosis] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await api.get(`/diagnoses/${id}`);
        if (!cancelled) setDiagnosis(res.data.data.diagnosis);
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
  }, [id]);

  if (loading) return <LoadingSpinner label="Loading report..." />;
  if (error) return <ErrorBanner message={error} />;
  if (!diagnosis) return null;

  const findings = [...(diagnosis.findings || [])].sort(
    (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity)
  );

  return (
    <div className="page">
      <div className="page-header">
        <h1>Diagnosis report</h1>
        <div className={`health-score health-score-${scoreTier(diagnosis.healthScore)}`}>
          {diagnosis.healthScore}
          <span>/100</span>
        </div>
      </div>

      <p className="report-summary">{diagnosis.summary}</p>

      <section>
        <h2>Findings ({findings.length})</h2>
        {findings.length === 0 ? (
          <EmptyState title="No issues found" description="The AI agent didn't flag any specific findings." />
        ) : (
          <ul className="findings-list">
            {findings.map((f, idx) => (
              <li key={idx} className={`finding-card severity-${f.severity}`}>
                <div className="finding-header">
                  <span className={`severity-badge severity-${f.severity}`}>{f.severity}</span>
                  <span className="category-badge">{f.category}</span>
                  <h3>{f.title}</h3>
                </div>
                {f.file && <code className="finding-file">{f.file}</code>}
                <p>{f.explanation}</p>
                <p className="finding-recommendation">
                  <strong>Recommendation:</strong> {f.recommendation}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function scoreTier(score) {
  if (score >= 80) return 'good';
  if (score >= 50) return 'medium';
  return 'poor';
}
