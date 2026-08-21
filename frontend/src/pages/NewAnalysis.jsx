import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import ErrorBanner from '../components/ErrorBanner.jsx';

const emptyFile = { path: '', language: '', content: '' };

// Kept in sync with backend/src/services/project/uploadIngest.js CODE_EXTENSIONS.
const ACCEPTED_EXTENSIONS = [
  'js', 'jsx', 'ts', 'tsx', 'py', 'java', 'go', 'rb', 'php', 'c', 'cpp', 'h', 'hpp',
  'cs', 'json', 'md', 'yml', 'yaml', 'html', 'css', 'scss', 'sql', 'sh',
];
const MAX_FILES = 40;
const MAX_FILE_SIZE = 300 * 1024; // 300KB, mirrors backend MAX_FILE_SIZE_BYTES default

function isAcceptedFile(file) {
  const ext = file.name.split('.').pop()?.toLowerCase();
  return ACCEPTED_EXTENSIONS.includes(ext);
}

export default function NewAnalysis() {
  const navigate = useNavigate();
  const [sourceType, setSourceType] = useState('repo_url');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [files, setFiles] = useState([{ ...emptyFile }]);
  const [uploadFiles, setUploadFiles] = useState([]); // File[]
  const [uploadRejections, setUploadRejections] = useState([]); // { name, reason }[]
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef(null);

  const updateFile = (index, field, value) => {
    setFiles((prev) => prev.map((f, i) => (i === index ? { ...f, [field]: value } : f)));
  };

  const addFileRow = () => setFiles((prev) => [...prev, { ...emptyFile }]);
  const removeFileRow = (index) => setFiles((prev) => prev.filter((_, i) => i !== index));

  const addUploadCandidates = (candidateList) => {
    const incoming = Array.from(candidateList);
    const accepted = [];
    const rejected = [];

    for (const file of incoming) {
      if (!isAcceptedFile(file)) {
        rejected.push({ name: file.name, reason: 'unsupported file type' });
      } else if (file.size > MAX_FILE_SIZE) {
        rejected.push({ name: file.name, reason: 'file too large (max 300KB)' });
      } else {
        accepted.push(file);
      }
    }

    setUploadFiles((prev) => {
      const combined = [...prev, ...accepted];
      if (combined.length > MAX_FILES) {
        rejected.push({ name: `+${combined.length - MAX_FILES} more file(s)`, reason: `exceeds ${MAX_FILES}-file limit` });
        return combined.slice(0, MAX_FILES);
      }
      return combined;
    });
    setUploadRejections(rejected);
  };

  const handleFileInputChange = (e) => {
    if (e.target.files?.length) addUploadCandidates(e.target.files);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files?.length) addUploadCandidates(e.dataTransfer.files);
  };

  const removeUploadFile = (index) => {
    setUploadFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const validate = () => {
    if (!name.trim()) return 'Project name is required.';
    if (sourceType === 'repo_url') {
      if (!/^https:\/\/github\.com\/[^/]+\/[^/]+/i.test(repoUrl.trim())) {
        return 'Enter a valid public GitHub repository URL (https://github.com/owner/repo).';
      }
    } else if (sourceType === 'paste') {
      const nonEmpty = files.filter((f) => f.path.trim() && f.content.trim());
      if (nonEmpty.length === 0) return 'Add at least one file with a path and content.';
    } else if (sourceType === 'upload') {
      if (uploadFiles.length === 0) return 'Select or drop at least one file to upload.';
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
      let projectId;

      if (sourceType === 'upload') {
        const formData = new FormData();
        formData.append('name', name.trim());
        formData.append('description', description.trim());
        uploadFiles.forEach((file) => formData.append('files', file));

        const res = await api.post('/projects/upload', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        projectId = res.data.data.project._id;
      } else {
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
        projectId = res.data.data.project._id;
      }

      navigate(`/projects/${projectId}`);
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
              value="upload"
              checked={sourceType === 'upload'}
              onChange={() => setSourceType('upload')}
            />
            Upload files
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

        {sourceType === 'repo_url' && (
          <>
            <label htmlFor="repoUrl">Repository URL</label>
            <input
              id="repoUrl"
              placeholder="https://github.com/owner/repo"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
            />
            <p className="field-hint">Public repositories only. Up to 40 source files are analyzed.</p>
          </>
        )}

        {sourceType === 'upload' && (
          <div className="upload-section">
            <div
              className={`dropzone${dragActive ? ' dropzone-active' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click();
              }}
            >
              <p>
                <strong>Drag and drop files here</strong>, or click to browse
              </p>
              <p className="field-hint">
                Up to {MAX_FILES} files, 300KB each. Supported: {ACCEPTED_EXTENSIONS.slice(0, 8).join(', ')}, and more.
              </p>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                hidden
                onChange={handleFileInputChange}
              />
            </div>

            {uploadRejections.length > 0 && (
              <ErrorBanner
                message="Some files were skipped:"
                details={uploadRejections.map((r) => `${r.name} — ${r.reason}`)}
              />
            )}

            {uploadFiles.length > 0 && (
              <ul className="upload-file-list">
                {uploadFiles.map((file, index) => (
                  <li key={`${file.name}-${index}`}>
                    <code>{file.name}</code>
                    <span className="muted"> · {(file.size / 1024).toFixed(1)}KB</span>
                    <button type="button" className="btn-link" onClick={() => removeUploadFile(index)}>
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {sourceType === 'paste' && (
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
