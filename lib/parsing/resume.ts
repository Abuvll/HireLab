
export type SupportedMimeType =
  | "application/pdf"
  | "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export class UnsupportedFileTypeError extends Error {
  constructor(mimeType: string) {
    super(`Unsupported file type: ${mimeType}. Only PDF and DOCX are accepted.`);
    this.name = "UnsupportedFileTypeError";
  }
}

export class TextExtractionError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "TextExtractionError";
  }
}

async function extractFromPdf(buffer: Buffer): Promise<string> {
  try {
  
    const pdfParse = (await import("pdf-parse")).default;
    const data = await pdfParse(buffer);
    return data.text;
  } catch (err) {
    throw new TextExtractionError("Failed to extract text from PDF", err);
  }
}

async function extractFromDocx(buffer: Buffer): Promise<string> {
  try {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  } catch (err) {
    throw new TextExtractionError("Failed to extract text from DOCX", err);
  }
}

export async function extractResumeText(buffer: Buffer, mimeType: string): Promise<string> {
  switch (mimeType as SupportedMimeType) {
    case "application/pdf":
      return normalizeExtractedText(await extractFromPdf(buffer));
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return normalizeExtractedText(await extractFromDocx(buffer));
    default:
      throw new UnsupportedFileTypeError(mimeType);
  }
}

export function normalizeExtractedText(text: string): string {
  return text
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
