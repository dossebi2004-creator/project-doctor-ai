import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../api/client';
import LoadingSpinner from '../components/LoadingSpinner.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import EmptyState from '../components/EmptyState.jsx';

const SEVERITY_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];
const DIMENSION_LABELS = {
  testing: 'Testing',
  documentation: 'Documentation',
  security: 'Security',
  maintainability: 'Maintainability',
  devops: 'DevOps',
  architecture: 'Architecture',
};
const PRIORITY_LABELS = {
  P0: 'P0 — Fix immediately',
  P1: 'P1 — High priority',
  P2: 'P2 — Medium priority',
  P3: 'P3 — Low priority / nice to have',
};

function healthInterpretation(score) {
  if (score >= 90) return { label: 'Excellent', tier: 'good' };
  if (score >= 75) return { label: 'Good', tier: 'good' };
  if (score >= 50) return { label: 'Needs Improvement', tier: 'medium' };
  return { label: 'Critical', tier: 'poor' };
}

function scoreTier(score) {
  if (score >= 80) return 'good';
  if (score >= 50) return 'medium';
  return 'poor';
}

export default function DiagnosisReport() {
  const { id } = useParams();
  const [diagnosis, setDiagnosis] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(null);

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

  const handleExportPdf = async () => {
    setExportError(null);
    setExporting(true);
    try {
      const res = await api.get(`/diagnoses/${id}/export/pdf`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `diagnosis-${id}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err.message || 'Failed to export PDF. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  if (loading) return <LoadingSpinner label="Loading report..." />;
  if (error) return <ErrorBanner message={error} />;
  if (!diagnosis) return null;

  const project = diagnosis.project && typeof diagnosis.project === 'object' ? diagnosis.project : null;

  if (diagnosis.status === 'failed') {
    return (
      <div className="page">
        <ProjectHeader project={project} diagnosis={diagnosis} />
        <EmptyState
          title="Analysis failed"
          description={diagnosis.errorMessage || 'The diagnosis could not be completed. Please try running it again.'}
        />
        {project && (
          <Link to={`/projects/${project._id || diagnosis.project}`} className="btn-secondary">
            Back to project
          </Link>
        )}
      </div>
    );
  }

  const findings = [...(diagnosis.findings || [])].sort(
    (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity)
  );
  const dimensionEntries = Object.entries(diagnosis.dimensionScores || {});
  const actionPlan = diagnosis.actionPlan || { P0: [], P1: [], P2: [], P3: [] };
  const totalActionItems = Object.values(actionPlan).reduce((sum, arr) => sum + (arr?.length || 0), 0);
  const interpretation = healthInterpretation(diagnosis.healthScore);
  const analysis = diagnosis.analysisSnapshot;

  return (
    <div className="page">
      <ProjectHeader project={project} diagnosis={diagnosis} />

      {diagnosis.status === 'deterministic_only' && (
        <div className="notice-banner" role="status">
          <strong>Deterministic-only analysis.</strong> The AI reasoning step didn&apos;t complete
          {diagnosis.errorMessage ? ` (${diagnosis.errorMessage})` : ''}, so this report reflects only
          the rule-based project analysis — no AI-generated findings are included. The health score
          below was computed from analyzer signals alone.
        </div>
      )}

      <div className="page-header">
        <div>
          <h1>Diagnosis report</h1>
          <p className={`health-interpretation health-interpretation-${interpretation.tier}`}>
            {interpretation.label}
          </p>
        </div>
        <div className="report-header-actions">
          <div className={`health-score health-score-${scoreTier(diagnosis.healthScore)}`}>
            {diagnosis.healthScore}
            <span>/100</span>
          </div>
          <button type="button" className="btn-secondary" onClick={handleExportPdf} disabled={exporting}>
            {exporting ? 'Exporting...' : 'Export PDF Report'}
          </button>
        </div>
      </div>

      <ErrorBanner message={exportError} />

      {dimensionEntries.length > 0 && (
        <section>
          <h2>Dimension scores</h2>
          <div className="dimension-grid">
            {dimensionEntries.map(([key, dim]) => (
              <div key={key} className="dimension-card">
                <div className="dimension-card-header">
                  <h3>{DIMENSION_LABELS[key] || key}</h3>
                  <span className={`dimension-score dimension-score-${scoreTier(dim.score)}`}>{dim.score}</span>
                </div>
                {dim.reasons && dim.reasons.length > 0 && (
                  <ul className="dimension-reasons">
                    {dim.reasons.map((reason, i) => (
                      <li key={i}>{reason}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {analysis && (
        <section>
          <h2>Project intelligence</h2>
          <p className="muted">Deterministic signals detected from the source files — computed without AI.</p>
          <div className="intelligence-grid">
            <IntelligenceCard title="Languages">
              {analysis.languages?.length > 0
                ? analysis.languages.map((l) => `${l.language} (${l.fileCount})`).join(', ')
                : 'None detected'}
            </IntelligenceCard>
            <IntelligenceCard title="Frameworks">
              {analysis.frameworks?.length > 0 ? analysis.frameworks.join(', ') : 'None detected'}
            </IntelligenceCard>
            <IntelligenceCard title="Dependencies">
              {analysis.dependencies?.dependencyCount ?? 0} ({analysis.dependencies?.ecosystem || 'unknown'})
            </IntelligenceCard>
            <IntelligenceCard title="Tests">
              {analysis.testing?.hasTests
                ? `${analysis.testing.testFileCount} test file(s) found`
                : 'No test files detected'}
            </IntelligenceCard>
            <IntelligenceCard title="Documentation">
              {analysis.documentation?.hasReadme ? 'README present' : 'No README'}
              {analysis.documentation?.hasLicense ? ' · LICENSE present' : ' · No LICENSE'}
            </IntelligenceCard>
            <IntelligenceCard title="CI/CD">
              {analysis.ci?.hasCI ? `${analysis.ci.ciFiles.length} workflow file(s)` : 'No CI configuration detected'}
            </IntelligenceCard>
            <IntelligenceCard title="Docker">
              {analysis.docker?.hasDocker ? 'Dockerfile present' : 'No Dockerfile'}
              {analysis.docker?.hasDockerCompose ? ' · docker-compose present' : ''}
            </IntelligenceCard>
            <IntelligenceCard title="Large files">
              {analysis.largeFiles?.length > 0 ? `${analysis.largeFiles.length} unusually large file(s)` : 'None'}
            </IntelligenceCard>
            <IntelligenceCard title="TODO / debug markers">
              {analysis.todos?.totalTodos ?? 0} TODOs · {analysis.debugStatements?.totalDebugStatements ?? 0} debug
              statement(s)
            </IntelligenceCard>
            <IntelligenceCard title="Security signals">
              {analysis.possibleSecrets?.possibleSecretsFound
                ? `${analysis.possibleSecrets.count} possible hardcoded secret(s) flagged`
                : 'No hardcoded secrets detected'}
            </IntelligenceCard>
          </div>
        </section>
      )}

      <section>
        <h2>Findings ({findings.length})</h2>
        {findings.length === 0 ? (
          <EmptyState
            title="No issues found"
            description={
              diagnosis.status === 'deterministic_only'
                ? 'AI review did not run for this report.'
                : "The AI review didn't flag any specific findings."
            }
          />
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
                {f.description && <p>{f.description}</p>}
                {f.evidence && (
                  <p className="finding-evidence">
                    <strong>Evidence:</strong> <code>{f.evidence}</code>
                  </p>
                )}
                {f.reasoning && (
                  <p>
                    <strong>Why it matters:</strong> {f.reasoning}
                  </p>
                )}
                {f.recommendation && (
                  <p className="finding-recommendation">
                    <strong>Recommendation:</strong> {f.recommendation}
                  </p>
                )}
                {f.estimatedImpact && (
                  <p className="finding-impact">
                    <strong>Estimated impact:</strong> {f.estimatedImpact}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>Priority action plan ({totalActionItems})</h2>
        {totalActionItems === 0 ? (
          <EmptyState title="Nothing to action" description="No prioritized recommendations were generated." />
        ) : (
          Object.entries(actionPlan).map(([priority, items]) =>
            items.length === 0 ? null : (
              <div key={priority} className="action-plan-group">
                <h3 className={`action-plan-heading priority-${priority}`}>{PRIORITY_LABELS[priority] || priority}</h3>
                <ul className="action-plan-list">
                  {items.map((item, idx) => (
                    <li key={idx}>
                      <span className="category-badge">{item.category}</span> {item.title}
                      {item.file && <code className="finding-file"> · {item.file}</code>}
                      <p>{item.recommendation}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )
          )
        )}
      </section>
    </div>
  );
}

function IntelligenceCard({ title, children }) {
  return (
    <div className="intelligence-card">
      <h4>{title}</h4>
      <p>{children}</p>
    </div>
  );
}

function ProjectHeader({ project, diagnosis }) {
  return (
    <div className="project-header">
      <div>
        <h2 className="project-header-name">{project?.name || 'Project'}</h2>
        <p className="muted">
          {project?.sourceType === 'repo_url' && project?.repoUrl
            ? project.repoUrl
            : project?.sourceType
              ? sourceLabel(project.sourceType)
              : 'Source unavailable'}
        </p>
      </div>
      <div className="project-header-meta">
        <span className={`status-badge status-${diagnosis.status === 'completed' ? 'completed' : diagnosis.status === 'deterministic_only' ? 'analyzing' : 'failed'}`}>
          {diagnosis.status === 'completed'
            ? 'Full analysis'
            : diagnosis.status === 'deterministic_only'
              ? 'Deterministic-only'
              : 'Failed'}
        </span>
        <span className="muted">{new Date(diagnosis.createdAt).toLocaleString()}</span>
      </div>
    </div>
  );
}

function sourceLabel(sourceType) {
  if (sourceType === 'upload') return 'Uploaded files';
  if (sourceType === 'paste') return 'Pasted code';
  return sourceType;
}
