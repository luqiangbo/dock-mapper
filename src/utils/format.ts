export function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec < 1024) return `${bytesPerSec.toFixed(0)} B/s`;
  const kib = bytesPerSec / 1024;
  if (kib < 1024) return `${kib.toFixed(1)} KB/s`;
  return `${(kib / 1024).toFixed(1)} MB/s`;
}

export function formatSpeedParts(
  bytesPerSec: number,
): { value: string; unit: string } {
  if (bytesPerSec < 1024) return { value: bytesPerSec.toFixed(0), unit: "B/s" };
  const kib = bytesPerSec / 1024;
  if (kib < 1024) return { value: kib.toFixed(1), unit: "K/s" };
  return { value: (kib / 1024).toFixed(1), unit: "M/s" };
}
