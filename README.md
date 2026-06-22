# Pill Reminder

A simple Android pill reminder app. Built with Expo (React Native).

## Features

- Local username/password login (data stays on device)
- Add medicines with multiple daily times
- Configurable snooze duration (5/10/15/30 min)
- Full-screen alarm with vibration + sound when it's time
- Confirm "Took it" (marks green for today) or "Skip" (snoozes for chosen duration)
- Long-press a medicine on Home to delete it

## Build an installable APK

You do not need Android Studio. We use **EAS Build** (cloud) to produce an APK.

### 1. Install tools (one-time, on your PC)

```bash
npm install -g eas-cli
```

### 2. Install dependencies

```bash
cd "C:\Users\divya\OneDrive\Desktop\Sundeep's Workspace\PillReminder"
npm install
```

### 3. Log in to Expo (free account)

```bash
eas login
```

If you do not have an account, create one at https://expo.dev/signup.

### 4. Link the project

```bash
eas init
```

This populates `extra.eas.projectId` in `app.json`. (Replaces the `REPLACE_WITH_YOUR_EAS_PROJECT_ID` placeholder automatically.)

### 5. Build the APK

```bash
eas build -p android --profile preview
```

The build runs in Expo's cloud (free tier: ~15-30 min wait per build). When it finishes you'll get a link to download a `.apk`. Transfer it to any Android phone and install it (enable "Install from unknown sources" first).

## Run locally without building an APK (optional)

Install the **Expo Go** app from Play Store on your phone, then on your PC:

```bash
npm start
```

Scan the QR code with Expo Go. Note: notifications/alarms have some limitations in Expo Go — the full alarm experience works only in a real APK build.

## Permissions the app asks for

- Notifications (to ring alarms)
- Exact alarms (to fire at the precise minute)
- Full-screen intent (to wake the screen on lock)
- Vibrate

On Android 13+ the OS will prompt for "Allow notifications" the first time you add a medicine.

## Project structure

```
App.js                      Navigator + notification listeners
index.js                    Expo entry
app.json                    Expo config (permissions, plugin)
eas.json                    Build profiles
src/
  screens/
    LoginScreen.js          Login + register
    HomeScreen.js           Today's medicines + status
    AddMedicineScreen.js    Add medicine form
    AlarmScreen.js          Full-screen alarm UI
  utils/
    storage.js              AsyncStorage helpers
    notifications.js        Schedule / snooze / channel setup
```

## Known limitations

- Auth is local-only (no server). Each phone has its own user list.
- If the phone is fully powered off, scheduled alarms only resume after boot if the user has granted boot permission (Android may prompt).
- Aggressive battery savers on some OEM devices (Xiaomi, Oppo, Vivo) can kill scheduled notifications — whitelist the app in battery settings if alarms get missed.
