import { FaceLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

const elements = {
  video: document.querySelector("#camera-video"),
  canvas: document.querySelector("#overlay-canvas"),
  frame: document.querySelector("#camera-frame"),
  placeholder: document.querySelector("#camera-placeholder"),
  faceTag: document.querySelector("#face-tag"),
  cameraState: document.querySelector("#camera-state"),
  sessionBadge: document.querySelector(".session-badge"),
  sessionLabel: document.querySelector("#session-label"),
  viewTag: document.querySelector("#view-tag"),
  modelStatus: document.querySelector("#model-status"),
  startButton: document.querySelector("#start-button"),
  stopButton: document.querySelector("#stop-button"),
  cameraError: document.querySelector("#camera-error"),
  alertPill: document.querySelector("#alert-pill"),
  alertLabel: document.querySelector("#alert-label"),
  alertIcon: document.querySelector("#alert-icon"),
  alertTitle: document.querySelector("#alert-title"),
  alertDescription: document.querySelector("#alert-description"),
  earValue: document.querySelector("#ear-value"),
  marValue: document.querySelector("#mar-value"),
  earBar: document.querySelector("#ear-bar"),
  marBar: document.querySelector("#mar-bar"),
  sensitivityLabel: document.querySelector("#sensitivity-label"),
  contactNumber: document.querySelector("#contact-number"),
  locationState: document.querySelector("#location-state"),
  shareButton: document.querySelector("#share-button"),
  overlay: document.querySelector("#alert-overlay"),
  overlayMessage: document.querySelector("#overlay-message"),
  overlayShareButton: document.querySelector("#overlay-share-button"),
  dismissButton: document.querySelector("#dismiss-alert-button")
};

const sensitivitySettings = {
  relaxed: { label: "Relaxed", eyeDuration: 2.2, yawnDuration: 1.8 },
  balanced: { label: "Balanced", eyeDuration: 1.5, yawnDuration: 1.2 },
  sensitive: { label: "Sensitive", eyeDuration: 1.0, yawnDuration: 0.8 }
};
const eyeIndices = [[33, 160, 158, 133, 153, 144], [362, 385, 387, 263, 373, 380]];
const eyeOutline = [[33, 160, 158, 133, 153, 144], [362, 385, 387, 263, 373, 380]];
let sensitivity = "balanced";
let faceLandmarker;
let stream;
let animationFrame;
let audioContext;
let alarmTimer;
let alertDismissed = false;
let lastAlertTime = 0;
let eyeClosedSince = null;
let yawnSince = null;
let lastVideoTime = -1;

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function calculateEyeRatio(points, indices) {
  const [outer, upperA, upperB, inner, lowerB, lowerA] = indices.map(index => points[index]);
  return (distance(upperA, lowerA) + distance(upperB, lowerB)) / (2 * distance(outer, inner));
}

function calculateMouthRatio(points) {
  return (distance(points[13], points[14]) + distance(points[82], points[87])) /
    (2 * distance(points[78], points[308]));
}

function setMetric(bar, value, highIsConcerning) {
  const normalized = Math.max(0, Math.min(100, value * 100));
  bar.style.width = `${normalized}%`;
  bar.classList.toggle("warning", highIsConcerning && value >= 0.48);
  bar.classList.toggle("danger", highIsConcerning && value >= 0.65);
}

function setAlertState(kind, title, description) {
  const config = {
    idle: { pill: "status-idle", icon: "", label: "Standby" },
    ok: { pill: "status-ok", icon: "", label: "Alert" },
    warning: { pill: "status-warning", icon: "warning", label: "Watch" },
    danger: { pill: "status-danger", icon: "danger", label: "Drowsy" }
  }[kind];
  elements.alertPill.className = `status-pill ${config.pill}`;
  elements.alertLabel.textContent = config.label;
  elements.alertIcon.className = `alert-icon ${config.icon}`;
  elements.alertTitle.textContent = title;
  elements.alertDescription.textContent = description;
}

function drawLandmarks(points, width, height) {
  const canvas = elements.canvas;
  const context = canvas.getContext("2d");
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  context.clearRect(0, 0, width, height);
  context.strokeStyle = "#c5f36a";
  context.lineWidth = Math.max(1, width / 420);
  context.shadowColor = "#c5f36a";
  context.shadowBlur = 8;
  for (const indices of eyeOutline) {
    context.beginPath();
    indices.forEach((index, position) => {
      const point = points[index];
      const x = point.x * width;
      const y = point.y * height;
      if (position === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.closePath();
    context.stroke();
  }
  context.beginPath();
  context.ellipse(points[13].x * width, points[13].y * height, width * 0.027, height * 0.018, 0, 0, Math.PI * 2);
  context.stroke();
  context.shadowBlur = 0;
}

function clearMetrics() {
  elements.earValue.textContent = "—";
  elements.marValue.textContent = "—";
  elements.earBar.style.width = "0%";
  elements.marBar.style.width = "0%";
  elements.earBar.className = "";
  elements.marBar.className = "";
  elements.faceTag.classList.remove("visible");
  elements.canvas.getContext("2d").clearRect(0, 0, elements.canvas.width, elements.canvas.height);
}

function triggerDrowsiness(reason) {
  const now = performance.now();
  if (now - lastAlertTime < 8000) return;
  lastAlertTime = now;
  alertDismissed = false;
  setAlertState("danger", reason, "A sign of fatigue was detected. When safe, pull over and rest.");
  elements.overlayMessage.textContent = reason === "Prolonged eye closure detected"
    ? "Your eyes appear to have been closed for a prolonged period. When safe, pull over and rest."
    : "A prolonged yawn was detected. When safe, pull over and rest.";
  elements.overlay.hidden = false;
  startAlarm();
}

function startAlarm() {
  stopAlarm();
  try {
    audioContext = audioContext || new AudioContext();
    if (audioContext.state === "suspended") audioContext.resume();
    const playTone = () => {
      if (!audioContext || audioContext.state === "closed") return;
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = "square";
      oscillator.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.12, audioContext.currentTime + 0.025);
      gain.gain.setValueAtTime(0.12, audioContext.currentTime + 0.22);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.25);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start();
      oscillator.stop(audioContext.currentTime + 0.26);
    };
    playTone();
    alarmTimer = window.setInterval(playTone, 720);
  } catch (error) {
    console.error("Could not start the alert sound:", error);
    elements.cameraError.hidden = false;
    elements.cameraError.textContent = "The warning sound could not start. Check this browser's audio settings.";
  }
}

function stopAlarm() {
  if (alarmTimer) window.clearInterval(alarmTimer);
  alarmTimer = null;
}

function processLandmarks(points, now) {
  const leftEye = calculateEyeRatio(points, eyeIndices[0]);
  const rightEye = calculateEyeRatio(points, eyeIndices[1]);
  const ear = (leftEye + rightEye) / 2;
  const mar = calculateMouthRatio(points);
  const settings = sensitivitySettings[sensitivity];
  const eyeThreshold = 0.21;
  const yawnThreshold = 0.58;

  elements.earValue.textContent = ear.toFixed(2);
  elements.marValue.textContent = mar.toFixed(2);
  setMetric(elements.earBar, Math.max(0, Math.min(1, (0.34 - ear) / 0.25)), true);
  setMetric(elements.marBar, Math.max(0, Math.min(1, mar / 1.1)), true);
  elements.faceTag.classList.add("visible");
  drawLandmarks(points, elements.video.videoWidth, elements.video.videoHeight);

  if (ear < eyeThreshold) {
    eyeClosedSince ??= now;
  } else {
    eyeClosedSince = null;
  }
  if (mar > yawnThreshold) {
    yawnSince ??= now;
  } else {
    yawnSince = null;
  }

  const eyeDuration = eyeClosedSince === null ? 0 : (now - eyeClosedSince) / 1000;
  const yawnDuration = yawnSince === null ? 0 : (now - yawnSince) / 1000;
  if (eyeDuration >= settings.eyeDuration) {
    triggerDrowsiness("Prolonged eye closure detected");
  } else if (yawnDuration >= settings.yawnDuration) {
    triggerDrowsiness("Prolonged yawn detected");
  } else if (eyeDuration > 0.5 || yawnDuration > 0.45) {
    setAlertState("warning", "Fatigue sign noticed", "Monitoring eye closure and mouth movement.");
  } else if (elements.overlay.hidden && !alertDismissed) {
    setAlertState("ok", "Looking alert", "Your eyes and mouth are being monitored on this device.");
  }
}

function detectFrame() {
  if (!faceLandmarker || !stream || elements.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
  if (elements.video.currentTime !== lastVideoTime) {
    lastVideoTime = elements.video.currentTime;
    const result = faceLandmarker.detectForVideo(elements.video, performance.now());
    const points = result.faceLandmarks[0];
    if (points) {
      processLandmarks(points, performance.now());
    } else {
      clearMetrics();
      eyeClosedSince = null;
      yawnSince = null;
      if (elements.overlay.hidden) setAlertState("warning", "Face not in view", "Move into the camera frame for accurate monitoring.");
    }
  }
  animationFrame = requestAnimationFrame(detectFrame);
}

function setModelStatus(message, state = "") {
  elements.modelStatus.innerHTML = `<span class="status-dot ${state}"></span><span></span>`;
  elements.modelStatus.lastElementChild.textContent = message;
}

function stopSession() {
  if (animationFrame) cancelAnimationFrame(animationFrame);
  animationFrame = null;
  if (stream) stream.getTracks().forEach(track => track.stop());
  stream = null;
  elements.video.srcObject = null;
  elements.frame.classList.remove("is-live");
  elements.cameraState.classList.remove("on");
  elements.cameraState.innerHTML = "<span></span> Camera off";
  elements.startButton.hidden = false;
  elements.startButton.disabled = false;
  elements.stopButton.hidden = true;
  elements.sessionBadge.classList.remove("active");
  elements.sessionLabel.textContent = "SESSION INACTIVE";
  elements.viewTag.textContent = "AWAITING START";
  elements.overlay.hidden = true;
  stopAlarm();
  clearMetrics();
  eyeClosedSince = null;
  yawnSince = null;
  lastVideoTime = -1;
  alertDismissed = false;
  setAlertState("idle", "Ready when you are", "Start a session to begin checking for signs of fatigue.");
  setModelStatus(faceLandmarker ? "Detector ready when session starts" : "Monitoring stopped");
}

async function startSession() {
  elements.cameraError.hidden = true;
  elements.startButton.disabled = true;
  elements.startButton.textContent = "Preparing camera…";
  setModelStatus("Requesting camera and loading face detector", "loading");
  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Camera access requires a secure context (HTTPS or localhost) and a supported browser.");
    }
    if (!faceLandmarker) {
      const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm");
      faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
          delegate: "GPU"
        },
        runningMode: "VIDEO",
        numFaces: 1,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: false
      });
    }
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }
    });
    elements.video.srcObject = stream;
    await new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error("Camera stream did not start. Check that the camera is available, then try again.")), 10000);
      elements.video.play().then(() => {
        window.clearTimeout(timeout);
        resolve();
      }, error => {
        window.clearTimeout(timeout);
        reject(error);
      });
    });
    elements.frame.classList.add("is-live");
    elements.cameraState.classList.add("on");
    elements.cameraState.innerHTML = "<span></span> Camera active";
    elements.startButton.hidden = true;
    elements.stopButton.hidden = false;
    elements.sessionBadge.classList.add("active");
    elements.sessionLabel.textContent = "SESSION ACTIVE";
    elements.viewTag.textContent = "LIVE MONITORING";
    setModelStatus("Face detector active on this device");
    setAlertState("warning", "Looking for your face", "Position your face within the camera frame.");
    detectFrame();
  } catch (error) {
    console.error("Could not start monitoring:", error);
    if (stream) stream.getTracks().forEach(track => track.stop());
    stream = null;
    elements.video.srcObject = null;
    elements.startButton.disabled = false;
    elements.startButton.innerHTML = '<span class="button-symbol">▶</span> Start monitoring';
    setModelStatus("Could not initialize monitoring", "error");
    elements.cameraError.hidden = false;
    elements.cameraError.textContent = error.name === "NotAllowedError"
      ? "Camera access was denied. Allow camera permission in your browser settings, then try again."
      : error.message || "Camera or face detector could not start. Check your connection and try again.";
    setAlertState("idle", "Camera unavailable", "Allow camera access to begin a monitoring session.");
  } finally {
    if (!stream) elements.startButton.innerHTML = '<span class="button-symbol">▶</span> Start monitoring';
  }
}

function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Location is not supported by this browser."));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 12000,
      maximumAge: 30000
    });
  });
}

function makeSmsUrl(number, message) {
  const separator = /iPad|iPhone|iPod/.test(navigator.userAgent) ? "&" : "?";
  return `sms:${encodeURIComponent(number)}${separator}body=${encodeURIComponent(message)}`;
}

async function shareLocation(button = elements.shareButton) {
  const number = elements.contactNumber.value.trim();
  if (!number) {
    elements.contactNumber.focus();
    elements.contactNumber.setCustomValidity("Enter the trusted contact's phone number first.");
    elements.contactNumber.reportValidity();
    elements.contactNumber.addEventListener("input", () => elements.contactNumber.setCustomValidity(""), { once: true });
    return;
  }
  button.disabled = true;
  const originalText = button.textContent;
  button.textContent = "Getting location…";
  elements.locationState.innerHTML = '<span class="location-dot"></span> Getting location';
  try {
    const position = await getCurrentPosition();
    const { latitude, longitude } = position.coords;
    const mapUrl = `https://maps.google.com/?q=${latitude.toFixed(6)},${longitude.toFixed(6)}`;
    const message = `WakeGuard check-in: I may need help. My current location: ${mapUrl}`;
    elements.locationState.innerHTML = '<span class="location-dot shared"></span> Location ready to share';
    const smsUrl = makeSmsUrl(number, message);
    window.location.href = smsUrl;
  } catch (error) {
    console.error("Could not share location:", error);
    const reason = error.code === 1 ? "Location permission denied" :
      error.code === 3 ? "Location request timed out" : error.message || "Unable to get location";
    elements.locationState.innerHTML = '<span class="location-dot"></span> Location unavailable';
    elements.cameraError.hidden = false;
    elements.cameraError.textContent = `${reason}. Allow location access and try again.`;
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

elements.startButton.addEventListener("click", startSession);
elements.stopButton.addEventListener("click", stopSession);
elements.shareButton.addEventListener("click", () => shareLocation());
elements.overlayShareButton.addEventListener("click", () => shareLocation(elements.overlayShareButton));
elements.dismissButton.addEventListener("click", () => {
  elements.overlay.hidden = true;
  alertDismissed = true;
  stopAlarm();
  setAlertState("warning", "Alert dismissed", "Please stop somewhere safe and rest if you feel tired.");
});
document.querySelectorAll(".sensitivity-option").forEach(button => {
  button.addEventListener("click", () => {
    sensitivity = button.dataset.sensitivity;
    document.querySelectorAll(".sensitivity-option").forEach(option => {
      option.classList.toggle("selected", option === button);
    });
    elements.sensitivityLabel.textContent = sensitivitySettings[sensitivity].label;
  });
});

window.addEventListener("pagehide", () => {
  stopAlarm();
  if (stream) stream.getTracks().forEach(track => track.stop());
});
