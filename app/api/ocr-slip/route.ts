import { NextResponse } from 'next/server';
import Tesseract from 'tesseract.js';

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('image') as File;
    
    if (!file) return NextResponse.json({ error: 'No image provided' }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    
    // Process image purely on the server
    const { data: { text } } = await Tesseract.recognize(buffer, 'eng');
    
    // Extract largest currency value
    const matches = text.match(/\b\d+(?:,\d{3})*(?:\.\d{2})?\b/g);
    let detectedAmount = 0;
    
    if (matches) {
      const numbers = matches.map(m => parseFloat(m.replace(/,/g, '')));
      detectedAmount = Math.max(...numbers);
    }

    return NextResponse.json({ amount: detectedAmount });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}