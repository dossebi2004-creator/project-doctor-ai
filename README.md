# Project Doctor AI

**An AI-powered software project diagnosis platform that analyzes a codebase and produces an explainable, trustworthy health assessment — not just an AI opinion.**

---

## 1. Problem statement

Anyone can paste a repository into a chatbot and ask "is this code good?" — but the answer is unreliable: it varies between runs, can't be audited, and hands a single number (or vague prose) with no traceable reasoning. That's not good enough for a decision a developer or reviewer needs to trust.

## 2. Solution

Project Doctor AI ingests a project (GitHub URL, uploaded files, or pasted code), runs it through a **deterministic, rule-based analyzer** first, uses AI purely for **reasoning about what the analyzer can't see** (bugs, security logic, architectural judgment), validates every AI claim before it's trusted, and then computes the **final health score with deterministic math** — never by asking the AI "what score would you give this?"

## 3. Key innovation

**The AI is not the authority for the final health score.**

```
USER PROJECT
   ↓
GITHUB / FILE UPLOAD / PASTE
   ↓
REPOSITORY INGESTION
   ↓
DETERMINISTIC PROJECT INTELLIGENCE   (analyzer.js — no AI call)
   ↓
AI REASONING                         (Gemini — findings only, no score)
   ↓
VALIDATED FINDINGS                   (schema-checked, defaulted, truncated)
   ↓
DETERMINISTIC HEALTH SCORING         (scoring.js — pure function of analysis + findings)
   ↓
PRIORITIZED ACTION PLAN              (P0–P3, derived from validated findings)
   ↓
EXPLAINABLE REPORT
   ↓
PDF EXPORT
```

Every score is **reproducible**: the same `(analysis, findings)` pair always produces the same number. If the AI provider is unreachable, slow, or returns garbage, the pipeline still produces a useful, honest report — see [Error resilience](#21-error-resilience--deterministic-only-mode) below.

## 4. Features

- GitHub repository analysis (public repos, via the GitHub REST API — no cloning)
- Drag-and-drop / click-to-browse file upload
- Paste-code analysis for quick one-off snippets
- Deterministic project intelligence: languages, frameworks, dependencies, test presence, documentation, CI, Docker, large files, TODO/debug density, possible hardcoded secrets
- AI-reasoned findings across 9 categories and 5 severities, each with evidence, reasoning, recommendation, and estimated impact
- Deterministic 0–100 health score across 6 weighted dimensions, each with human-readable reasons
- Prioritized P0–P3 action plan
- PDF export of the full report
- Deterministic-only fallback when the AI step fails — the report degrades gracefully instead of failing outright
- JWT auth, per-user ownership isolation, tiered rate limiting

## 5. Architecture

```
project-doctor-ai/
├── .github/workflows/ci.yml     # CI: backend test+lint, frontend lint+build
├── backend/
│   └── src/
│       ├── config/              # env loading, logger, DB connection
│       ├── models/               # User, Project, Diagnosis (Mongoose)
│       ├── routes/ + controllers/
│       ├── middleware/           # auth, error handling, validation, rate limiting, upload
│       ├── services/
│       │   ├── analysis/         # analyzer.js (deterministic) + scoring.js (deterministic)
│       │   ├── ai/                # geminiClient, prompts, diagnosisAgent (AI reasoning + validation)
│       │   ├── project/           # repoIngest.js (GitHub), uploadIngest.js (multer files)
│       │   └── report/            # pdfReport.js
│       └── validators/            # Joi schemas
│   └── tests/                     # Jest + Supertest — 74 tests
└── frontend/                      # React (Vite) SPA
    └── src/
        ├── api/, context/, components/, pages/, styles/
```

## 6. Technology stack

- **Backend:** Node.js, Express, MongoDB (Mongoose), JWT, Joi
- **AI:** Google Gemini API (`@google/generative-ai`)
- **File handling:** Multer (memory storage — files are never written to disk)
- **PDF:** pdfkit
- **Frontend:** React 18, Vite, React Router, Axios
- **Security middleware:** helmet, cors, express-rate-limit, express-mongo-sanitize, bcrypt
- **Testing:** Jest, Supertest
- **CI:** GitHub Actions

## 7. Deterministic intelligence (`services/analysis/analyzer.js`)

Runs entirely without an AI call — cheap, instant, and 100% reproducible:

| Signal | What it detects |
|---|---|
| Languages | File-extension based, with per-language file counts |
| Frameworks | React, Vue, Angular, Express, Next.js, Django, Flask, Spring, Vite (via dependency/file signatures) |
| Dependencies | npm (`package.json`) or pip (`requirements.txt`), dependency counts |
| Testing | Test file presence via common naming conventions (`.test.`, `.spec.`, `__tests__/`, `test_*.py`) |
| Documentation | README presence/length, LICENSE, CONTRIBUTING |
| CI | GitHub Actions, GitLab CI, CircleCI, Jenkinsfile |
| Docker | Dockerfile, docker-compose |
| Large files | Files over 50KB of source (maintainability smell) |
| TODO density | TODO/FIXME/HACK/XXX per 1000 lines |
| Debug statements | Leftover `console.log`, `print()`, `debugger` |
| Possible secrets | Conservative pattern match (AWS keys, generic API-key assignments, private-key blocks, Slack tokens) — **flags location only, never logs or persists the matched value itself** |

## 8. AI architecture (`services/ai/`)

- **`prompts.js`** builds the prompt from the analyzer summary plus a **token-budgeted, priority-ranked** slice of file content (see [Token optimization](#10-token-optimization) below) — never the whole repo.
- Untrusted file content is wrapped in `<file>` tags with an explicit instruction that anything inside is data, not instructions — the model is told directly not to follow directives embedded in code comments or strings (**prompt-injection defense**).
- **`diagnosisAgent.js`** calls the model, requests strict JSON, and asks only for `findings` — no score field exists in the requested schema.
- **`geminiClient.js`** enforces a hard timeout (45s default) and retries once on a transient (non-timeout) failure.
- The model is explicitly instructed to prefer fewer, well-evidenced findings over padding the list — **"if an area looks clean, do not fabricate a finding to fill space."**

## 9. Health scoring (`services/analysis/scoring.js`)

Six weighted dimensions, each a pure function of `(analysis, validatedFindings)`:

| Dimension | Weight | Driven by |
|---|---|---|
| Security | 25% | Possible-secrets scan + validated SECURITY findings |
| Testing | 20% | Test-file presence + validated TESTING findings |
| Maintainability | 20% | Large files, TODO density, debug statements + BUG/CODE_QUALITY findings |
| Architecture | 15% | ARCHITECTURE/PERFORMANCE/DEPENDENCY findings + dependency surface size |
| DevOps | 10% | CI/Docker presence + DEVOPS findings |
| Documentation | 10% | README/LICENSE presence + DOCUMENTATION findings |

Each dimension returns a score **and a list of human-readable reasons**, so every number in the report is traceable to a specific signal.

## 10. Finding schema

Every AI finding is validated and normalized before it ever reaches the database:

- **Categories:** `BUG`, `SECURITY`, `PERFORMANCE`, `ARCHITECTURE`, `CODE_QUALITY`, `TESTING`, `DOCUMENTATION`, `DEPENDENCY`, `DEVOPS`
- **Severities:** `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`, `INFO`
- **Fields:** `title`, `category`, `severity`, `file`, `description`, `evidence`, `reasoning`, `recommendation`, `estimatedImpact`

An invalid category/severity is defaulted to a safe fallback (`CODE_QUALITY` / `MEDIUM`), not rejected outright — but a finding missing its required `description` or `recommendation` is dropped entirely rather than persisted half-formed.

## 11. Action plan

`buildActionPlan()` sorts validated findings by severity (`CRITICAL → INFO`) and buckets them into `P0`–`P3`, deterministically — same findings in, same plan out, every time.

## 12. GitHub ingestion

Uses the GitHub REST API directly (no `git clone`, no shell-out): fetches the repo tree, filters to source-code extensions, skips vendored/build directories (`node_modules`, `dist`, `build`, `.git`, `coverage`, `.next`, `target`), and caps both file count and per-file size. Handles: invalid URLs, non-GitHub hosts, non-HTTPS URLs, 404 (private/nonexistent), 403 (rate-limited vs. access-denied, distinguished via response headers), 401, empty repos, empty trees, truncated trees, network failures, and retries once on a 5xx.

## 13. File upload

Multer with **memory storage only** — uploaded bytes exist as in-memory buffers on the request and are never written to disk, so there is no path for an uploaded file to be executed or served statically. Filenames are sanitized (directory-traversal segments and null bytes stripped) before being stored as display strings. Unsupported extensions and oversized files are rejected per-file with a reason, not by failing the whole upload.

## 14. PDF export

`services/report/pdfReport.js` streams a PDF directly from the persisted diagnosis + project documents — project info, overall score, dimension scores with reasons, every finding, and the full action plan. It never re-fetches or invents content, and deliberately omits the analyzer's secret-scan *locations* (only the count is shown) to avoid pointing at where a possible secret lives in an exported, shareable document.

## 15. Token optimization

The AI prompt never dumps the repository. `selectFileContext()` in `prompts.js`:

1. Scores every file by relevance (entry points, `package.json`, Docker/config files score higher; tests and README/LICENSE score lower — the analyzer summary already covers those).
2. Sorts by that score and greedily fills an approximate **token budget** (default ~12,000 tokens / ~48KB, using a conservative 4-chars-per-token heuristic).
3. Truncates the last included file if it would blow the budget, and reports how many files were omitted.

The analyzer summary (cheap, already computed) is sent alongside this bounded file slice — so the model reasons with **project intelligence + prioritized files + bounded context**, not a raw repo dump.

## 16. Security

- **Auth:** JWT, bcrypt password hashing (cost 12), password hash never serialized (`select: false` + `toJSON` strip)
- **Authorization / ownership isolation:** every project/diagnosis query filters by `owner: req.user._id` at the database level, not just by ID — prevents IDOR access to another user's data
- **Input validation:** Joi schemas on every mutating endpoint; `express-mongo-sanitize` strips `$`/`.` operators from user input
- **Upload safety:** memory storage only, filename sanitization, extension allowlist, size caps, no execution path
- **GitHub URL validation:** strict `https://github.com/<owner>/<repo>` parsing via `URL`, character-allowlisted owner/repo segments
- **Rate limiting:** tiered — general API, tighter auth-endpoint limit (brute-force protection), strict diagnosis-endpoint limit (protects AI provider quota/cost)
- **Secrets never sent to the AI:** the analyzer's secret scanner reports only *counts and file paths*, never the matched value, and that's all that reaches the prompt
- **Prompt injection defense:** file content is fenced and the model is explicitly told to treat it as data, never instructions
- **No arbitrary code execution:** uploaded/ingested project content is treated as data end-to-end — analyzed as text, never executed, never `eval`'d, never run
- **Known dependency vulnerabilities:** `npm audit` on the frontend currently reports 4 moderate/high advisories in transitive dev-tooling (`esbuild`'s dev-server, `react-router`'s open-redirect fix) — both require breaking major-version upgrades (Vite 8, React Router 7) that haven't been applied/tested yet. Tracked as a follow-up, not silently ignored.

## 17. Installation

Prerequisites: Node.js 18+, a MongoDB instance (local or Atlas), a Google Gemini API key.

```bash
# Backend
cd backend
npm install
cp .env.example .env    # fill in MONGODB_URI, JWT_SECRET, GEMINI_API_KEY

# Frontend
cd ../frontend
npm install
```

## 18. Environment variables

See `backend/.env.example` for the full list. Key variables:

| Variable | Required | Description |
|---|---|---|
| `MONGODB_URI` | yes (prod) | MongoDB connection string |
| `JWT_SECRET` | yes (prod) | Secret used to sign auth tokens |
| `GEMINI_API_KEY` | yes (prod) | Google Gemini API key |
| `GEMINI_MODEL` | no | Defaults to `gemini-1.5-flash` |
| `CLIENT_ORIGIN` | no | Frontend origin allowed by CORS |
| `GITHUB_TOKEN` | no | Raises GitHub API rate limits for repo ingestion |
| `MAX_UPLOAD_FILES` / `MAX_FILE_SIZE_BYTES` | no | Upload and ingestion caps |

No secrets are hardcoded anywhere — everything flows through `backend/src/config/env.js`.

## 19. Running locally

```bash
# Terminal 1 — backend (http://localhost:5000)
cd backend && npm run dev

# Terminal 2 — frontend (http://localhost:5173, proxies /api to the backend)
cd frontend && npm run dev
```

## 20. Testing

```bash
cd backend && npm test    # 74 tests: analyzer, scoring, diagnosisAgent, repoIngest,
                           # auth, projectController, diagnosisController
cd frontend && npm run lint && npm run build
```

Backend tests mock at the Mongoose-model layer (`jest.mock`) rather than requiring a live database — this keeps the suite fast and runnable in restricted/sandboxed CI environments. The AI-dependent tests mock `geminiClient` directly so they run deterministically with no network calls and no API key required.

## 21. Error resilience — deterministic-only mode

If the AI step fails for **any** reason (timeout, provider error, unparsable response, invalid schema after one retry), the pipeline does **not** fail the whole diagnosis. It falls back to a `deterministic_only` result: the analyzer's signals and a health score computed from those signals alone, zero AI findings, and an honest `aiError` message surfaced to the user. This is a distinct, clearly-labeled status from `completed` (full analysis) and `failed` (the analyzer itself couldn't run, e.g. no analyzable files) — the UI shows a banner explaining exactly which mode produced the report. The system never fabricates AI findings and never silently presents a degraded report as a full success.

## 22. CI/CD

`.github/workflows/ci.yml` runs on every push/PR to `main`, as two parallel jobs using the project's real `npm` scripts (`npm ci`, `npm run lint`, `npm test`, `npm run build`) — nothing invented, nothing disabled:

- **backend:** install → lint → test
- **frontend:** install → lint → build

## 23. Limitations

- GitHub ingestion supports **public repositories only**.
- The deterministic analyzer's language/framework detection is signature-based, not a full parser — it can miss unusual project layouts.
- The secret scanner is intentionally conservative (few, high-confidence patterns) to avoid false positives; it is not a substitute for a dedicated secret-scanning tool.
- Frontend has 4 known moderate/high transitive dev-dependency advisories (see [Security](#16-security)) pending a tested major-version upgrade.
- No team/workspace support yet — projects and diagnoses are single-user-owned.
- No retry/backoff on MongoDB connection loss beyond Mongoose's defaults.

## 24. Future improvements

- Multi-file diff-aware re-analysis (only re-diagnose changed files)
- Team workspaces with shared project visibility
- Configurable scoring weights per project type
- A dedicated, more thorough secret-scanning integration
- WebSocket/SSE progress updates during long-running diagnoses instead of poll-on-navigate

## 25. Demo workflow

1. Register / log in.
2. **New analysis** → paste a public GitHub URL (or upload a few files, or paste code directly).
3. Open the created project → **Run AI diagnosis**.
4. Read the report: health score + interpretation, six dimension scores with reasons, the full Project Intelligence panel, every finding with evidence/reasoning/recommendation, and the P0–P3 action plan.
5. **Export PDF Report** to download a shareable copy.
6. (To see the resilience story) temporarily unset `GEMINI_API_KEY` and re-run a diagnosis — the report still returns, now clearly labeled **Deterministic-only**.
