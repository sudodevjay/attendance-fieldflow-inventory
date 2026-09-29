# Housys Attendance — mobile app (React Native / Expo)

The employees' app. Same server and data as the web employee portal (`/me` of `web/`): the employee logs in with
their **AC No** and the password HR created (Employee Portal → Employee Logins in the administrator program).

| Tab / screen | What |
|---|---|
| Home | check-in / check-out card, attendance % and punctuality % of the month, today's status, leave requests, quick links, leaves availed / remaining + Apply, birthdays / next holiday, late days with "Regularise"; **me / US** toggle (US = team today for managers, holidays for everyone) |
| Calendar | month calendar with P / A / HD / H / WO, tap a day for its punches, regularise a day |
| Menu | Apply Leave, Leave Reports, Holidays, My Requests, Attendance Regularisation, Overtime Request, Comp-off (balance + claim), Payslips, Yearly Report, Reimbursement (expense with receipt photo), Loans & Advances, Notifications, My Profile (HR details, Request a Change, My Documents with photo upload), Team (managers) |
| Settings | profile, change password, server, log out |
| Home bell | unread notifications (request decisions, HR announcements); in-app only, no phone push notifications |

Built with Expo SDK 57, Expo Router (`src/app`), expo-secure-store (login token), expo-image-picker (receipt photo),
expo-web-browser (payslip PDF).

## Run
```
cd mobile
npm install
npx expo start          # scan the QR code with Expo Go (Android / iOS) on the same Wi-Fi as the server PC
```
On the login screen enter the **server address** = the PC running `web/server`, e.g. `192.168.1.46:4000`
(Windows Firewall must allow inbound TCP 4000 on that PC).

Checks: `npx tsc --noEmit`, `npx expo-doctor`, `npx expo export --platform android` (bundles the app).

## Install file (APK / App Store)
Build in the Expo cloud (free account): `npx eas-cli@latest build --platform android --profile preview` gives an APK
to install on the phones; `--platform ios` needs an Apple developer account. See https://docs.expo.dev/build/setup/.
The server address is typed in by the employee, so one build works for any office.

Note: plain `http://` works in Expo Go and in development. A release build on Android blocks plain http by default:
put the server behind https (recommended when used over the internet), or allow cleartext traffic for the LAN in the
build configuration.
