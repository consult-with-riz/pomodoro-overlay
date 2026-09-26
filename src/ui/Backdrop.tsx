"use client";

/**
 * Preview the overlay over the user's own footage.
 *
 * Deliberately a frame grabber, not a video player. Nothing is uploaded — the
 * file is read straight off disk with an object URL — but decoding and playing
 * 4K behind a live canvas would cost real GPU and battery for no benefit. You
 * do not need playback to check placement, you need one representative still.
 *
 * So: pick a file, scrub to a moment, capture that frame, and the video is
 * released. What is left is a single downscaled bitmap of a few megabytes.
 */
import { useCallback, useEffect, useRef, useState } from "react";

/** Captured frames are scaled to this width; the preview is never larger. */
const CAPTURE_WIDTH = 1280;

interface Props {
  /** A data URL for the confirmed still, or null. */
  value: string | null;
  onChange: (dataUrl: string | null) => void;
}

export default function Backdrop({ value, onChange }: Props) {
  const [pending, setPending] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // An object URL holds the file open, so it is always revoked.
  const releasePending = useCallback(() => {
    setPending((url) => {
      if (url) URL.revokeObjectURL(url);
      return null;
    });
    setDuration(0);
    setTime(0);
  }, []);

  useEffect(() => releasePending, [releasePending]);

  const onPick = useCallback(
    (file: File | undefined) => {
      if (!file) return;
      setError(null);
      releasePending();

      if (file.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onload = () => onChange(String(reader.result));
        reader.onerror = () => setError("That image couldn't be read.");
        reader.readAsDataURL(file);
        return;
      }

      if (file.type.startsWith("video/")) {
        setPending(URL.createObjectURL(file));
        return;
      }

      setError("Pick a video or an image.");
    },
    [onChange, releasePending]
  );

  const capture = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;

    const scale = Math.min(1, CAPTURE_WIDTH / video.videoWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // JPEG, because this is a photographic still and it is never exported.
    onChange(canvas.toDataURL("image/jpeg", 0.82));
    releasePending();
  }, [onChange, releasePending]);

  return (
    <div className="backdrop-pick">
      {pending ? (
        <>
          <video
            ref={videoRef}
            src={pending}
            className="backdrop-pick__video"
            muted
            playsInline
            preload="metadata"
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              setDuration(v.duration || 0);
              // A frame a little way in is more representative than black.
              v.currentTime = Math.min(v.duration || 0, 1);
            }}
            onSeeked={(e) => setTime(e.currentTarget.currentTime)}
            onError={() => {
              setError("This browser can't decode that video. Try a screenshot instead.");
              releasePending();
            }}
          />
          <label className="field">
            <span>Pick a moment</span>
            <input
              className="slider"
              type="range"
              min={0}
              max={Math.max(0.1, duration)}
              step={0.1}
              value={time}
              onChange={(e) => {
                const v = Number(e.target.value);
                setTime(v);
                if (videoRef.current) videoRef.current.currentTime = v;
              }}
            />
          </label>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn primary" type="button" onClick={capture}>
              Use this frame
            </button>
            <button className="btn" type="button" onClick={releasePending}>
              Cancel
            </button>
          </div>
          <p className="hint">
            The clip is read from your disk and never uploaded. Once you pick a
            frame the file is released and only that still is kept.
          </p>
        </>
      ) : (
        <>
          <label className="field">
            <span>{value ? "Replace the still" : "Drop in a clip or a screenshot"}</span>
            <input
              type="file"
              accept="video/*,image/*"
              onChange={(e) => {
                onPick(e.target.files?.[0]);
                // Allow picking the same file twice in a row.
                e.target.value = "";
              }}
            />
          </label>
          {value && (
            <button
              className="btn"
              type="button"
              style={{ marginTop: 10 }}
              onClick={() => onChange(null)}
            >
              Remove
            </button>
          )}
          <p className="hint">
            {value
              ? "The preview shows the overlay as it will composite once the background is keyed out."
              : "See the timer over your own footage before you render. One frame is captured; nothing is uploaded and nothing is added to the exported video."}
          </p>
        </>
      )}
      {error && (
        <div className="warn" role="status">
          {error}
        </div>
      )}
    </div>
  );
}
