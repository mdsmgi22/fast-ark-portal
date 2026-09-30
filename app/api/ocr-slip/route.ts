import { NextResponse } from 'next/server';
import Tesseract from 'tesseract.js';

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get('image') as File | null;

    // Safety Net: Always return amount: 0 so the React frontend doesn't crash
    if (!file) {
      return NextResponse.json({ error: 'No image provided', amount: 0 }, { status: 400 });
    }

    // Convert the uploaded Next.js File object into a Buffer
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Process image purely on the server (English language)
    const { data: { text } } = await Tesseract.recognize(buffer, 'eng');

    // Log raw text to your Vercel console so you can debug blurry slips
    console.log("OCR Extracted Text:\n", text);

    // Regex to extract valid currency numbers (e.g., 500, 1,000.50, 400.00)
    // Looks for numbers with commas and exactly 2 decimal places, or whole numbers
    const numberMatches = text.match(/\b\d{1,3}(?:,\d{3})*(?:\.\d{2})?\b|\b\d+\b/g);

    let detectedAmount = 0;

    if (numberMatches) {
      // Convert text matches to actual numbers
      const numericValues = numberMatches.map(str => parseFloat(str.replace(/,/g, '')));
      
      // Plausibility Filter: Drop phone numbers, UTRs, and Account Numbers
      // Assumes no single center deposit exceeds 10 Lakhs (1,000,000)
      const plausibleAmounts = numericValues.filter(num => num > 0 && num <= 1000000);

      // Heuristic: The deposit amount is usually the largest plausible number on the slip
      if (plausibleAmounts.length > 0) {
        detectedAmount = Math.max(...plausibleAmounts);
      }
    }

    // Return the amount back to your React frontend
    return NextResponse.json({ amount: detectedAmount });

  } catch (error: any) {
    console.error("OCR Processing Error:", error.message || error);
    // Safety Net: Fallback for server crashes guarantees the frontend gets a number
    return NextResponse.json({ error: 'Failed to process image', amount: 0 }, { status: 500 });
  }
}