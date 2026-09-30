import { NextResponse } from 'next/server';
import Tesseract from 'tesseract.js';

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get('image') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No image provided', amount: 0 }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // FIX 1: Manually initialize the worker
    // FIX 2: Route the language file download to '/tmp' (Vercel's only writable folder)
    const worker = await Tesseract.createWorker('eng', 1, {
      cachePath: '/tmp',
    });

    // Process the image buffer
    const { data: { text } } = await worker.recognize(buffer);

    // FIX 3: Immediately terminate the worker to prevent server crashes
    await worker.terminate();

    const numberMatches = text.match(/\b\d{1,3}(?:,\d{3})*(?:\.\d{2})?\b|\b\d+\b/g);
    let detectedAmount = 0;

    if (numberMatches) {
      const numericValues = numberMatches.map(str => parseFloat(str.replace(/,/g, '')));
      
      // Plausibility Filter: Drops phone numbers and UTRs over 10 Lakhs
      const plausibleAmounts = numericValues.filter(num => num > 0 && num <= 1000000);

      if (plausibleAmounts.length > 0) {
        detectedAmount = Math.max(...plausibleAmounts);
      }
    }

    return NextResponse.json({ amount: detectedAmount });

  } catch (error: any) {
    console.error("OCR Processing Error:", error.message || error);
    return NextResponse.json({ error: 'Failed to process image', amount: 0 }, { status: 500 });
  }
}