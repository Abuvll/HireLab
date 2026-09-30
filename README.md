# HireLab

HireLab is a hiring platform built for small teams to make candidate screening faster and more evidence-driven. Candidates apply through a public application form with their resume and GitHub profile. HireLab uses AI to extract structured information from resumes and independently analyzes GitHub activity to evaluate real-world experience. These signals are combined into an explainable candidate score that hiring teams can filter, compare, and review.

HireLab connects candidates, hiring teams, and the system in one continuous hiring workflow: candidates discover a position and submit their resume and GitHub profile through a public application page, hiring teams create positions, review applicants, evaluate evidence and scores, add notes and feedback, and move candidates through the hiring pipeline, while the system processes each application by extracting resume data, analyzing GitHub activity, calculating scores, and making the results available to the hiring team.

## What Problem Does This Solve?

Hiring teams often have to review large numbers of applicants with limited time, making it difficult to identify strong candidates without relying on quick impressions or resume claims alone. A resume can describe someone's experience, but it doesn't always show what they have actually built or contributed to.

HireLab helps solve this by combining resume information with evidence from a candidate's real-world GitHub activity, giving hiring teams a faster and more transparent way to evaluate candidates.

I built this to help small hiring teams screen candidates faster, with clear evidence behind each evaluation.

## Features

- **Evidence-based candidate scoring:** resume claims are checked against actual GitHub activity (commit history, repo languages, test coverage, shipped projects), not scored on the resume alone

- **AI-powered resume extraction with your own provider key:** each organization brings its own API key (Anthropic, OpenAI, Google Gemini, Mistral, or xAI) via LiteLLM, so AI usage runs at your own cost and choice of model, not a shared key.

- **Position management:** create postings with requirements, deadlines, and optional details (salary, experience level, education, headcount); share a public application link per posting

- **Filterable, ranked candidate lists:** filter by tech stack, minimum consistency/collaboration scores, or "shipped a real project," with matching candidates surfaced first

- **Role-based access control:** Owner, Admin, Recruiter, and Viewer roles, enforced on the backend.

- **Background analysis pipeline:** applications are queued (BullMQ/Redis) and processed asynchronously, with automatic retries, so a slow AI response or a transient failure doesn't block the application from being accepted

- **Team collaboration:** invite teammates, assign them to specific positions, leave notes on candidates

- **Public application page:** no login required for candidates; shows the organization's own profile info alongside the role.

- **Candidate management:** Manage everything related to a candidate in one place: their profile, application details, notes, current status, and hiring history.

- **Interview management:** Schedule candidate interviews and let interviewers record their feedback and observations after each interview.

- **Position management:** Create and manage job positions with requirements, deadlines, headcount, and a public application link candidates can use to apply.

- **Hiring pipeline:** Move candidates through customizable stages such as Applied → Screening → Interview → Offer → Hired/Rejected, giving the team a clear view of where everyone stands.

- **Team collaboration:** Manage hiring-team roles and assignments while allowing team members to share notes, feedback, and candidate evaluations.

- **Background processing:** Run time-consuming tasks such as resume and GitHub analysis in the background so applications aren't blocked, with automatic retries when processing fails.

## Requirements

- Node.js 20+
- PostgreSQL 16+
- Redis 7+ (used for the background analysis job queue)
- Git

Candidate resume analysis additionally needs a running LiteLLM Proxy instance (see [Configuration](#configuration)) — the rest of the app (auth, postings, the dashboard) works without it.

## Installation

```bash
git clone https://github.com/abuvll/hirelab.git
cd hirelab
npm install
```

`npm install` also runs `prisma generate` automatically (see the `postinstall` script), which generates the database client from `prisma/schema.prisma`.

## Configuration

Create a `.env` file based on `.env.example`:

```bash
cp .env.example .env
```

The core variables every environment needs:

```env
DATABASE_URL=postgresql://user:password@localhost:5432/hirelab
REDIS_URL=redis://localhost:6379
SESSION_SECRET=              # random string, e.g. `openssl rand -base64 32`
ENCRYPTION_KEY=              # random 32-byte key, same command — encrypts each org's stored API key at rest
LITELLM_PROXY_URL=http://localhost:4000
LITELLM_MASTER_KEY=          # must match the master key your LiteLLM Proxy instance is configured with
GITHUB_TOKEN=                # a GitHub personal access token; required for the worker process to start
```

`.env.example` documents several more optional variables, each with graceful behavior when left unset rather than a hard failure: `RESEND_API_KEY`/`EMAIL_FROM` (outbound email — invites/password resets still work without it, they just won't send a message), `TURNSTILE_SECRET_KEY` (CAPTCHA on the public application form), `CLAMAV_HOST`/`CLAMAV_PORT`/`UPLOAD_REQUIRE_VIRUS_SCAN` (resume upload virus scanning), `UPLOADS_DIR` (local file storage path), and `WORKER_INTERNAL_SECRET` (internal auth between the web and worker processes for serving uploaded files). Read the comment above each variable in `.env.example` before setting it.

Postgres and Redis aren't included in `npm install` — `docker-compose.yml` in the project root starts Postgres, Redis, and a LiteLLM Proxy instance together for local development:

```bash
docker compose up -d
```

## Usage

The typical workflow: an Owner or Admin signs up, creates their organization, and adds their own AI provider key under Settings → API Keys. They create a position with its requirements and share the generated application link. Candidates apply through that public link with a resume and GitHub URL; no account needed. Each submission is queued for background analysis (resume extraction + GitHub analysis + scoring), and once processed, appears in the position's ranked candidate list, filterable by the hiring team.

Running it locally needs three things at once: the backing services, the web server, and the background worker that actually processes applications.

```bash
docker compose up -d   # Postgres, Redis, LiteLLM Proxy
npx prisma migrate deploy
npm start               # the web app
npm run worker          # in a separate terminal — without this, applications stay queued and never get scored
```

## Project Structure

```
hirelab/
├── app/
│   ├── api/              # The backend — one route.ts per endpoint (auth, positions, applications, team, ...)
│   ├── apply/[positionId] # Redirects /apply/:id to /apply.html?position=:id
│   └── page.tsx           # Redirects the bare domain to /index.html
├── public/
│   ├── index.html          # Landing page + sign-up/login
│   ├── dashboard.html      # The authenticated app (single page, no build step)
│   └── apply.html          # Public candidate application form
├── lib/
│   ├── api/               # Request validation, auth/session checks, response shaping shared across routes
│   ├── auth/               # Password hashing, session cookies
│   ├── db-adapters/        # Prisma-backed implementation of the analysis pipeline's repository interface
│   ├── extraction/         # LLM client (LiteLLM) and resume-extraction prompt/schema
│   ├── github/              # GitHub API client and profile analysis (languages, commits, shipped projects)
│   ├── jobs/                # Background job queue, worker process, and the analysis pipeline itself
│   ├── parsing/              # PDF/DOCX resume text extraction
│   ├── scoring/              # Evidence matrix, subscores, and ranking logic (no AI involved — deterministic)
│   ├── security/             # Encryption, rate limiting, file-type checks, virus scanning, CAPTCHA
│   ├── storage/               # File upload storage (local disk, or fetch-based for remote files)
│   └── __tests__/             # Vitest unit tests, mirroring the structure above
├── prisma/schema.prisma    # The full data model (organizations, users, positions, applications, scores, ...)
├── scripts/start-worker.ts # Entry point for `npm run worker`
├── docker-compose.yml      # Postgres, Redis, and LiteLLM Proxy for local development
├── .env.example
├── package.json
└── README.md
```

`app/api` and `lib/jobs` are the two places that matter most if you're extending how an application gets processed: routes in `app/api` handle the request/response cycle, while `lib/jobs/analyze-application.ts` is the actual pipeline a queued application goes through.

## Development

Start the development server:

```bash
npm run dev
```

Run tests:

```bash
npm test
```

Run linting:

No lint script is configured in this project yet; there's no `npm run lint` today. Adding one (ESLint's Next.js config is the natural fit) would be a reasonable first contribution.

Build the project:

```bash
npm run build
```

A few other scripts worth knowing: `npm run db:migrate` (create a new Prisma migration during development), `npm run db:studio` (a local web UI for browsing the database), `npm run test:watch` (Vitest in watch mode).

## Contributing

1. Fork the repository.
2. Create a feature branch.
3. Make your changes.
4. Add or update tests.
5. Submit a pull request.

## License

MIT
