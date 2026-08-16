# job_search_agent

Job search agent for finding IT-related jobs and emailing new matches automatically.

## Overview

This project checks the Adzuna job API for relevant IT and administrator roles, filters them, and sends a notification email when new jobs are found. It is designed for daily use on Windows via the Task Scheduler.

## Features

- Adzuna API job search
- Automatic filtering for IT/admin/cloud roles
- Email notifications for new jobs
- Deduplication via `jobs.json`
- Daily background execution on Windows
- Simple configuration via `.env`

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create a `.env` file with:

```env
ADZUNA_APP_ID=your_app_id
ADZUNA_API_KEY=your_api_key
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_password
SMTP_FROM=your_email@gmail.com
SMTP_TO=your_email@gmail.com
DISABLE_DAILY_LOOP=true
```

3. Start manually:

```bash
node agent.js
```

## Windows Task Scheduler

Use `node.exe` with the script path as the program and `agent.js` as the argument, starting from the project folder.

## Project structure

```text
job_search_agent/
├── agent.js
├── jobs.json
├── README.md
├── package.json
├── package-lock.json
├── .gitignore
├── .env
├── start-job-agent.bat
└── node_modules/
```

## GitHub

Clone or connect this repository with:

```bash
git clone https://github.com/uv-code/job_search_agent.git
```

## License

MIT
