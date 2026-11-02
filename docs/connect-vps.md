# Connect a VPS

Point the desktop app and the phone at an install you run on a server. This is the
**Existing instance** path in the desktop app; nothing here needs a hosted service.

## Run the stack on the server

Install Docker and Compose, then follow [self-host.md](./self-host.md) with the published
images. Put TLS in front of the web and API origins with Caddy, nginx, or your own proxy,
and set:

```env
BETTER_AUTH_URL=https://agents.example.com
WEB_ORIGIN=https://agents.example.com
API_URL=https://agents.example.com
RAKAZO_HOST=agents.example.com
```

Create the owner account, then close sign-ups so nobody else can make one:

```env
SIGNUPS_ENABLED=false
```

Recreate the stack after the change. Password recovery with no email provider is the
command in [local-recovery.md](./local-recovery.md), run on the server.

## Connect the desktop app

Choose **Existing instance**, enter `https://agents.example.com`, and press
**Check connection**. If an access proxy (Cloudflare Access, an SSO gateway) sits in front,
put its headers in the **Headers** box as `Name: value` lines.

## Connect the phone

Enter the same HTTPS origin on the phone's server screen with the app's normal sign-in.
Passkeys work on a real domain where the browser has a platform authenticator.

Do not point a phone at a plain HTTP public address. HTTP is accepted only for a private
network address, which is what the desktop's own pairing uses; a public host needs HTTPS.
