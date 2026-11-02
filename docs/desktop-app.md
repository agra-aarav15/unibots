# Desktop app

The desktop app for Mac, Windows and Linux runs the same Unibots as the web, and can also run
everything on your own computer.

## Install

Download it from [GitHub releases](https://github.com/agra-aarav15/unibots/releases/latest).
The Linux AppImage needs FUSE 2. The Windows installer is not code-signed yet, so SmartScreen warns
on first launch until a certificate is added ([how to sign it later](./windows-signing.md)).

## Choose a server

The first time it opens, the app asks which server to use:

- **This computer**: run your own Unibots locally in Docker. If Docker isn't installed, the app links
  to Docker Desktop, OrbStack and Docker Engine. Everything, including your bots' computers, then
  runs on your machine.
- **Existing instance**: connect to a Unibots server you or your team already run. Enter its
  **Server address** and choose **Check connection**.

To switch later, use **Change Unibots Server…** in the app menu (Cmd+Shift+K, or Ctrl+Shift+K on
Windows and Linux).

> [!NOTE]
> A local server keeps running after you quit the app, so routines still run. Choose
> **Stop Local Stack** in the app menu to shut it down.

## Let bots use this computer

The desktop app can give bots access to the computer it runs on, to run commands and work with your
files.

- With **This computer**, the app asks **Where should bots run?** Choose **Docker** to keep bots in
  their own isolated computers, or **Use this Mac** (**Use this computer** on Windows and Linux) to
  let them work directly on yours. **Computer Access…** in the app menu changes this later, and
  **Revoke Local Computer Access** turns it off.
- With any server, turn on **Let bots use this computer** in **Settings → General** under
  **Computers**. Your computer then shows as **Connected** or **Offline** there.

Either way, the app asks **Allow bots to use this computer?** before access is granted. See
[The bot's computer](./computer.md#use-your-own-computer).

> [!WARNING]
> With **Use this Mac**, bots can run commands without asking. Don't choose it for a server other
> people use.

## Phone access

With **This computer**, open **Settings → Account → Phone on this network** and choose
**Turn on**. The app publishes its API on your private network and shows the address and a
six-digit code. On the phone, enter that address on its server screen, type the code, and
press **Pair with computer**. The code works once and expires after five minutes.

While it is on, sign-ups are closed, so nobody else on the network can create an account.
**Turn off** removes the published port. Phone access serves plain HTTP on the private
network, so use it on a trusted home or office network and use the
[VPS path](./connect-vps.md) with HTTPS anywhere else.

## Updates

The app does not check for updates in the background. **Check for Updates...** in the app
menu checks now; set `RAKAZO_AUTO_UPDATE=on` on the app's environment to restore the launch
and hourly checks. When an update is ready, an **Install update** button appears at the
bottom of the sidebar, or choose **Restart** when asked.

## Shortcuts

- Cmd+N (Ctrl+N): create a bot, group or space.
- Cmd+K (Ctrl+K): jump to any bot.

The dock icon shows a badge count of unread chats.
