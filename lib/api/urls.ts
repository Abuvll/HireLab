
export function buildApplyUrl(positionId: string, requestOrigin: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || requestOrigin;
  return `${base.replace(/\/$/, "")}/apply/${positionId}`;
}
