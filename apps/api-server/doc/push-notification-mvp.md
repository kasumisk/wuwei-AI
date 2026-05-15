# EatCheck Push Notification MVP

## Provider Architecture

- Business code calls `PushService.send()` only.
- `PushProviderFactory` resolves `PushProviderType` from `pushRegion`, platform and device brand.
- `PushProviderRegistry` stores pluggable providers: `FCM`, `JPUSH`, `HUAWEI`, `MOCK`.
- `FCM` is the default for `GLOBAL`; `JPUSH` is the default for `CHINA_MAINLAND`; Huawei/Honor devices prefer `HUAWEI`.
- Provider fallback defaults to `MOCK`; override with `PUSH_FCM_FALLBACK`, `PUSH_JPUSH_FALLBACK`, or `PUSH_HUAWEI_FALLBACK`.

## API

- `POST /api/push/register-token`
- `POST /api/push/unregister-token`
- `GET /api/push/preferences`
- `PATCH /api/push/preferences`
- `POST /api/push/test`

All endpoints require App JWT auth.

## Firebase Configuration

- Backend uses the existing Firebase Admin app named `app-auth`.
- Configure `FIREBASE_SERVICE_ACCOUNT` or `FIREBASE_CREDENTIALS_PATH`.
- Flutter global builds use `firebase_options.dart`, `GoogleService-Info.plist`, and `google-services.json`.

## iOS

- Enable Push Notifications and Background Modes > Remote notifications.
- Upload APNs auth key/cert to Firebase Console.
- Call `PushManager.initialize()` after Firebase init; it waits for APNs through the FCM adapter.

## Android

- Add `google-services.json` for global builds.
- Create notification channel `eatcheck_retention` in native Android if local foreground display is added.
- China builds should use a separate flavor/applicationId and wire JPush/Huawei native SDK under `ChinaPushAdapter`.

## Test Flow

- Run Prisma migration/generate after schema changes.
- Login in Flutter, verify `POST /api/push/register-token` succeeds.
- Call `POST /api/push/test` and verify a device-level `push_notification_logs` row is created.
- Disable a preference with `PATCH /api/push/preferences`, then verify scheduler/test without `force` skips sending.
- Simulate invalid FCM token and verify token becomes inactive.

## Pitfalls

- Do not send sensitive health details in notification title/body.
- Do not use in-process cron in production; use `CRON_BACKEND=external` and Cloud Scheduler/Jobs.
- Ensure user timezone is an IANA timezone, not a raw GMT offset.
- Keep China and global packages separate when store compliance requires different SDKs.
