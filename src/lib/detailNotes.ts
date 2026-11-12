import { TimestampRef } from '../types';

export function appendQuotedText(existing: string, heading: string, text: string) {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return existing;
  const entry = `- "${cleaned.replace(/"/g, '\\"')}"`;
  const sectionHeader = `## ${heading}`;
  const trimmed = existing.replace(/\s+$/, '');
  if (!trimmed) return `${sectionHeader}\n${entry}\n`;

  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(^|\\n)## ${escapedHeading}\\n([\\s\\S]*?)(?=\\n## |$)`, 'm');
  const match = pattern.exec(trimmed);
  if (!match) return `${trimmed}\n\n${sectionHeader}\n${entry}\n`;

  const prefix = trimmed.slice(0, match.index + match[1].length);
  const suffix = trimmed.slice(match.index + match[0].length);
  const existingEntries = match[2]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!existingEntries.includes(entry)) existingEntries.push(entry);
  const rebuiltSection = `${sectionHeader}\n${existingEntries.join('\n')}`;
  return `${prefix}${rebuiltSection}${suffix ? suffix : ''}`.replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

function normalizeTimestampRefList(refs: TimestampRef[]) {
  return [...refs]
    .map((ref) => ({
      id: String(ref.id || ''),
      seconds: Number.isFinite(ref.seconds) ? Math.max(0, Math.floor(ref.seconds)) : 0,
      label: String(ref.label || '').trim(),
      createdAt: Number.isFinite(ref.createdAt) ? Math.floor(ref.createdAt) : 0,
    }))
    .sort((a, b) => (a.seconds - b.seconds) || (a.createdAt - b.createdAt) || a.id.localeCompare(b.id));
}

export function timestampRefsEqual(left: TimestampRef[] = [], right: TimestampRef[] = []) {
  const normalizedLeft = normalizeTimestampRefList(left);
  const normalizedRight = normalizeTimestampRefList(right);
  if (normalizedLeft.length !== normalizedRight.length) return false;
  return normalizedLeft.every((item, index) => {
    const other = normalizedRight[index];
    return item.id === other.id
      && item.seconds === other.seconds
      && item.label === other.label
      && item.createdAt === other.createdAt;
  });
}
