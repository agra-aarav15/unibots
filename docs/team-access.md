# Letting a team reach your instance

Unibots runs on a machine you control, and by default it listens on `127.0.0.1` only: nothing
outside that machine can reach it. To let a few people use the same instance, pick one of the
paths below, then give them a way in.

Whatever you choose, the instance has to be awake for it to answer. Routines, bots and replies all
stop when the machine sleeps or the worker exits.

## 1. The same network

For anyone on the same Wi-Fi, the desktop app has a switch: **Settings → Phone access** publishes
the API on your local network, and the mobile app pairs with it. From a checkout or an image
deploy, the overlay does the same:

```bash
docker compose -f infra/compose/docker-compose.images.yml \
  -f infra/compose/docker-compose.lan.yml up -d
```

Plain HTTP is allowed between private addresses (`10.x`, `172.16-31.x`, `192.168.x`, `*.local`);
everything else needs HTTPS. This path is the least setup and the most limited: it works only
while the two machines are on that network, and the address changes with the network.

## 2. A tunnel, with no port forwarded

A tunnel gives you a hostname without opening anything on your router or knowing your public
address. Both work with the stack exactly as it is, listening on `127.0.0.1`:

```bash
# Cloudflare Tunnel: a temporary public hostname, no account needed
cloudflared tunnel --url http://127.0.0.1:5173

# Tailscale: reachable only by devices in your tailnet
tailscale serve --bg https / http://127.0.0.1:5173
```

Either way the web and API must then be told the address they are reached on, in the four
variables below, and the tunnel must be trusted as a proxy so clients are not all seen as one
address. A tunnel address is stable while the tunnel runs; a temporary Cloudflare hostname changes
every time it restarts, which invalidates sessions and app pairings.

## 3. A server with HTTPS

If the instance should be up when your machine is not, run it on a server instead:
[Production deployment](./self-host-production.md) covers a single VM with Caddy, automatic
certificates and hardened defaults. [Connect a VPS](./connect-vps.md) is the shorter form.

## The four addresses

Set all four to the origin people actually type, with no trailing slash:

| Variable | What it must be |
| --- | --- |
| `WEB_ORIGIN` | Where the web app is served, e.g. `https://bots.example.com` |
| `BETTER_AUTH_URL` | The same origin: sessions and cookies are bound to it |
| `API_URL` | The API's public origin, e.g. `https://bots.example.com` |
| `RAKAZO_HOST` | The hostname for the reverse proxy's virtual host |

An origin that does not match is refused: sign-in posts, cookies and websockets all fail closed
rather than silently working insecurely.

## Behind a proxy: trust and client addresses

A reverse proxy or CDN sits in front of the app, so the address the app sees is the proxy's. Tell
it which one to believe:

```bash
TRUSTED_PROXIES=caddy            # or the proxy's IPs / CIDRs, or `none`
CLIENT_IP_HEADER=cf-connecting-ip # default: x-forwarded-for
```

Leave `TRUSTED_PROXIES` unset and only local networks are believed. `infra/compose/Caddyfile.prod`
is a working template, and `Caddyfile.cloudflare.example` shows the CDN case with the request
ranges that may be trusted.

## Keeping it yours

Expose the instance with `SIGNUPS_ENABLED=false`. Anyone can then sign in, and nobody can create
an account — except someone you invited: **a pending invitation admits its address even while
signups are closed**. The link is the admission.

Add a teammate from the workspace they should join: **space settings → Invite someone → Create a
link**. Name their address to bind the link to it, or leave it open and hand the link over
yourself. Links expire after seven days, work once, and can be revoked from the same screen. A
bot keeps working for the workspace after whoever made it leaves; only its maker can change or
delete it.

## What to check once it is up

```bash
curl -s https://bots.example.com/health          # the API answers through the proxy
```

Then, in a browser: sign in, open the workspace, and confirm the address bar's origin is the one
in the table above. Invite yourself from a second browser profile to prove the join path, then
revoke the link.
