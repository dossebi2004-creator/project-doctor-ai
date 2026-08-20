# Project Doctor AI

AI agent that diagnoses software projects and prescribes actionable improvements.

You give it a project — a public GitHub repo URL, or pasted source files — and it
runs an AI-powered code review that returns a health score (0–100) and a structured
list of findings (bugs, security issues, performance problems, architecture concerns,
missing tests, style issues), each with an explanation and a concrete recommendation.

## Architecture

This is a MERN-stack application with an AI diagnosis agent layered on top of the
backend API.

```
project-doctor-ai/
├── backend/                  # Node.js + Express REST API
│   └── src/
│       ├── config/           # env loading, logger, DB connection
│       ├── models/           # Mongoose schemas (User, Project, Diagnosis)
│       ├── routes/           # Express routers
│       ├── controllers/      # request handlers
│       ├── middleware/       # auth, error handling, validation, rate limiting
│       ├── services/
│       │   ├── ai/           # Gemini client, prompt builder, diagnosis agent
│       │   └── project/      # GitHub repo ingestion
│       ├── utils/            # ApiError, asyncHandler, JWT helpers
│       └── validators/       # Joi request schemas
│   └── tests/                # Jest + Supertest tests
└── frontend/                 # React (Vite) single-page app
    └── src/
        ├── api/               # Axios client with auth interceptor
        ├── context/           # AuthContext (session state)
        ├── components/        # Navbar, ProtectedRoute, loading/error/empty states
        ├── pages/              # Login, Register, Dashboard, NewAnalysis, ProjectDetail, DiagnosisReport
        └── styles/             # global.css (responsive, no framework)
```

### Diagnosis flow

1. User submits a project — either a public GitHub repo URL or pasted files.
2. For a repo URL, the backend fetches the file tree and content directly from the
   GitHub REST API (`services/project/repoIngest.js`) — no cloning required.
3. `services/ai/diagnosisAgent.js` builds a structured prompt from the file contents
   and calls the Google Gemini API, requesting a strict JSON response.
4. The raw model response is parsed and **normalized**: health score is clamped to
   0–100, invalid categories/severities fall back to safe defaults, and findings
   missing required fields are dropped. This guards the rest of the app against a
   malformed or partially-hallucinated model response.
5. The normalized diagnosis is persisted and returned to the client.

## Technology stack

- **Backend:** Node.js, Express, MongoDB (Mongoose), JWT auth, Joi validation
- **AI:** Google Gemini API (`@google/generative-ai`)
- **Frontend:** React 18, Vite, React Router, Axios
- **Security:** helmet, cors, express-rate-limit, express-mongo-sanitize, bcrypt
- **Testing:** Jest, Supertest
- **Logging:** Winston (structured, environment-aware)

## Installation

Prerequisites: Node.js 18+, a MongoDB instance (local or Atlas), a Google Gemini API key.

```bash
# Backend
cd backend
npm install
cp .env.example .env    # then fill in MONGODB_URI, JWT_SECRET, GEMINI_API_KEY

# Frontend
cd ../frontend
npm install
```

## Environment variables

All backend configuration is centralized in `backend/src/config/env.js`, which reads
from `backend/.env`. See `backend/.env.example` for the full list with descriptions.
Key variables:

| Variable | Required | Description |
|---|---|---|
| `MONGODB_URI` | yes (prod) | MongoDB connection string |
| `JWT_SECRET` | yes (prod) | Secret used to sign auth tokens |
| `GEMINI_API_KEY` | yes (prod) | Google Gemini API key |
| `GEMINI_MODEL` | no | Defaults to `gemini-1.5-flash` |
| `CLIENT_ORIGIN` | no | Frontend origin allowed by CORS |
| `GITHUB_TOKEN` | no | Raises GitHub API rate limits for repo ingestion |

No secrets are hardcoded anywhere in the codebase — everything flows through `env.js`.

## Development

```bash
# Terminal 1 — backend (http://localhost:5000)
cd backend
npm run dev

# Terminal 2 — frontend (http://localhost:5173, proxies /api to the backend)
cd frontend
npm run dev
```

## Testing

```bash
cd backend
npm test
```

Backend tests use Jest + Supertest. The auth suite mocks the Mongoose `User` model
directly (via `jest.mock`), so tests run without requiring a live database — useful
in sandboxed/CI environments where spinning up MongoDB isn't convenient. The
diagnosis-agent suite unit-tests the AI response normalization logic (score
clamping, invalid-value fallbacks, malformed-response rejection) with no network
calls involved.

## Deployment

- **Backend:** any Node host (Render, Railway, Fly.io, etc). Set all required env
  vars from `.env.example` in the host's dashboard — never commit `.env`.
- **Frontend:** `npm run build` in `frontend/` produces a static `dist/` bundle
  deployable to Vercel, Netlify, or any static host. Point it at the deployed
  backend by setting the API base URL / proxy target accordingly.
- **Database:** MongoDB Atlas is recommended for production.

## Design decisions

- **GitHub REST API over `git clone`:** avoids shelling out to git and keeps the
  ingestion path sandboxable and dependency-light. Limited to public repos and
  capped at `MAX_UPLOAD_FILES` files under `MAX_FILE_SIZE_BYTES` each to bound both
  cost and prompt size.
- **Strict AI response normalization:** the model is prompted for JSON but LLM
  output is never trusted blindly — every field is validated, clamped, or defaulted
  before it touches the database.
- **Ownership enforced at the query level:** every project/diagnosis lookup filters
  by `owner: req.user._id`, not just by ID, preventing IDOR-style access to another
  user's data.
- **Rate limiting is tiered:** a generous general API limit, a tighter auth-endpoint
  limit (brute-force protection), and a strict diagnosis-endpoint limit (protects
  Gemini API quota/cost).

## Status

Foundational MERN + AI-agent architecture is implemented and verified: backend
lints clean, all tests pass, the Express app boots without runtime errors, and the
frontend lints clean and builds for production. See project history / issue
tracker for planned feature work beyond this foundation (e.g. file uploads via
drag-and-drop, PDF export of reports, team/workspace support).
