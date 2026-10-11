# WebToAPK — Website to Android APK converter (MVP)

This project includes:
- A responsive frontend (`public/index.html`)
- A Node.js/Express API (`server.js`)
- An Android WebView project template (`android-template/`)
- A backend that runs Gradle and returns a generated **debug APK**

## Important limitations

1. The output is an **unsigned debug APK** for testing. It is not a signed Play Store release.
2. The site is a WebView wrapper, not a converter to fully native Android code.
3. The server needs Node.js 20+, JDK 17+, Android SDK Platform 35, Android Build-Tools 35.0.0, and Gradle 8.9+.
4. APK generation is not possible on static-only hosting (GitHub Pages/Netlify). Deploy the frontend and API together on a machine that has the Android build tools, or split them into a static frontend and a private build worker.
5. Do not expose this MVP publicly as-is. It has basic rate limiting, but no user login, billing, queue persistence, CAPTCHA, or abuse controls. A public service needs authentication, stronger quotas, isolated build workers, monitoring, and a secure signing process.
6. Only package websites you own or have permission to distribute. Test sites that depend on push notifications, payments, OAuth, downloads, camera, or complex browser features separately.

## Local setup — Windows

### 1. Install prerequisites
- Install Node.js 20 LTS or newer.
- Install Android Studio. In **SDK Manager**, install:
  - Android SDK Platform 35
  - Android SDK Build-Tools 35.0.0
  - Android SDK Command-line Tools (latest)
- Install JDK 17.
- Install Gradle 8.9 or newer and make sure `gradle --version` works in a new terminal.

Android Studio's bundled Gradle is not automatically available as a global `gradle` command. Install Gradle separately or configure `GRADLE_COMMAND` to point at a Gradle executable you installed.

### 2. Configure Android SDK
Find the SDK path in Android Studio → Settings → Languages & Frameworks → Android SDK.
Common Windows path: `%LOCALAPPDATA%\Android\Sdk`.

In PowerShell, set these for the current terminal (replace the path if needed):

```powershell
$env:ANDROID_HOME="$env:LOCALAPPDATA\Android\Sdk"
$env:ANDROID_SDK_ROOT=$env:ANDROID_HOME
$env:Path += ";$env:ANDROID_HOME\platform-tools;$env:ANDROID_HOME\cmdline-tools\latest\bin"
```

Confirm:
```powershell
java -version
gradle --version
sdkmanager --list
```

Accept SDK licenses if needed:
```powershell
sdkmanager --licenses
```

### 3. Install Node packages and run
Open PowerShell in this project folder:

```powershell
npm install
npm start
```

Open `http://localhost:3000` in your browser. Paste a public `https://` URL, enter an app name and package name, then click **Convert to APK**.

The first Gradle build downloads Android Gradle Plugin dependencies, so it needs internet access and can take several minutes. Later builds are usually faster.

### 4. Find the APK
Use the Download APK link after the build completes. The server stores generated files under `work/` and deletes old completed jobs after roughly one hour.

## Linux VPS deployment (overview)

Use a VPS with enough RAM/disk for Android builds (recommend at least 4 GB RAM for a single build). Install:
- Node.js 20+
- JDK 17
- Android SDK command-line tools
- `platforms;android-35`
- `build-tools;35.0.0`
- Gradle 8.9+

Set `ANDROID_HOME` and `ANDROID_SDK_ROOT`, accept licenses, install npm packages, and run the service behind HTTPS using a reverse proxy and process manager. Keep build workers private. Add login, stricter rate limits/quotas, request logging, disk monitoring and a job queue before public launch. Do not put signing passwords/keys in this web app.

## Troubleshooting

- **`Could not start Gradle`**: `gradle --version` must work from the same terminal that runs `npm start`. On Windows you may set `GRADLE_COMMAND` to the full path to `gradle.bat`.
- **SDK location not found**: set `ANDROID_HOME` and `ANDROID_SDK_ROOT` to the Android SDK directory.
- **SDK platform/build-tools missing**: install Platform 35 and Build-Tools 35.0.0 in Android Studio SDK Manager or with `sdkmanager`.
- **Build fails at dependency download**: check internet access and Gradle/Google Maven access; read the server terminal output.
- **APK installs but site is blank**: check that the URL is HTTPS, public, and compatible with Android WebView. Some sites block embedded browsers or require extra WebView configuration.
- **Login/payment features don't work**: this starter deliberately keeps the WebView minimal. Such sites may need domain-specific implementation and testing.

## Next production milestones

- Accounts and per-user build quotas
- Persistent job queue and worker isolation
- Custom app icon/splash screen upload with strict image validation
- Signed release APK/AAB generation with secure key management
- Build logs visible to the owner but sanitized for users
- Terms of service, privacy policy, malware/abuse controls
