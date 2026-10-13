"use client";

import { useEffect, useRef, useState } from "react";
import { ScanLine, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/card";

interface DetectedBarcode {
  rawValue: string;
}

interface BarcodeDetectorInstance {
  detect: (source: HTMLVideoElement) => Promise<DetectedBarcode[]>;
}

type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorInstance;

const FORMATS = [
  "ean_13",
  "ean_8",
  "upc_a",
  "upc_e",
  "code_128",
  "code_39",
  "code_93",
  "codabar",
  "itf",
  "qr_code",
];

function getDetectorCtor(): BarcodeDetectorCtor | null {
  if (typeof window === "undefined") return null;
  const ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor })
    .BarcodeDetector;
  return ctor ?? null;
}

/**
 * Camera barcode scanner. Uses the native BarcodeDetector API when available
 * (Chrome/Edge/Android). Always also accepts manual entry, so a USB/Bluetooth
 * keyboard-wedge scanner or hand-typed code keeps working everywhere.
 */
export function BarcodeScanner({
  onDetected,
  label = "স্ক্যান",
}: {
  onDetected: (code: string) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const onDetectedRef = useRef(onDetected);

  useEffect(() => {
    onDetectedRef.current = onDetected;
  }, [onDetected]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let raf = 0;
    let activeStream: MediaStream | null = null;
    const detectorCtor = getDetectorCtor();

    async function startStream() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        activeStream = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => undefined);
        }
        if (!detectorCtor) {
          setError(
            "এই ব্রাউজারে ক্যামেরা স্ক্যান সমর্থিত নয়। কোডটি হাতে লিখুন বা কম্পিউটার স্ক্যানার ব্যবহার করুন।",
          );
          return;
        }
        const detector = new detectorCtor({ formats: FORMATS });
        const tick = async () => {
          const el = videoRef.current;
          if (cancelled || !el) return;
          try {
            const codes = await detector.detect(el);
            const value = codes[0]?.rawValue;
            if (value) {
              onDetectedRef.current(value);
              setOpen(false);
              return;
            }
          } catch {
            // ignore transient frame errors
          }
          raf = requestAnimationFrame(() => void tick());
        };
        raf = requestAnimationFrame(() => void tick());
      } catch {
        setError("ক্যামেরা চালু করা যায়নি। কোডটি হাতে লিখুন।");
      }
    }

    void startStream();

    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      activeStream?.getTracks().forEach((t) => t.stop());
    };
  }, [open]);

  if (!open) {
    return (
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <ScanLine className="h-4 w-4" />
        {label}
      </Button>
    );
  }

  function submitManual() {
    const code = manual.trim();
    if (!code) return;
    onDetectedRef.current(code);
    setOpen(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md space-y-4 rounded-xl bg-white p-4 shadow-xl">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-ink-900">বারকোড স্ক্যান</h3>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-lg p-1 text-ink-500 hover:bg-ink-100"
            aria-label="বন্ধ করুন"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black">
          <video
            ref={videoRef}
            className="h-full w-full object-cover"
            muted
            playsInline
          />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-24 w-4/5 rounded-md border-2 border-white/80" />
          </div>
        </div>

        {error ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">{error}</p>
        ) : (
          <p className="text-xs text-ink-400">
            বারকোডটি ফ্রেমের মধ্যে ধরুন। শনাক্ত হলে স্বয়ংক্রিয়ভাবে বসে যাবে।
          </p>
        )}

        <div className="space-y-2">
          <Field label="হাতে লিখুন / Manual entry" htmlFor="barcode_manual">
            <Input
              id="barcode_manual"
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              placeholder="বারকোড নম্বর"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submitManual();
                }
              }}
            />
          </Field>
          <Button type="button" onClick={submitManual} disabled={!manual.trim()}>
            ব্যবহার করুন
          </Button>
        </div>
      </div>
    </div>
  );
}
