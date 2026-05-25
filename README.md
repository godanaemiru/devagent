# DEVAGENT — Autonomous Coding Coworker

DevAgent is a full-stack web app that simulates an autonomous AI coding agent. Describe a programming task in plain English, and the agent plans, writes, tests, and self-corrects JavaScript code in real time — streaming every step to your browser as it happens.

---

## How It Works

Each task runs through a six-stage pipeline:

1. **Plan** — The LLM analyzes your request and returns a structured spec: function name, signature, summary, and a step-by-step plan.
2. **Code** — A JavaScript implementation is streamed token by token to the browser in real time.
3. **Test** — The agent authors five test cases covering the happy path and edge conditions.
4. **Run** — Code and tests execute inside a sandboxed Node.js `vm` context on the server with a 3-second timeout. No `require`, no filesystem access.
5. **Self-Fix** — If any tests fail, the agent reads the failing case, diagnoses the root cause, patches the implementation, and re-runs the full suite. Up to two retry attempts before escalating.
6. **Ship** — All tests green? The task is marked as verified and saved to persistent storage.

Every stage streams live to the frontend via Server-Sent Events.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js (v24, CommonJS) |
| Backend | Express.js |
| LLM | Groq API — `llama-3.3-70b-versatile` |
| Sandbox | Node.js built-in `vm` module |
| Streaming | Server-Sent Events over HTTP (`text/event-stream`) |
| Persistence | JSON file store (`data/devagent.json`) |
| Frontend | Vanilla HTML, CSS, JavaScript |
| Deployment | Vercel |

---

## Project Structure

```
devagent/
├── server/
│   ├── index.js      # Express routes + SSE agent loop
│   ├── agent.js      # LLM calls: plan, writeCode, writeTests, fixCode
│   ├── sandbox.js    # vm-based test runner
│   ├── kb.js         # Knowledge base: 5 preset tasks with buggy/fixed pairs
│   └── db.js         # JSON file persistence
├── public/
│   ├── index.html    # App shell
│   ├── style.css     # Styles
│   └── app.js        # Frontend SSE client + UI logic
├── data/
│   └── devagent.json # Persisted sessions and tasks (auto-created)
└── devagent.html     # Original single-file demo (standalone)
```

---

## Getting Started

### Prerequisites

- Node.js v18+
- A [Groq API key](https://console.groq.com)

### Install

```bash
git clone https://github.com/your-username/devagent.git
cd devagent
npm install
```

### Configure

Create a `.env` file in the project root:

```
GROQ_API_KEY=your_key_here
```

### Run

```bash
npm start
```

Open [http://localhost:3000](http://localhost:3000).

---

## API

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/tasks?sessionId=` | List all tasks for a session |
| `GET` | `/api/tasks/:id` | Get a single task |
| `POST` | `/api/tasks/run` | Run the agent (SSE response) |
| `DELETE` | `/api/tasks/:id` | Delete a task |
| `DELETE` | `/api/sessions/:sessionId/tasks` | Clear all tasks for a session |

The `/api/tasks/run` endpoint accepts `{ task, sessionId }` in the request body and responds with a stream of JSON events:

```
data: {"type":"start","taskId":"..."}
data: {"type":"stage","stage":"plan","done":[]}
data: {"type":"log","who":"plan","html":"..."}
data: {"type":"codeToken","partial":"..."}
data: {"type":"tests","results":[...]}
data: {"type":"verdict","status":"win",...}
data: {"type":"done","taskId":"..."}
```

---

## Deployment

The project is configured for Vercel. The JSON store writes to `/tmp` when the `VERCEL` environment variable is set (Vercel's writable ephemeral filesystem).

Set `GROQ_API_KEY` in your Vercel project environment variables before deploying.

```bash
vercel deploy
```

---

## License

MIT
