/**
 * A person's face, wherever they appear.
 *
 * The same name must produce the same colour and the same initials on a note,
 * in a room's cast, and on the moment they joined — a face that changes between
 * surfaces reads as a different person, which is the one thing a product about
 * whose-heart-is-this cannot afford.
 *
 * Lifted out of Home so the rail can use it without importing a page.
 */

const CONTRIBUTOR_COLORS = ["#8a6a2f", "#4a6a55", "#5a5170", "#7a4a4a", "#6a5a3a", "#3f5a6a"];

export function contributorColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return CONTRIBUTOR_COLORS[hash % CONTRIBUTOR_COLORS.length]!;
}

export function contributorInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}
