import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

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
  const timestamp = new Date().toLocaleString('en-IN');
  const stampText = `USER: ${partnerEmail} | LOC: ${centerName || 'N/A'} | IP: ${userIp} | TIME: ${timestamp}`;

  for (const docName of requiredDocs) {
    const fileOrFiles = docFiles[docName];
    if (!fileOrFiles) continue;

    const filesToProcess = Array.isArray(fileOrFiles) ? fileOrFiles : [fileOrFiles];

    for (let i = 0; i < filesToProcess.length; i++) {
      const file = filesToProcess[i];
      const arrayBuffer = await file.arrayBuffer();
      const mimeType = file.type.toLowerCase();
      
      const label = Array.isArray(fileOrFiles) ? `${docName} (Part ${i + 1}/5)` : docName;
      onProgress(`Processing ${label}...`);

      if (mimeType.includes('pdf') || file.name.toLowerCase().endsWith('.pdf')) {
        const loadedPdf = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
        const copiedPages = await pdfDoc.copyPages(loadedPdf, loadedPdf.getPageIndices());
        
        copiedPages.forEach((page) => {
          pdfDoc.addPage(page);
          const { width } = page.getSize();
          page.drawRectangle({ x: 0, y: 0, width: width, height: 20, color: rgb(0, 0, 0) });
          page.drawText(`${label.toUpperCase()} | ${stampText}`, { x: 10, y: 6, size: 7, font: trackingFont, color: rgb(1, 1, 1) });
        });
      } else if (mimeType.includes('jpeg') || mimeType.includes('jpg') || mimeType.includes('png')) {
        let image = (mimeType.includes('png')) ? await pdfDoc.embedPng(arrayBuffer) : await pdfDoc.embedJpg(arrayBuffer);
        let { width, height } = image;
        const maxWidth = 595.28; 
        if (width > maxWidth) {
          const ratio = maxWidth / width;
          width = maxWidth;
          height = height * ratio;
        }

        const page = pdfDoc.addPage([width, height + 25]);
        page.drawImage(image, { x: 0, y: 25, width: width, height: height });
        page.drawRectangle({ x: 0, y: 0, width: width, height: 25, color: rgb(0, 0, 0) });
        page.drawText(`${label.toUpperCase()} | ${stampText}`, { x: 10, y: 8, size: 7, font: trackingFont, color: rgb(1, 1, 1) });
      }
    }
  }

  onProgress("Uploading secure Compliance PDF to Vault...");
  const mergedPdfBytes = await pdfDoc.save();
  return mergedPdfBytes;
};