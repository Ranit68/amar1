import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ParsedLine {
  raw_name: string;
  qty: number | null;
  unit: string | null;
  unit_price: number | null;
  line_total: number | null;
}

const NUMBER = /\d[\d,]*\.?\d*/g;

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

export async function POST(request: Request) {
  // Ensure the caller is authenticated and a member of at least one business.
  await requireSession();

  const provider = (process.env.OCR_PROVIDER ?? "tesseract").toLowerCase();

  if (provider === "none") {
    return NextResponse.json({
      status: "disabled",
      message: "OCR বন্ধ। ম্যানুয়াল এন্ট্রি ব্যবহার করুন।",
    });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ status: "error", message: "কোনও ছবি পাওয়া যায়নি।" }, {
      status: 400,
    });
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
      return NextResponse.json({
        status: "error",
        message: err instanceof Error ? err.message : "OCR ব্যর্থ",
      });
    }
  }

  // tesseract (local, ben + eng)
  try {
    const { createWorker } = await import("tesseract.js");
    const buffer = Buffer.from(await file.arrayBuffer());
    const worker = await createWorker(["ben", "eng"]);
    try {
      const { data } = await worker.recognize(buffer);
      const text = data.text ?? "";
      return NextResponse.json({
        status: "ok",
        provider: "tesseract",
        text,
        lines: parseLines(text),
      });
    } finally {
      await worker.terminate();
    }
  } catch (err) {
    return NextResponse.json({
      status: "error",
      message:
        err instanceof Error
          ? err.message
          : "Tesseract OCR চালু করা যায়নি (worker সেটআপ ব্যর্থ)।",
    });
  }
}
