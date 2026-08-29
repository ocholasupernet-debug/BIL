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

`pnpm run build:desktop` creates a desktop-sized React Native Web export for
packaging in the owner's preferred desktop shell. Desktop signing/notarization
and any Windows/macOS shell account remain separate from app code and are not
committed here. The native Android and iOS targets do not depend on Chrome.

## Development

The Replit workflow runs the Expo preview server. A preview is useful for
checking layout, but device builds should always use the platform commands
above so native secure storage and native navigation are exercised.