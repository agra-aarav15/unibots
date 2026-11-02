# App icon source

The mark is defined as geometry in [`src/mark.ts`](../src/mark.ts) and nowhere
else: a continuous "U" of constant weight on a rounded plate. Every platform
export is rasterised from those values, so there is one place to edit and no
traced or stock artwork anywhere in the pipeline.

`Unibots.icon` is the Icon Composer bundle for macOS and iOS. Its single asset,
`Assets/unibots-glyph.png`, is the transparent U that `export:brand` writes, so
its silhouette always matches the app icon. Open the bundle in Apple's Icon
Composer with Xcode 26 or newer to adjust the platform appearance; re-running
`export:brand` overwrites only the glyph.

The platform exports are:

- `apps/desktop/assets/icon.png`, `icon.ico`, `icon-macos.png`: Windows, Linux,
  and the macOS development export.
- `apps/mobile/assets/icon.png`: the iOS/generic icon.
- `apps/mobile/assets/adaptive-icon.png`: transparent Android foreground, inset
  so the glyph stays inside the launcher's safe area.
- `apps/mobile/assets/icon-background.png`: the flat plate colour Android draws
  behind the foreground.
- `apps/mobile/assets/monochrome-icon.png`: white alpha silhouette for themed
  launchers.
- `apps/mobile/assets/splash-icon.png`: the glyph with transparent padding, so it
  sits on either splash colour.
- `apps/mobile/assets/notification-icon.png`: 72 px white status-bar silhouette.

Run `pnpm --filter @rakazo/ui-tokens export:brand` to refresh all of the above,
the web and marketing favicons, the installer art, and the marketing mark. Never
bake platform corners or masks into the adaptive layers; Android supplies its own.

After exporting, run `pnpm exec tsx apps/www/scripts/render-og.mjs` to refresh the
marketing social cards; set `CHROME_PATH` to a headless Chrome executable when it
is not available at the script's default location.

## Animated vector avatars

The animated bot avatar is separate from the app mark. It is drawn from the paths
in `packages/core/src/logo-avatar-art.ts` — a symmetric head with side tabs — and
uses only vector gradients. No raster body is embedded or loaded by the renderer.