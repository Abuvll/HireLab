import { describe, it, expect } from "vitest";
import { detectFileType } from "../security/file-type";

describe("detectFileType", () => {
  it("detects a real PDF by its magic bytes", () => {
    const bytes = Buffer.from("%PDF-1.4\n...rest of a pdf...");
    expect(detectFileType(bytes)).toBe("pdf");
  });

  it("detects a real DOCX (zip signature + Office marker)", () => {
    const zipSignature = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
    const rest = Buffer.from("some zip bytes then [Content_Types].xml then more bytes");
    expect(detectFileType(Buffer.concat([zipSignature, rest]))).toBe("docx");
  });

  it("does not classify a plain ZIP (no Office marker) as docx", () => {
    const zipSignature = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
    const rest = Buffer.from("just some other zip contents, e.g. a plain .zip file");
    expect(detectFileType(Buffer.concat([zipSignature, rest]))).toBeNull();
  });

  it("returns null for plain text pretending to be a PDF via extension alone", () => {
    const bytes = Buffer.from("just some plain text, not a real pdf at all");
    expect(detectFileType(bytes)).toBeNull();
  });

  it("returns null for an empty buffer", () => {
    expect(detectFileType(Buffer.alloc(0))).toBeNull();
  });

  it("returns null for binary content that matches neither signature (e.g. an executable)", () => {
    const bytes = Buffer.from([0x4d, 0x5a, 0x90, 0x00]); // MZ header (Windows PE/EXE)
    expect(detectFileType(bytes)).toBeNull();
  });
});
