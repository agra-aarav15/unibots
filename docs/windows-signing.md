# Windows signing

The Windows installer is currently **unsigned**. Windows SmartScreen shows
"Windows protected your PC" on first launch until enough people run the same file,
or until the build is signed. Do not turn off signature checks or lower updater
security to hide that warning; sign the installer instead.

## What unsigned means for updates

An unsigned build has no publisher in its update configuration, so it accepts the
first signed update. From then on, updates must come from the same publisher. That
is why the certificate should be added before an installer is published widely.

## Add a certificate

There are two supported routes. Either one makes the release workflow sign the
installer and record the publisher.

### Azure Artifact Signing (what CI is wired for)

1. Create a Public Trust certificate profile in Azure Artifact Signing.
2. Create an app registration and give it the Artifact Signing Certificate Profile
   Signer role on the signing account.
3. Add a federated credential whose subject is the `desktop-release` environment
   in your repository. The subject includes owner and repository IDs, so copy the
   exact value printed under "Federated token details" in the release's Azure
   login step.
4. Set these repository secrets:

   | Secret | Value |
   | --- | --- |
   | `DESKTOP_WIN_AZURE_TENANT_ID` | Directory (tenant) ID of the app registration |
   | `DESKTOP_WIN_AZURE_CLIENT_ID` | Application (client) ID of the app registration |

5. Set these repository variables:

   | Variable | Value |
   | --- | --- |
   | `DESKTOP_WIN_SIGNING_ENDPOINT` | The signing account's URI, such as `https://eus.codesigning.azure.net/` |
   | `DESKTOP_WIN_SIGNING_ACCOUNT` | The signing account name |
   | `DESKTOP_WIN_SIGNING_PROFILE` | The certificate profile name |
   | `DESKTOP_WIN_PUBLISHER` | The certificate's common name, exactly as validated |

### A PFX certificate

Put the certificate and its password in the `CSC_LINK` and `CSC_KEY_PASSWORD`
secrets that electron-builder reads. Never commit a `.pfx`, its password, or a
base64 copy of either.

## Verify a build

```powershell
Get-AuthenticodeSignature .\Rakazo-Setup-<version>.exe | Format-List Status, SignerCertificate
```

`Status` must be `Valid` and the signer must match the publisher recorded in the
release feed.