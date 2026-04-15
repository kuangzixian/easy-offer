# github-resume-gen

Generate a tailored resume from your GitHub commit history using Claude AI.

## Features

- Parses existing PDF resume to extract work history
- Fetches your GitHub PRs interactively
- Uses Claude to generate professional resume descriptions (problem-solution-result format)
- Tailors resume to a specific JD if provided
- Outputs `resume.md` + `resume.pdf`
- Generates `interview-prep.md` with predicted interview questions

## Prerequisites

- Node.js 18+
- `ANTHROPIC_API_KEY` environment variable
- GitHub Personal Access Token (with `repo` scope)

## Usage

```bash
npx github-resume-gen
```

Or install globally:
```bash
npm install -g github-resume-gen
github-resume-gen
```

### Subcommands

```bash
github-resume-gen fetch     # Step 1: fetch GitHub data → cache
github-resume-gen build     # Step 2: generate resume from cache
github-resume-gen interview # Step 3: generate interview prep plan
```

### Options

| Flag | Description |
|------|-------------|
| `-o, --output <dir>` | Output directory (default: current dir) |
| `--no-pdf` | Skip PDF generation (build command) |

### Environment Variables

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Claude API key (required) |
| `GITHUB_TOKEN` | GitHub token (optional, can be entered interactively) |

## How it works

1. **Step 0** (optional): Enter your target job position and paste the JD. When provided, the resume will be tailored to match JD keywords.
2. **Step 1**: Select your target role type (Go backend, Node.js, AI/Agent, etc.)
3. **Step 2**: Provide your existing PDF resume path to extract work history
4. **Step 3**: Authenticate with GitHub and select repos to include
5. **Step 4**: Claude analyzes each repo's PR history and generates professional resume sections
6. **Step 5** (optional): Generate an interview prep plan with predicted questions

## Output files

| File | Description |
|------|-------------|
| `resume.md` | Professional resume in Markdown |
| `resume.pdf` | PDF version of the resume |
| `interview-prep.md` | Interview prep plan with predicted questions |
| `.github-resume-cache.json` | Cached GitHub data (re-run `build` without re-fetching) |

## License

MIT
