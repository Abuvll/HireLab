import { describe, it, expect } from "vitest";
import { extractResumeText, normalizeExtractedText, UnsupportedFileTypeError } from "../parsing/resume";

async function makeTestPdf(text: string): Promise<Buffer> {
  const { PDFDocument, StandardFonts } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 200]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    page.drawText(line, { x: 20, y: 170 - i * 18, size: 14, font });
  });
  const bytes = await doc.save();
  return Buffer.from(bytes);
}

async function makeTestDocx(text: string): Promise<Buffer> {
  const { Document, Packer, Paragraph, TextRun } = await import("docx");
  const doc = new Document({
    sections: [
      {
        children: [new Paragraph({ children: [new TextRun(text)] })],
      },
    ],
  });
  return Packer.toBuffer(doc);
}

describe("extractResumeText", () => {
  it("extracts text from a real PDF buffer", async () => {
    const pdf = await makeTestPdf("Maren Ito - Backend Engineer");
    const text = await extractResumeText(pdf, "application/pdf");
    expect(text).toContain("Maren Ito");
    expect(text).toContain("Backend Engineer");
  });

  it("extracts text from a real DOCX buffer", async () => {
    const docx = await makeTestDocx("Diego Fuentes - Platform Engineer");
    const text = await extractResumeText(
      docx,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    expect(text).toContain("Diego Fuentes");
    expect(text).toContain("Platform Engineer");
  });

  it("throws UnsupportedFileTypeError for anything else", async () => {
    const buffer = Buffer.from("hello");
    await expect(extractResumeText(buffer, "text/plain")).rejects.toThrow(UnsupportedFileTypeError);
  });

  it("collapses runs of 3+ blank lines to a single paragraph break", () => {
    const noisy = "Paragraph one.\n\n\n\n\nParagraph two.";
    expect(normalizeExtractedText(noisy)).toBe("Paragraph one.\n\nParagraph two.");
  });

  it("collapses repeated spaces/tabs without touching line breaks", () => {
    const noisy = "Name:    Maren   Ito\nRole:\tBackend  Engineer";
    expect(normalizeExtractedText(noisy)).toBe("Name: Maren Ito\nRole: Backend Engineer");
  });
});
