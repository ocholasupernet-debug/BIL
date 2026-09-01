# OcholaSuperNet native app

This artifact is the native companion for ISP administrators. It is a React
Native / Expo app, not a WebView wrapper. The Android and iOS builds use the
same secure login flow and never read the web dashboard's `localStorage`.

## Included

- Branded native login with the OcholaSuperNet wordmark and globe mark
- `POST /api/auth/admin/login` authentication against the existing API
- Session restore from `expo-secure-store` on Android and iOS
- Explicit logout and automatic clearing when `/api/auth/me` rejects a session
- Touch-friendly Home, Customers, Network, Billing, and Settings areas
- Tenant-scoped API requests using the issued bearer token
- Android, iOS, and desktop export commands

The API origin is configured with `EXPO_PUBLIC_API_BASE_URL`. If it is not set,
the app uses `https://isplatty.org`, which matches the existing platform
domain. Do not put Supabase service keys, router credentials, payment secrets,
or private keys in this variable or in the app bundle.

## Build targets

### Android APK

For a local release build, install the Android SDK and configure `ANDROID_HOME`,
then run:

```sh
EXPO_PUBLIC_API_BASE_URL=https://your-public-api-origin \
  pnpm --filter @workspace/ocholasupernet-mobile run build:android
```

The release APK is written by Gradle under `android/app/build/outputs/apk/`.
The Android package name is `org.isplatty.ocholasupernet`.

For a signed internal distribution build through Expo Application Services:

```sh
EXPO_PUBLIC_API_BASE_URL=https://your-public-api-origin \
  pnpm --filter @workspace/ocholasupernet-mobile exec eas build \
  --platform android --profile preview
```

That command requires the app owner's Expo/EAS account and signing credentials.
Those credentials are intentionally not part of this repository.

### iPhone

Run `pnpm run build:ios` on macOS with Xcode for a local device/simulator
build. The bundle identifier is `org.isplatty.ocholasupernet`. An App Store or
TestFlight archive requires the owner's Apple Developer team and signing
certificates. EAS can also produce the archive with:

```sh
pnpm --filter @workspace/ocholasupernet-mobile exec eas build \
  --platform ios --profile production
```

### Desktop

The desktop target uses Electron around the existing React Native Web export.
Electron serves the export from a loopback address so the Expo `/mobile` base
path continues to work in an installed app. The renderer has no Node.js access;
the desktop shell only owns the window and local static-file server.

```sh
# Build the desktop web export
pnpm run build:desktop

# Open the exported app in Electron during development
pnpm run desktop:dev

# Build an unpacked Linux package for local smoke testing
pnpm run desktop:package:dir

# Run on the matching native runner for installers
pnpm run desktop:package:windows
pnpm run desktop:package:macos
```

The Windows command produces an NSIS installer and a portable executable. The
macOS command produces a DMG and ZIP archive. Both commands write to
`release/`, which is ignored as build output and is safe to remove between
builds. `EXPO_PUBLIC_API_BASE_URL` can override the default
`https://isplatty.org` API origin for a staging build; it is compiled into the
web export and must be a public HTTPS origin reachable by the desktop machine.

GitHub Actions includes a `Desktop Releases` workflow. Run it manually or push
a tag matching `desktop-v*` to build unsigned Windows and macOS artifacts on
their native runners. The workflow deliberately disables automatic signing so
it can produce test packages without credentials.

#### Signing and notarization

Unsigned packages are suitable for internal testing only. A production Windows
release needs a Microsoft code-signing certificate and protected CI
credentials. A production macOS release needs an Apple Developer
Developer ID Application certificate, an App Store Connect API key (or Apple
ID app-specific password), and notarization access. Configure those in the
CI secret store; never commit `.p12`, `.p8`, `.cer`, `.key`, or password files.
The Electron builder supports the corresponding `CSC_LINK`, `CSC_KEY_PASSWORD`,
`APPLE_API_KEY`, `APPLE_API_KEY_ID`, and `APPLE_API_ISSUER` environment
variables when the owner is ready to enable trusted releases.

Desktop packaging does not change the API, Android/iOS session contract, or
native secure-storage behavior. The native Android and iOS targets do not
depend on Chrome.

## Development

The Replit workflow runs the Expo preview server. A preview is useful for
checking layout, but device builds should always use the platform commands
above so native secure storage and native navigation are exercised.