import { startTransition, useEffect, useRef, useState } from "react";
import type { AnalysisApiError, AnalysisApiSuccess, CalorieAnalysis } from "../shared/analysis";
import { ANALYSIS_DISCLAIMER } from "../shared/analysis";

type CaptureStage = "idle" | "starting" | "live" | "preview" | "analyzing" | "result";

function App() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [result, setResult] = useState<CalorieAnalysis | null>(null);
  const [stage, setStage] = useState<CaptureStage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState(
    "Open the camera or upload a plate photo to get an estimate.",
  );
  const [cameraSupported, setCameraSupported] = useState(false);
  const [isSecure, setIsSecure] = useState(true);

  useEffect(() => {
    setCameraSupported(Boolean(navigator.mediaDevices?.getUserMedia));
    setIsSecure(window.isSecureContext || window.location.hostname === "localhost");
  }, []);

  useEffect(() => {
    if (!videoRef.current) {
      return;
    }

    if (stream) {
      videoRef.current.srcObject = stream;
      void videoRef.current.play().catch(() => undefined);
      return;
    }

    videoRef.current.srcObject = null;
  }, [stream]);

  useEffect(() => {
    if (!selectedImage) {
      setPreviewUrl(null);
      return;
    }

    const objectUrl = URL.createObjectURL(selectedImage);
    setPreviewUrl(objectUrl);

    return () => URL.revokeObjectURL(objectUrl);
  }, [selectedImage]);

  useEffect(() => {
    return () => stopMediaStream(stream);
  }, [stream]);

  async function requestCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraSupported(false);
      setError("This browser does not expose camera access. Use the upload fallback instead.");
      return;
    }

    setError(null);
    setResult(null);
    setStage("starting");
    setStatusMessage("Requesting the rear camera.");

    try {
      const nextStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1440 },
          height: { ideal: 1080 },
        },
      });

      stopMediaStream(stream);
      setStream(nextStream);
      setStage("live");
      setStatusMessage("Rear camera is live. Frame the plate and capture when ready.");
    } catch (requestError) {
      setStage("idle");
      setError(readableCameraError(requestError));
      setStatusMessage("Camera unavailable. You can still upload a photo instead.");
    }
  }

  async function capturePhoto() {
    if (!videoRef.current) {
      return;
    }

    setError(null);

    try {
      const frameBlob = await captureVideoFrame(videoRef.current);
      const compressed = await compressImageFile(frameBlob, "plate-capture.jpg");
      stopMediaStream(stream);
      setStream(null);
      setSelectedImage(compressed);
      setStage("preview");
      setStatusMessage("Photo captured. Analyze it now or retake for a better angle.");
    } catch (captureError) {
      setError(
        captureError instanceof Error
          ? captureError.message
          : "Unable to capture a usable frame from the camera.",
      );
    }
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    setError(null);
    setResult(null);
    setStatusMessage("Preparing the uploaded image.");

    try {
      const compressed = await compressImageFile(file, file.name || "uploaded-plate.jpg");
      stopMediaStream(stream);
      setStream(null);
      setSelectedImage(compressed);
      setStage("preview");
      setStatusMessage("Upload ready. Analyze it now or choose another image.");
    } catch (fileError) {
      setError(fileError instanceof Error ? fileError.message : "Unable to prepare that image.");
      setStage("idle");
    }
  }

  async function analyzeImage() {
    if (!selectedImage) {
      return;
    }

    setError(null);
    setStage("analyzing");
    setStatusMessage("Estimating calories from your photo.");

    const formData = new FormData();
    formData.set("image", selectedImage, selectedImage.name);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        body: formData,
      });

      const payload = (await response.json()) as AnalysisApiSuccess | AnalysisApiError;

      if (!response.ok || !("data" in payload)) {
        throw new Error("error" in payload ? payload.error : "The image could not be analyzed.");
      }

      startTransition(() => {
        setResult(payload.data);
        setStage("result");
      });

      setStatusMessage("Estimate ready. Review the likely items and calorie total.");
    } catch (requestError) {
      setStage("preview");
      setError(
        requestError instanceof Error
          ? requestError.message
          : "The analysis service could not process that photo.",
      );
      setStatusMessage("Try again with a sharper, brighter photo of one plate.");
    }
  }

  function retake() {
    setError(null);
    setResult(null);
    setSelectedImage(null);
    setStage("idle");
    setStatusMessage("Ready for another photo.");
  }

  function resetSession() {
    stopMediaStream(stream);
    setStream(null);
    setSelectedImage(null);
    setResult(null);
    setError(null);
    setStage("idle");
    setStatusMessage("Open the camera or upload a plate photo to get an estimate.");
  }

  const showLivePreview = stage === "live" || stage === "starting";
  const showImagePreview = Boolean(previewUrl) && !showLivePreview;
  const isBusy = stage === "starting" || stage === "analyzing";

  return (
    <div className="app-shell">
      <div className="backdrop" />
      <header className="hero">
        <p className="eyebrow">Food Calorie Camera</p>
        <h1>Use your private mobile camera to estimate calories from a single plate.</h1>
        <p className="lede">
          Snap a meal, send one compressed image for analysis, and get a quick estimate with a
          confidence signal. Nothing is stored after the request.
        </p>
      </header>

      <main className="layout">
        <section className="panel capture-panel">
          <div className="panel-header">
            <div>
              <p className="panel-label">Capture</p>
              <h2>Photo flow</h2>
            </div>
            <span className={`status-pill status-pill--${stage}`}>{stageLabel(stage)}</span>
          </div>

          <div className="preview-stage">
            {showLivePreview ? (
              <video ref={videoRef} autoPlay muted playsInline className="preview-media" />
            ) : showImagePreview ? (
              <img src={previewUrl ?? undefined} alt="Selected plate preview" className="preview-media" />
            ) : (
              <div className="empty-state">
                <p className="empty-kicker">Mobile-first capture</p>
                <h3>Point the back camera at one plate or bowl of food.</h3>
                <p>
                  For the best estimate, center the plate, keep the image bright, and avoid crowded
                  tables with multiple meals in frame.
                </p>
              </div>
            )}

            {stage === "analyzing" ? (
              <div className="overlay">
                <div className="spinner" />
                <p>Analyzing the photo with Workers AI</p>
              </div>
            ) : null}
          </div>

          <div className="button-row">
            <button className="button button--primary" type="button" onClick={requestCamera} disabled={isBusy || !isSecure || !cameraSupported}>
              {stage === "live" ? "Restart Camera" : "Open Camera"}
            </button>
            <button className="button button--secondary" type="button" onClick={() => fileInputRef.current?.click()} disabled={isBusy}>
              Upload Photo
            </button>
            <button className="button button--ghost" type="button" onClick={capturePhoto} disabled={stage !== "live"}>
              Capture
            </button>
            <button className="button button--ghost" type="button" onClick={analyzeImage} disabled={!selectedImage || isBusy}>
              Analyze
            </button>
            <button className="button button--ghost" type="button" onClick={retake} disabled={isBusy || (!selectedImage && stage !== "result")}>
              Retake
            </button>
          </div>

          <input
            ref={fileInputRef}
            className="visually-hidden"
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleFileChange}
          />

          <p className="support-copy">{statusMessage}</p>
          {error ? <p className="error-banner">{error}</p> : null}
          {!isSecure ? (
            <p className="notice">Camera access requires HTTPS or localhost. Upload still works everywhere.</p>
          ) : null}
          {!cameraSupported ? (
            <p className="notice">Camera APIs are not available on this browser, so the upload fallback is enabled.</p>
          ) : null}
        </section>

        <section className="stack">
          <article className="panel summary-panel">
            <div className="panel-header">
              <div>
                <p className="panel-label">Result</p>
                <h2>Calorie estimate</h2>
              </div>
              {result ? (
                <span className={`confidence-chip confidence-chip--${result.confidence}`}>
                  {confidenceLabel(result.confidence)}
                </span>
              ) : null}
            </div>

            {result ? (
              <>
                <div className="calorie-total">
                  <span>Total estimate</span>
                  <strong>{result.totalCalories} kcal</strong>
                </div>
                <ul className="food-list">
                  {result.items.map((item) => (
                    <li key={`${item.name}-${item.estimatedCalories}`} className="food-row">
                      <span>{item.name}</span>
                      <strong>{item.estimatedCalories} kcal</strong>
                    </li>
                  ))}
                </ul>
                <p className="summary-copy">{result.summary}</p>
                <p className="disclaimer">{result.disclaimer}</p>
                <button className="button button--primary button--full" type="button" onClick={resetSession}>
                  Start Another Estimate
                </button>
              </>
            ) : (
              <>
                <div className="result-placeholder">
                  <strong>No result yet</strong>
                  <p>
                    Your estimate will appear here after we analyze a single plate photo. The app
                    returns likely food items, a calorie total, and a confidence level.
                  </p>
                </div>
                <p className="disclaimer">{ANALYSIS_DISCLAIMER}</p>
              </>
            )}
          </article>

          <article className="panel details-panel">
            <div className="panel-header">
              <div>
                <p className="panel-label">Guide</p>
                <h2>How this MVP behaves</h2>
              </div>
            </div>

            <div className="step-grid">
              <div className="step-card">
                <span>1</span>
                <p>Request the rear camera on mobile or upload an existing plate photo.</p>
              </div>
              <div className="step-card">
                <span>2</span>
                <p>Compress the image in-browser before sending it to the Cloudflare function.</p>
              </div>
              <div className="step-card">
                <span>3</span>
                <p>Use Workers AI to identify visible foods and estimate calories conservatively.</p>
              </div>
              <div className="step-card">
                <span>4</span>
                <p>Return a stateless result only. The photo is not stored after the request.</p>
              </div>
            </div>
          </article>
        </section>
      </main>
    </div>
  );
}

export default App;

function stopMediaStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

function stageLabel(stage: CaptureStage) {
  switch (stage) {
    case "starting":
      return "Opening";
    case "live":
      return "Camera live";
    case "preview":
      return "Preview ready";
    case "analyzing":
      return "Analyzing";
    case "result":
      return "Complete";
    default:
      return "Waiting";
  }
}

function confidenceLabel(confidence: CalorieAnalysis["confidence"]) {
  switch (confidence) {
    case "high":
      return "High confidence";
    case "low":
      return "Low confidence";
    default:
      return "Medium confidence";
  }
}

function readableCameraError(error: unknown) {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError") {
      return "Camera permission was denied. You can allow access and try again, or use upload.";
    }

    if (error.name === "NotFoundError") {
      return "No camera was found on this device.";
    }

    if (error.name === "NotReadableError") {
      return "The camera is already in use by another app.";
    }
  }

  return "The camera could not be opened on this device. Use upload as a fallback.";
}

async function captureVideoFrame(video: HTMLVideoElement) {
  const width = video.videoWidth || 1280;
  const height = video.videoHeight || 720;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("The browser could not prepare a capture canvas.");
  }

  context.drawImage(video, 0, 0, width, height);
  return canvasToBlob(canvas, "image/jpeg", 0.92);
}

async function compressImageFile(source: Blob, filename: string) {
  const image = await loadImage(source);
  const [width, height] = fitWithin(image.naturalWidth, image.naturalHeight, 1600);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("The browser could not prepare the photo for upload.");
  }

  context.drawImage(image, 0, 0, width, height);

  const compressedBlob = await canvasToBlob(canvas, "image/jpeg", 0.84);
  const normalizedName = filename.toLowerCase().endsWith(".jpg") || filename.toLowerCase().endsWith(".jpeg")
    ? filename.replace(/\.[^.]+$/, ".jpg")
    : `${filename.replace(/\.[^.]+$/, "")}.jpg`;

  return new File([compressedBlob], normalizedName, { type: "image/jpeg" });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("The browser could not export the image."));
        return;
      }

      resolve(blob);
    }, type, quality);
  });
}

function fitWithin(width: number, height: number, maxSide: number) {
  if (width <= maxSide && height <= maxSide) {
    return [width, height] as const;
  }

  const scale = maxSide / Math.max(width, height);
  return [Math.round(width * scale), Math.round(height * scale)] as const;
}

function loadImage(blob: Blob) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(blob);

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("This file could not be read as an image."));
    };

    image.src = objectUrl;
  });
}
