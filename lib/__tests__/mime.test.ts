import { describe, it, expect } from "vitest";
import { inferMimeTypeFromUrl } from "../jobs/mime";
import { UnsupportedFileTypeError } from "../parsing/resume";

describe("inferMimeTypeFromUrl", () => {
  it("infers PDF from a .pdf extension", () => {
    expect(inferMimeTypeFromUrl("https://files.example.com/resume.pdf")).toBe("application/pdf");
  });

  it("infers DOCX from a .docx extension", () => {
    expect(inferMimeTypeFromUrl("https://files.example.com/resume.docx")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
  });

  it("ignores query strings when checking the extension", () => {
    expect(inferMimeTypeFromUrl("https://files.example.com/resume.pdf?sig=abc123&exp=999")).toBe(
      "application/pdf"
    );
  });

  it("is case-insensitive", () => {
    expect(inferMimeTypeFromUrl("https://files.example.com/RESUME.PDF")).toBe("application/pdf");
  });

  it("throws UnsupportedFileTypeError for anything else", () => {
    expect(() => inferMimeTypeFromUrl("https://files.example.com/resume.txt")).toThrow(
      UnsupportedFileTypeError
    );
  });
});
