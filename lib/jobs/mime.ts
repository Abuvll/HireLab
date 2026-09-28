import { UnsupportedFileTypeError } from "../parsing/resume";

export function inferMimeTypeFromUrl(url: string): string {
  const clean = url.split("?")[0].toLowerCase();
  if (clean.endsWith(".pdf")) return "application/pdf";
  if (clean.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  throw new UnsupportedFileTypeError(`unknown (inferred from URL: ${url})`);
}
