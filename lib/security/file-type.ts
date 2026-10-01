

export type DetectedFileType = "pdf" | "docx" | null;

export function detectFileType(bytes: Buffer): DetectedFileType {
  if (isPdf(bytes)) return "pdf";
  if (isDocx(bytes)) return "docx";
  return null;
}

function isPdf(bytes: Buffer): boolean {
  
  return bytes.length >= 5 && bytes.subarray(0, 5).toString("ascii") === "%PDF-";
}

function isDocx(bytes: Buffer): boolean {
  if (bytes.length < 4) return false;
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  if (!isZip) return false;
  return bytes.includes(Buffer.from("[Content_Types].xml"));
}
