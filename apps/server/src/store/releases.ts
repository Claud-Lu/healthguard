export function compareRelease(left: string, right: string): number {
  const leftParts = parseRelease(left);
  const rightParts = parseRelease(right);
  const max = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < max; index++) {
    const diff = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return left.localeCompare(right);
}

function parseRelease(value: string): number[] {
  return value
    .replace(/^[^\d]*/, '')
    .split(/[.-]/)
    .map((part) => Number(part))
    .filter((part) => Number.isFinite(part));
}
