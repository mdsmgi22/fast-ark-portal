// FILE PATH: ./app/lib/pdfEngine.ts
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

// Prevents pdf-lib StandardFonts (WinAnsi) from throwing encoding errors on Unicode / non-ASCII characters
const sanitizePdfText = (val: string): string =>
  String(val || "").replace(/[^\x20-\x7E]/g, " ");

export const buildCompliancePDF = async (
  partnerEmail: string,
  centerName: string,
  userIp: string,
  requiredDocs: string[],
  docFiles: Record<string, File | File[] | null>,
  onProgress: (msg: string) => void
): Promise<Uint8Array> => {
  onProgress("Merging documents into a secure PDF...");

  const pdfDoc = await PDFDocument.create();
  const trackingFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const timestamp = sanitizePdfText(
    new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
  );
  const stampText = sanitizePdfText(
    `USER: ${partnerEmail} | LOC: ${centerName || "N/A"} | IP: ${userIp} | TIME: ${timestamp}`
  );

  for (const docName of requiredDocs) {
    const fileOrFiles = docFiles[docName];
    if (!fileOrFiles) continue;

    const filesToProcess = Array.isArray(fileOrFiles)
      ? fileOrFiles
      : [fileOrFiles];

    for (let i = 0; i < filesToProcess.length; i++) {
      const file = filesToProcess[i];
      const arrayBuffer = await file.arrayBuffer();
      const mimeType = (file.type || "").toLowerCase();
      const fileNameLower = (file.name || "").toLowerCase();

      const label = Array.isArray(fileOrFiles)
        ? `${docName} (Part ${i + 1}/${filesToProcess.length})`
        : docName;
      onProgress(`Processing ${label}...`);

      const fullWatermark = sanitizePdfText(
        `${label.toUpperCase()} | ${stampText}`
      ).slice(0, 115);

      const isPdf =
        mimeType.includes("pdf") || fileNameLower.endsWith(".pdf");
      const isPng =
        mimeType.includes("png") || fileNameLower.endsWith(".png");
      const isJpg =
        mimeType.includes("jpeg") ||
        mimeType.includes("jpg") ||
        fileNameLower.endsWith(".jpg") ||
        fileNameLower.endsWith(".jpeg");

      if (isPdf) {
        const loadedPdf = await PDFDocument.load(arrayBuffer, {
          ignoreEncryption: true,
        });
        const copiedPages = await pdfDoc.copyPages(
          loadedPdf,
          loadedPdf.getPageIndices()
        );

        copiedPages.forEach((page) => {
          pdfDoc.addPage(page);
          const { width } = page.getSize();
          page.drawRectangle({
            x: 0,
            y: 0,
            width: width,
            height: 20,
            color: rgb(0, 0, 0),
          });
          page.drawText(fullWatermark, {
            x: 10,
            y: 6,
            size: 7,
            font: trackingFont,
            color: rgb(1, 1, 1),
          });
        });
      } else if (isPng || isJpg) {
        const image = isPng
          ? await pdfDoc.embedPng(arrayBuffer)
          : await pdfDoc.embedJpg(arrayBuffer);
        let { width, height } = image;
        const maxWidth = 595.28;
        if (width > maxWidth) {
          const ratio = maxWidth / width;
          width = maxWidth;
          height = height * ratio;
        }

        const page = pdfDoc.addPage([width, height + 25]);
        page.drawImage(image, {
          x: 0,
          y: 25,
          width: width,
          height: height,
        });
        page.drawRectangle({
          x: 0,
          y: 0,
          width: width,
          height: 25,
          color: rgb(0, 0, 0),
        });
        page.drawText(fullWatermark, {
          x: 10,
          y: 8,
          size: 7,
          font: trackingFont,
          color: rgb(1, 1, 1),
        });
      } else {
        throw new Error(
          `Unsupported file format for "${file.name}". Please upload PDF, JPG, or PNG files.`
        );
      }
    }
  }

  onProgress("Uploading secure Compliance PDF to Vault...");
  const mergedPdfBytes = await pdfDoc.save();
  return mergedPdfBytes;
};