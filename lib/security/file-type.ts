// Verifies a file's actual content matches the type it claims to be, by
// checking magic bytes — not the filename extension or the client-supplied
// MIME header, both of which are trivially spoofed by whoever is uploading
// (this endpoint is public and unauthenticated — see §3.17). Deliberately
// hand-rolled rather than a magic-byte-sniffing npm package: the two
// formats this app accepts have simple, well-documented signatures, and
// avoiding the dependency avoids that package's own supply-chain surface
// for a two-case check.

export type DetectedFileType = "pdf" | "docx" | null;

export function detectFileType(bytes: Buffer): DetectedFileType {
  if (isPdf(bytes)) return "pdf";
  if (isDocx(bytes)) return "docx";
  return null;
}

function isPdf(bytes: Buffer): boolean {
  // PDFs start with "%PDF-" (0x25 0x50 0x44 0x46 0x2D)
  return bytes.length >= 5 && bytes.subarray(0, 5).toString("ascii") === "%PDF-";
}

function isDocx(bytes: Buffer): boolean {
  // .docx is a ZIP container (local file header signature "PK\x03\x04")
  // with specific internal parts. Checking the ZIP signature alone would
  // also match plain .zip, .xlsx, .pptx, etc., so additionally confirm
  // `[Content_Types].xml` — present in every valid Office Open XML
  // package — appears in the byte stream. This is a lightweight check,
  // not full ZIP parsing: good enough to reject "renamed .exe" or
  // "renamed .zip" attacks, which is the actual threat model here.
  if (bytes.length < 4) return false;
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  if (!isZip) return false;
  return bytes.includes(Buffer.from("[Content_Types].xml"));
}
