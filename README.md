# WakeGuard

A browser-based driver alertness prototype. It uses MediaPipe Face Landmarker to estimate eye closure and mouth opening in a live webcam feed. Video and landmark processing remain on the device; no recording or application server is used.

## Run locally

Camera and location permissions require a secure context. Use `localhost` or an HTTPS host:

1. Open this folder in VS Code and launch `index.html` with the **Live Server** extension, or
2. Run a local static server from this folder:

```powershell
python -m http.server 8000
```

Then open `http://localhost:8000` in a modern browser. Do not open `index.html` directly as a `file:` URL. An internet connection is required to load the MediaPipe library, face landmark model, and fonts. Allow camera access to start monitoring; location permission is requested only when you choose to share.

## Alerts and location sharing

The app estimates eye aspect ratio (EAR) and mouth aspect ratio (MAR) from facial landmarks. Sustained eye closure or mouth opening triggers an audible warning and an on-screen prompt. Relaxed, balanced, and sensitive settings adjust the time a sign must persist before alerting.

Enter a trusted contact's phone number and use **Share location** to open the device's SMS handler with a Google Maps link and a check-in message. The browser cannot silently send an SMS; the user reviews and sends it in the messaging app. Location is requested only after the share action and is not stored by the app.

## Important safety limits

This is a demonstration aid, not a certified driver-monitoring, medical, or emergency-response system. EAR/MAR thresholds are generic and can be affected by camera angle, lighting, face shape, glasses, and movement. The alert may be missed or incorrect. Do not rely on it instead of stopping and resting when tired, and do not interact with it while driving.
