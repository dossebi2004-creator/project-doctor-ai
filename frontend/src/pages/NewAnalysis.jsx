import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import ErrorBanner from '../components/ErrorBanner.jsx';

const emptyFile = { path: '', language: '', content: '' };

export default function NewAnalysis() {
  const navigate = useNavigate();
  const [sourceType, setSourceType] = useState('repo_url');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [files, setFiles] = useState([{ ...emptyFile }]);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const updateFile = (index, field, value) => {
    setFiles((prev) => prev.map((f, i) => (i === index ? { ...f, [field]: value } : f)));
  };

  const addFileRow = () => setFiles((prev) => [...prev, { ...emptyFile }]);
  const removeFileRow = (index) => setFiles((prev) => prev.filter((_, i) => i !== index));

  const validate = () => {
    if (!name.trim()) return 'Project name is required.';
    if (sourceType === 'repo_url') {
      if (!/^https?:\/\/github\.com\/[^/]+\/[^/]+/i.test(repoUrl.trim())) {
        return 'Enter a valid public GitHub repository URL (https://github.com/owner/repo).';
      }
    } else {
      const nonEmpty = files.filter((f) => f.path.trim() && f.content.trim());
      if (nonEmpty.length === 0) return 'Add at least one file with a path and content.';
    }
    return null;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      const payload = {
        name: name.trim(),
        description: description.trim(),
        sourceType,
        ...(sourceType === 'repo_url'
          ? { repoUrl: repoUrl.trim(), files: [{ path: 'placeholder', content: 'placeholder' }] }
          : {
              files: files
                .filter((f) => f.path.trim() && f.content.trim())
                .map((f) => ({
                  path: f.path.trim(),
                  language: f.language.trim() || 'plaintext',
                  content: f.content,
                })),
            }),
      };

      const res = await api.post('/projects', payload);
      navigate(`/projects/${res.data.data.project._id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page">
      <h1>New analysis</h1>
      <form className="analysis-form" onSubmit={handleSubmit} noValidate>
        <ErrorBanner message={error} />

        <label htmlFor="name">Project name</label>
        <input id="name" value={name} onChange={(e) => setName(e.target.value)} required />

        <label htmlFor="description">Description (optional)</label>
        <textarea
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
        />

        <fieldset className="source-type-select">
          <legend>Source</legend>
          <label>
            <input
              type="radio"
              name="sourceType"
              value="repo_url"
              checked={sourceType === 'repo_url'}
              onChange={() => setSourceType('repo_url')}
            />
            Public GitHub repository URL
          </label>
          <label>
            <input
              type="radio"
              name="sourceType"
              value="paste"
              checked={sourceType === 'paste'}
              onChange={() => setSourceType('paste')}
            />
            Paste code directly
          </label>
        </fieldset>

        {sourceType === 'repo_url' ? (
          <>
            <label htmlFor="repoUrl">Repository URL</label>
            <input
              id="repoUrl"
              placeholder="https://github.com/owner/repo"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
            />
          </>
        ) : (
          <div className="file-rows">
            {files.map((file, index) => (
              <div className="file-row" key={index}>
                <input
                  placeholder="File path (e.g. src/index.js)"
                  value={file.path}
                  onChange={(e) => updateFile(index, 'path', e.target.value)}
                />
                <input
                  placeholder="Language (optional)"
                  value={file.language}
                  onChange={(e) => updateFile(index, 'language', e.target.value)}
                />
                <textarea
                  placeholder="Paste file content here"
                  rows={6}
                  value={file.content}
                  onChange={(e) => updateFile(index, 'content', e.target.value)}
                />
                {files.length > 1 && (
                  <button type="button" className="btn-link" onClick={() => removeFileRow(index)}>
                    Remove file
                  </button>
                )}
              </div>
            ))}
            <button type="button" className="btn-secondary" onClick={addFileRow}>
              + Add another file
            </button>
          </div>
        )}

        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? 'Submitting...' : 'Create project'}
        </button>
      </form>
    </div>
  );
}
