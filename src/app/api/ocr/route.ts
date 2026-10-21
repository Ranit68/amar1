import { NextResponse } from "next/server";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Give the OCR worker room on hosts with a hard function timeout. */
export const maxDuration = 60;

interface ParsedLine {
  raw_name: string;
  qty: number | null;
  unit: string | null;
  unit_price: number | null;
  line_total: number | null;
}

const NUMBER = /\d[\d,]*\.?\d*/g;

/** Reject absurd uploads before decoding them. */
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
/** Longest edge kept for OCR. Tesseract cost grows with pixel count. */
const OCR_MAX_EDGE = 1600;
const OCR_QUALITY = 82;
/** Hard ceiling for the whole OCR step so we return JSON instead of hanging. */
const OCR_TIMEOUT_MS = 45_000;

function parseLines(text: string): ParsedLine[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 2);

  const out: ParsedLine[] = [];
  for (const line of lines) {
    const nums = (line.match(NUMBER) ?? []).map((n) => Number(n.replace(/,/g, "")));
    if (nums.length === 0) continue;
    const namePart = line.replace(NUMBER, "").replace(/\s+/g, " ").trim();
    if (namePart.length < 2) continue;
    out.push({
      raw_name: namePart,
      qty: nums.length >= 2 ? (nums[0] ?? null) : null,
      unit: null,
      unit_price: nums.length >= 2 ? (nums[1] ?? null) : (nums[0] ?? null),
      line_total: nums.length >= 2 ? (nums[nums.length - 1] ?? null) : (nums[0] ?? null),
    });
  }
  return out.slice(0, 50);
}

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ status: "error", message }, { status });
}

/**
 * Authenticates the caller without redirecting. A redirect would answer the
 * upload with an HTML login page, which the client cannot parse.
 */
async function authorize(): Promise<
  { ok: true; businessId: string } | { ok: false; response: NextResponse }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false,
      response: errorResponse("লগইন করা নেই। আবার লগইন করুন। / Not signed in.", 401),
    };
  }

  const { data } = await supabase
    .from("business_members")
    .select("business_id")
    .eq("user_id", user.id)
    .eq("status", "active")
    .limit(1);

  const membership = data?.[0];
  if (!membership) {
    return {
      ok: false,
      response: errorResponse("কোনো ব্যবসার সদস্য পাওয়া যায়নি।", 403),
    };
  }

  return { ok: true, businessId: membership.business_id };
}

/**
 * Downscales the photo to something Tesseract can chew on. A 12MP phone
 * photo takes ~90s to OCR at full resolution but ~2s at 1600px, and full
 * resolution uploads also blow past host request-body limits.
 */
async function prepareImage(file: File): Promise<Buffer> {
  const input = Buffer.from(await file.arrayBuffer());
  try {
    return await sharp(input)
      .rotate() // honour EXIF orientation of phone photos
      .resize({
        width: OCR_MAX_EDGE,
        height: OCR_MAX_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: OCR_QUALITY })
      .toBuffer();
  } catch {
    // sharp understands every format the tesseract core does, so a failure
    // here means the upload is not a readable image at all.
    throw new Error("IMAGE_DECODE_FAILED");
  }
}

type TesseractWorker = {
  recognize: (image: Buffer) => Promise<{ data: { text?: string } }>;
  terminate: () => Promise<unknown>;
};

let workerPromise: Promise<TesseractWorker> | null = null;

/** One long-lived worker: re-creating it per request re-loads the language data. */
async function getWorker(): Promise<TesseractWorker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import("tesseract.js");
      return (await createWorker(["ben", "eng"], undefined, {
        // Keep the traineddata out of the project root.
        cachePath: join(tmpdir(), "tesseract-cache"),
      })) as unknown as TesseractWorker;
    })().catch((err) => {
      workerPromise = null;
      throw err;
    });
  }
  return workerPromise;
}

async function resetWorker(): Promise<void> {
  const current = workerPromise;
  workerPromise = null;
  if (!current) return;
  try {
    await (await current).terminate();
  } catch {
    // Already dead - nothing to clean up.
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`OCR_TIMEOUT after ${ms}ms`)),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export async function POST(request: Request) {
  const auth = await authorize();
  if (!auth.ok) return auth.response;

  const provider = (process.env.OCR_PROVIDER ?? "tesseract").toLowerCase();

  if (provider === "none") {
    return NextResponse.json({
      status: "disabled",
      message: "OCR বন্ধ। ম্যানুয়াল এন্ট্রি ব্যবহার করুন।",
    });
  }

  // Reject oversized bodies before the parser allocates memory for them.
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_UPLOAD_BYTES) {
    return errorResponse(
      `ছবিটি খুব বড় (${(declaredLength / (1024 * 1024)).toFixed(1)} MB)। ছোট করে আবার চেষ্টা করুন।`,
      413,
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return errorResponse(
      "ছবিটি পড়া যায়নি। ফাইলটি বড় হলে ছোট করে আবার চেষ্টা করুন।",
      400,
    );
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return errorResponse("কোনও ছবি পাওয়া যায়নি।", 400);
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return errorResponse(
      `ছবিটি খুব বড় (${Math.round(file.size / (1024 * 1024))} MB)। ছোট করে আবার চেষ্টা করুন।`,
      413,
    );
  }

  if (provider === "http") {
    const endpoint = process.env.OCR_HTTP_ENDPOINT;
    const apiKey = process.env.OCR_HTTP_API_KEY;
    if (!endpoint) {
      return NextResponse.json({
        status: "unconfigured",
        message: "OCR_HTTP_ENDPOINT সেট করা নেই।",
      });
    }
    try {
      const upstream = new FormData();
      upstream.append("file", file);
      const res = await fetch(endpoint, {
        method: "POST",
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
        body: upstream,
      });
      const json = (await res.json()) as Record<string, unknown>;
      const text = typeof json.text === "string" ? json.text : "";
      return NextResponse.json({ status: "ok", provider: "http", text, lines: parseLines(text) });
    } catch (err) {
      return errorResponse(err instanceof Error ? err.message : "OCR ব্যর্থ", 502);
    }
  }

  // tesseract (local, ben + eng)
  try {
    const buffer = await prepareImage(file);
    const worker = await getWorker();
    const { data } = await withTimeout(worker.recognize(buffer), OCR_TIMEOUT_MS);
    const text = data.text ?? "";
    return NextResponse.json({
      status: "ok",
      provider: "tesseract",
      text,
      lines: parseLines(text),
    });
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : typeof err === "string" && err.trim()
          ? err
          : "অজানা ত্রুটি";
    // A dead worker must not poison every later request.
    await resetWorker();
    if (message === "IMAGE_DECODE_FAILED") {
      return errorResponse(
        "ছবিটি পড়া যায়নি। JPG/PNG ফরম্যাটের ছবি দিন।",
        400,
      );
    }
    if (message.startsWith("OCR_TIMEOUT")) {
      return errorResponse(
        "ছবিটি প্রসেস করতে সময় বেশি লাগছে। ছবির আকার ছোট করে আবার চেষ্টা করুন।",
        504,
      );
    }
    return errorResponse(`OCR ব্যর্থ: ${message}`, 500);
  }
}
