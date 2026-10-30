# Hermes brain for Unibots

Unibots uses [Hermes Agent](https://github.com/NousResearch/hermes-agent) as its brain. The
web/desktop/mobile UI, threads, spaces, teammate bots, computers and orchestration stay in
Unibots; Hermes owns the model loop, tool execution, long-term memory and skill evolution.

Each Unibots bot runs on its **own Hermes profile**. A profile has its own:

- `MEMORY.md` — durable lessons the agent curates (2,200 character cap)
- `USER.md` — the evolving user model (1,375 character cap)
- `SOUL.md` — the bot's identity and working style
- `skills/` — self-authored and curated `SKILL.md` procedures
- `state.db` — sessions and FTS5 searchable history

Profiles are isolated from each other, so one bot's private memory never appears in another
bot's prompt. The gateway multiplexes them at `/p/<profile>/`.

## Prerequisites

- Docker Engine with the Compose plugin
- A model provider key for Hermes (OpenRouter, Anthropic, OpenAI, Google, xAI, DeepSeek or
  Mistral). Hermes reads its own model configuration; the model picker inside Unibots applies
  to the Pi runtime, not to Hermes.
- Three independent random secrets:

```bash
openssl rand -hex 32   # UNIBOTS_HERMES_API_KEY (the gateway's root key)
openssl rand -hex 32   # UNIBOTS_HERMES_PROVISION_SECRET
openssl rand -hex 32   # UNIBOTS_HERMES_PROFILE_SECRET
```

## First-run setup

The gateway needs a configured root profile before it can clone per-bot profiles, and its API
server refuses to start without `UNIBOTS_HERMES_API_KEY`. Configure the provider and model once,
interactively:

```bash
docker compose --env-file .env \
  -f infra/compose/docker-compose.images.yml \
  -f infra/hermes/docker-compose.hermes.yml \
  --profile hermes run --rm hermes setup
```

Choose the provider and model Hermes should use. The data lives in the
`unibots-hermes-data` volume. Keep that volume; it contains every bot's memory and skills.

For a source checkout, replace `docker-compose.images.yml` with
`infra/compose/docker-compose.yml`.

## Enable Hermes

Add to `.env`:

```dotenv
AGENT_RUNTIME=hermes
COMPOSE_PROFILES=hermes
UNIBOTS_HERMES_URL=http://hermes:8642
UNIBOTS_HERMES_PROVISION_URL=http://hermes-provisioner:8650
UNIBOTS_HERMES_PROVISION_SECRET=<first secret>
UNIBOTS_HERMES_PROFILE_SECRET=<second secret>
# Optional: force a model alias configured inside Hermes.
UNIBOTS_HERMES_MODEL=
# Only for single-profile mode (no per-bot isolation):
UNIBOTS_HERMES_API_KEY=
UNIBOTS_HERMES_PROFILE=
```

Start the stack:

```bash
docker compose --env-file .env \
  -f infra/compose/docker-compose.images.yml \
  -f infra/hermes/docker-compose.hermes.yml \
  --profile hermes up -d
```

The provisioner creates a profile the first time a bot runs, writes its derived
`API_SERVER_KEY`, and returns the same key on every restart. The runtime then calls
`http://hermes:8642/p/<profile>/v1/chat/completions` with that key.

## Single-profile mode

If you run one trusted bot per deployment, you can skip the provisioner:

```dotenv
AGENT_RUNTIME=hermes
COMPOSE_PROFILES=hermes
UNIBOTS_HERMES_URL=http://hermes:8642
UNIBOTS_HERMES_API_KEY=<the gateway API_SERVER_KEY>
UNIBOTS_HERMES_PROFILE=default
UNIBOTS_HERMES_PROVISION_URL=
UNIBOTS_HERMES_PROVISION_SECRET=
```

In this mode every bot shares one memory store. Do not use it for mutually untrusted users.

## Approvals

Hermes executes its own tools. Its approval modes are `manual`, `smart` and `off`. The Unibots
adapter does **not** auto-approve and cannot yet forward a Hermes approval prompt into the
Unibots approval UI; when Hermes asks for approval the run fails with an actionable error instead
of silently bypassing the gate. Configure the profile for the autonomy you intend:

- `off` — no prompts; the bot acts autonomously inside its container.
- `smart` — low-risk actions proceed; high-risk actions pause. Use a non-interactive tool set
  for unattended bots.
- `manual` — every action pauses. Use the Hermes dashboard while supervising a run.

Approval bridging is the next integration step. It is deliberately not faked.

## What runs where

Hermes owns the model loop and executes its tools inside the Hermes container. Unibots keeps the
thread, UI, teams, routines and computers. The two tool surfaces are not bridged yet: a Hermes run
cannot call the Unibots computer, browser, connector tools, or a signed-in user's device. Use
`AGENT_RUNTIME=pi` for workflows that depend on those host tools; use Hermes for the evolving
memory, skills and autonomous work inside its own container.

Deleting a bot in Unibots does not delete its Hermes profile. The profile directory under
`/opt/data/profiles/` keeps that bot's `MEMORY.md`, `USER.md` and sessions until you remove it. To
erase a bot's memory, stop the stack, delete its profile directory from the `unibots-hermes-data`
volume, and start again.

## Security boundaries

- The provisioner and gateway are not published beyond loopback.
- `UNIBOTS_HERMES_PROVISION_SECRET` authenticates profile creation; keep it out of the browser.
- `UNIBOTS_HERMES_PROFILE_SECRET` derives per-profile API keys; rotating it requires recreating
  the profile `.env` keys (delete the profile directories or run the provisioner again after
  removing the managed lines).
- Hermes profiles isolate state, not capabilities. Run mutually untrusted tenants in separate
  containers/volumes if you need a hard blast-radius boundary.
- The Hermes image is MIT-licensed; its license is retained in
  [LICENSE.hermes-agent](./LICENSE.hermes-agent).

## Verification

```bash
# Gateway health (inside the Compose network or from the host loopback port)
curl -fsS http://127.0.0.1:8642/health

# Provisioner health
docker compose --env-file .env -f infra/compose/docker-compose.images.yml \
  -f infra/hermes/docker-compose.hermes.yml --profile hermes exec hermes-provisioner \
  python3 -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8650/health').read().decode())"
```

Then send a message to a bot in Unibots. The first run creates `bot-<botId>` under
`/opt/data/profiles/`; after the run, `MEMORY.md` and `USER.md` are populated by Hermes'
background review and the next prompt includes them.
