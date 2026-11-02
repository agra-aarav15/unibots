# Local recovery

A local install has no email provider, so password recovery is a command on the machine that runs
the stack. It needs no network and sends no mail.

## Reset a password

Run this where the Compose file and `.env` live. For the desktop app, that is the stack folder in
the app's user data directory. For a source checkout, use
`infra/compose/docker-compose.images.yml`.

```bash
read -r -s -p "New password: " RAKAZO_NEW_PASSWORD; echo
printf '%s' "$RAKAZO_NEW_PASSWORD" | docker compose --env-file .env -f docker-compose.images.yml exec -T api node dist/cli/reset-password.js --email you@home
unset RAKAZO_NEW_PASSWORD
```

The command accepts `--email`, reads the new password from `RAKAZO_NEW_PASSWORD` or stdin, and
prints only `Password reset for <email>`. It rejects unknown accounts and passwords outside the
8–128 character policy. Every existing session for that account is deleted, so sign in again on
each device.

If the container cannot read stdin, set the variable on the `exec` command instead:

```bash
docker compose --env-file .env -f docker-compose.images.yml exec -T -e RAKAZO_NEW_PASSWORD api node dist/cli/reset-password.js --email you@home
```

The variable is visible to the container process, so prefer stdin when other users share the
machine.

## First account

The local stack allows signup while it is reachable only from this computer. Open the app, create
the first account with any email-shaped identifier and a password, and use that account from then
on. No mail is sent and no verification step exists.

When phone access is enabled, signup closes so a device on the network cannot create an account.
Create the owner account on the computer first.

## Account deletion

A password account deletes itself from Settings → Account with its password. No email is involved.
