// FILE PATH: ./app/lib/ocrEngine.ts
import Tesseract from "tesseract.js";

const preprocessReceiptImage = (file: File): Promise<Blob | File> => {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        const scale = img.width < 1100 ? 2 : 1;
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        const ctx = canvas.getContext("2d");

        if (!ctx) {
          URL.revokeObjectURL(url);
          return resolve(file);
        }

        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const d = imgData.data;

        let totalLum = 0;
        const pixelCount = d.length / 4;
        for (let i = 0; i < d.length; i += 4) {
          totalLum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        }
        const isDarkTheme = totalLum / pixelCount < 115;

        for (let i = 0; i < d.length; i += 4) {
          let gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          if (isDarkTheme) gray = 255 - gray;
          const contrast = 1.45;
          gray = Math.min(255, Math.max(0, contrast * (gray - 128) + 128));
          d[i] = d[i + 1] = d[i + 2] = gray;
        }

        ctx.putImageData(imgData, 0, 0);
        URL.revokeObjectURL(url);
        canvas.toBlob((blob) => resolve(blob || file), "image/png", 1.0);
      } catch (_) {
        URL.revokeObjectURL(url);
        resolve(file);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file);
    };

    img.src = url;
  });
};

export interface OCRReceiptData {
  platform: string;
  method: string;
  amount: number | null;
  utr: string | null;
  transactionId: string | null;
  date: string | null;
}

export async function scanPaymentReceiptOCR(
  file: File,
  preset = "auto",
  onProgress?: (pct: number) => void
): Promise<OCRReceiptData> {
  const enhancedImage = await preprocessReceiptImage(file);

  const worker = await Tesseract.createWorker("eng", 1, {
    logger: (m) => {
      if (m.status === "recognizing text" && m.progress && onProgress) {
        onProgress(Math.round(m.progress * 100));
      }
    },
  });

  const {
    data: { text },
  } = await worker.recognize(enhancedImage);
  await worker.terminate();

  const raw = text.toLowerCase();
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  // 1. Identify Payment Platform & Method
  let platform = "Payment Receipt";
  let method = "UPI";

  if (
    preset === "gpay" ||
    raw.includes("google pay") ||
    raw.includes("gpay") ||
    raw.includes("okaxis") ||
    raw.includes("okhdfcbank") ||
    raw.includes("okicici")
  ) {
    platform = "Google Pay";
    method = "UPI";
  } else if (
    preset === "phonepe" ||
    raw.includes("phonepe") ||
    raw.includes("ybl") ||
    raw.includes("ibl") ||
    raw.includes("axl")
  ) {
    platform = "PhonePe";
    method = "UPI";
  } else if (preset === "paytm" || raw.includes("paytm")) {
    platform = "Paytm";
    method = "UPI";
  } else if (
    preset === "cash_slip" ||
    raw.includes("cash deposit") ||
    raw.includes("challan") ||
    raw.includes("teller") ||
    raw.includes("denomination")
  ) {
    platform = "Bank Cash Slip";
    method = "Cash Deposit";
  } else if (
    preset === "neft_imps" ||
    raw.includes("neft") ||
    raw.includes("rtgs") ||
    raw.includes("imps")
  ) {
    platform = raw.includes("imps") ? "IMPS" : "NEFT/RTGS";
    method = platform;
  }

  // 2. Multi-Pass Amount Extraction
  const amountCandidates: number[] = [];

  // Pass 1: Explicit labeled amounts (₹, Rs, INR, Paid, Amount, Total)
  const labeledRegexes = [
    /(?:₹|rs\.?|inr|amount\s*paid|total\s*amount|paid\s*to|amount|amt|total)\s*[:\-₹\s]*([1-9]\d{0,2}(?:,\d{2,3})+(?:\.\d{1,2})?|[1-9]\d{1,5}(?:\.\d{1,2})?)/gi,
    /([1-9]\d{0,2}(?:,\d{2,3})+(?:\.\d{1,2})?)\s*(?:only|\/\-)/gi,
  ];

  for (const rgx of labeledRegexes) {
    for (const match of text.matchAll(rgx)) {
      if (match[1]) {
        const cleanVal = parseFloat(match[1].replace(/,/g, ""));
        if (
          !isNaN(cleanVal) &&
          cleanVal >= 10 &&
          cleanVal <= 1000000 &&
          !(cleanVal >= 2020 && cleanVal <= 2035)
        ) {
          amountCandidates.push(cleanVal);
        }
      }
    }
  }

  // Pass 2: Comma-formatted numbers in the top lines of UPI screenshots (handles cases where '₹' was misread as '2' or '7' or dropped)
  if (amountCandidates.length === 0) {
    for (const line of lines.slice(0, 14)) {
      const commaMatch = line.match(/\b([1-9]\d{0,2}(?:,\d{2,3})+(?:\.\d{2})?)\b/);
      if (commaMatch) {
        let rawNumStr = commaMatch[1].replace(/,/g, "");
        // If Tesseract turned '₹ 1,250' into '21,250' or '71,250', strip the false leading '2' or '7' when preceded by no spaces
        if (
          rawNumStr.length >= 5 &&
          (rawNumStr.startsWith("2") || rawNumStr.startsWith("7")) &&
          !line.includes("₹")
        ) {
          const stripped = parseFloat(rawNumStr.slice(1));
          if (!isNaN(stripped) && stripped >= 50 && stripped % 25 === 0) {
            amountCandidates.push(stripped);
            continue;
          }
        }
        const val = parseFloat(rawNumStr);
        if (!isNaN(val) && val >= 10 && val <= 500000) {
          amountCandidates.push(val);
        }
      }
    }
  }

  // Pass 3: Standalone decimal currency values (e.g., 4800.00) or clean 2-to-5 digit amounts near "completed/successful"
  if (amountCandidates.length === 0) {
    const decMatches = text.match(/\b([1-9]\d{1,5}\.\d{2})\b/g);
    if (decMatches) {
      for (const dm of decMatches) {
        const val = parseFloat(dm);
        if (!isNaN(val) && val >= 10 && val <= 500000) amountCandidates.push(val);
      }
    }
  }

  if (amountCandidates.length === 0) {
    for (const line of lines.slice(0, 10)) {
      const standalone = line.match(/^[₹27]?\s*([1-9]\d{1,4})$/);
      if (standalone && standalone[1]) {
        const val = parseFloat(standalone[1]);
        if (val >= 25 && val <= 100000 && !(val >= 2020 && val <= 2035)) {
          amountCandidates.push(val);
        }
      }
    }
  }

  const extractedAmount = amountCandidates.length > 0 ? amountCandidates[0] : null;

  // 3. Extract Unique UTR & Secondary Transaction ID
  let extractedUtr: string | null = null;
  let extractedTxnId: string | null = null;

  const utrMatch = text.match(
    /(?:upi\s*ref(?:\s*no|\s*id)?|utr(?:\s*no|\s*number)?|rrn|ref\s*no)[:\s#.\-]*([0-9\s]{10,16})/i
  );
  if (utrMatch && utrMatch[1]) {
    const cleanDigits = utrMatch[1].replace(/\D/g, "");
    if (cleanDigits.length >= 10 && cleanDigits.length <= 16) {
      extractedUtr = cleanDigits;
    }
  }

  if (!extractedUtr) {
    const spacedUtr = text.match(/\b(\d{4}\s?\d{4}\s?\d{4})\b/);
    if (spacedUtr && spacedUtr[1]) {
      extractedUtr = spacedUtr[1].replace(/\s+/g, "");
    }
  }

  const txnMatch = text.match(
    /(?:google\s*transaction\s*id|phonepe\s*transaction\s*id|transaction\s*id|txn\s*id|journal(?:\s*no)?|scroll(?:\s*no)?|challan(?:\s*no)?)[:\s#.\-]*([A-Za-z0-9\-]{6,28})/i
  );
  if (txnMatch && txnMatch[1]) {
    extractedTxnId = txnMatch[1].trim();
  }

  if (!extractedUtr && extractedTxnId) {
    extractedUtr = extractedTxnId;
  }
  if (!extractedTxnId && extractedUtr) {
    extractedTxnId = extractedUtr;
  }

  // 4. Extract Receipt Date (YYYY-MM-DD)
  const monthMap: Record<string, string> = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
  };
  let parsedDate: string | null = null;

  const dmyMatch = text.match(/\b([0-3]?\d)[\/\-\.]([0-1]?\d)[\/\-\.](202\d)\b/);
  const ddMonYyyy = text.match(/\b([0-3]?\d)\s+([A-Za-z]{3,9})[,\s]+(202\d)\b/);
  const monDdYyyy = text.match(/\b([A-Za-z]{3,9})\s+([0-3]?\d),?\s+(202\d)\b/);

  if (dmyMatch) {
    parsedDate = `${dmyMatch[3]}-${dmyMatch[2].padStart(2, "0")}-${dmyMatch[1].padStart(2, "0")}`;
  } else if (ddMonYyyy) {
    const m = monthMap[ddMonYyyy[2].toLowerCase().substring(0, 3)];
    if (m) parsedDate = `${ddMonYyyy[3]}-${m}-${ddMonYyyy[1].padStart(2, "0")}`;
  } else if (monDdYyyy) {
    const m = monthMap[monDdYyyy[1].toLowerCase().substring(0, 3)];
    if (m) parsedDate = `${monDdYyyy[3]}-${m}-${monDdYyyy[2].padStart(2, "0")}`;
  }

  return {
    platform,
    method,
    amount: extractedAmount,
    utr: extractedUtr,
    transactionId: extractedTxnId,
    date: parsedDate,
  };
}