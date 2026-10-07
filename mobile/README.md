# Housys Attendance — mobile app (React Native CLI)

The employees' app. Same server and data as the web employee portal (`/me` of `web/`): the employee logs in with
their **AC No** and the password HR created (Employee Portal → Employee Logins in the administrator program).

| Tab / screen | What |
|---|---|
| Home | check-in / check-out card, attendance % and punctuality % of the month, today's status, leave requests, quick links, leaves availed / remaining + Apply, birthdays / next holiday, late days with "Regularise"; **me / US** toggle (US = team today for managers, holidays for everyone) |
| Calendar | month calendar with P / A / HD / H / WO, tap a day for its punches, regularise a day |
| Menu | Apply Leave, Leave Reports, Holidays, My Requests, Attendance Regularisation, Overtime Request, Comp-off (balance + claim), Payslips, Yearly Report, Reimbursement (expense with receipt photo), Loans & Advances, Notifications, My Profile (HR details, Request a Change, My Documents with photo upload), Team (managers) |
| Settings | profile, change password, server, log out |
| Home bell | unread notifications (request decisions, HR announcements); in-app only, no phone push notifications |

| Check-in | only at a work site when HR turned it on: GPS inside the site's radius (no mock location, accuracy limit) + a selfie |

Plain **React Native CLI** 0.86 (no Expo), TypeScript, React Navigation (bottom tabs + native stack),
react-native-keychain (server address + login token), react-native-image-picker (selfie, receipt, document photos),
@react-native-community/geolocation (site check-in), @react-native-vector-icons/ionicons. Package
`com.housys.attendance`.

| Where | What |
|---|---|
| `index.js` → `src/App.tsx` | login gate (login → first-password → tabs), tabs and every screen |
| `src/screens/`, `src/screens/tabs/` | the screens |
| `src/lib/nav.ts` | `router.push('/leave?apply=1')`, `router.back()`, `useLocalSearchParams()` on top of React Navigation |
| `src/lib/api.ts` | server calls (`/api/portal`), token in the Keychain |
| `src/lib/siteCheckIn.ts`, `src/lib/media.ts` | GPS + selfie check-in, photo from camera / gallery |
| `android/` | the Android project (kept in git). Permissions: internet, fine / coarse location |

## Run (development)
```
cd mobile
npm install
npx react-native start            # Metro
npx react-native run-android      # emulator or phone with USB debugging
```
Checks: `npm run typecheck`, `npm run lint`.

## Install file (APK)
```
cd mobile/android
gradlew assembleRelease           # -> app/build/outputs/apk/release/app-release.apk
```
Copy it to `release/HousysAttendance-<version>.apk` (that folder is not in git). Before a new build raise
`versionCode` / `versionName` in `android/app/build.gradle`; the APK is signed with `android/app/debug.keystore`
(the same key as the earlier Expo builds, so it installs as an update over them). For the Play Store make a real
release key first.

Only `https://` servers work in the release APK. Test build for a server on the PC:
`gradlew assembleRelease -PallowHttp`, then on the emulator `adb reverse tcp:4000 tcp:4000` and server `localhost:4000`.

Note: version 1.1.0 (the first CLI build) keeps the login in the Keychain, the Expo builds in SecureStore: after the
update everyone logs in once again.
