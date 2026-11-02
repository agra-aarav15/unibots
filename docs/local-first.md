# Local-first

Unibots runs on your own computer or your own server. No hosted service is involved: the desktop
app either runs the whole stack locally in Docker or connects to an instance you run, and the
phone connects to one of those two. This page lists where data lives, what leaves the machine,
and how to back up, recover, and turn things off.

## Where your data lives

The desktop app keeps the Compose project in its user data directory:

- Windows: `%APPDATA%\Unibots\stack`
- macOS: `~/Library/Application Support/Unibots/stack`
- Linux: `~/.config/Unibots/stack`

That folder holds `.env` (generated secrets), `docker-compose.images.yml`, the LAN overlay, and
the private stack token. It does not hold your data. The data is in Docker volumes named after
the project (`rakazo-desktop_...`):

| Volume | Holds |
| --- | --- |
| `pgdata` | Postgres: accounts, spaces, bots, threads, messages, memory revisions |
| `appdata` | `/data`: uploads, artifacts, and bot homes under `/data/homes` |
| `webassets` | Hashed web assets from earlier builds, so open tabs keep loading |

A source checkout or VPS uses the same layout with the `data/` directory and the `rakazo` Compose
project. See [self-host storage](./self-host-storage.md) for what is in Postgres versus `DATA_DIR`.

## What leaves the machine

- The model provider you configure, for the bot's replies and for memory curation.
- The image registry, when the stack pulls Unibots images the first time.
- Any integration you set up yourself (messaging, voice, object storage).
- Update checks only when you ask for one, or when you set `RAKAZO_AUTO_UPDATE=on`.

There is no analytics, error tracking, email, billing, or hosted control plane. With no model
configured, a local install makes no outbound request during signup, chat, or settings.

## Run it for free

Bots need a model, but not a paid one. Install [Ollama](https://ollama.com) on the machine that
runs the stack, pull a model, and list it in the stack's `.env`:

```bash
ollama pull llama3.2
```

```bash
RAKAZO_LOCAL_MODELS=llama3.2
RAKAZO_LOCAL_MODELS_URL=http://host.docker.internal:11434/v1
```

Restart the stack. The model connection screen then offers a keyless local provider next to any
paid keys you add later, so a bot can answer without a subscription. `host.docker.internal` is how
the containers reach a server on your own computer; use `127.0.0.1` only when the app runs outside
Docker. Smaller models trade quality for speed, and a bot running on a local model costs nothing
per message.

## Back up

Back up the database and the data volume together; a snapshot of one without the other cannot be
restored. See [backup and restore](./self-host-backups.md). For the desktop stack:

```bash
docker compose --env-file .env -f docker-compose.images.yml exec -T postgres \
  pg_dump -U rakazo rakazo > rakazo.sql
docker run --rm -v rakazo-desktop_appdata:/data -v "$PWD":/backup busybox \
  tar czf /backup/appdata.tgz -C /data .
```

`CONTENT_ENCRYPTION` is `off` for the local stack, so those backups are only as private as the
disk they land on. Keep the generated secrets in `.env` too: without them the database cannot be
read by a new install.

## Reset a password

A local install sends no mail, so recovery is a command on the machine that runs the stack. See
[local recovery](./local-recovery.md).

## Connect a phone

With **This computer**, turn on **Settings → Account → Phone on this network**; the phone then
pairs with a six-digit code. See [desktop app](./desktop-app.md#phone-access). Phone access is
plain HTTP on the private network, so use the VPS path anywhere the network is not trusted.

## Connect a VPS

To point the desktop app and the phone at your own server with HTTPS, follow
[Connect a VPS](./connect-vps.md).

## Disable memory curation

After a direct conversation, the stack makes one extra model call that maintains the bot's
`MEMORY.md` and your `USER.md`. To turn it off, set this in the stack `.env` and recreate the
stack:

```env
MEMORY_CURATION=off
```

Existing memory stays readable and editable; only new automatic writes stop. See
[memory](./memory.md) for the caps, where the files live, and export and deletion.
