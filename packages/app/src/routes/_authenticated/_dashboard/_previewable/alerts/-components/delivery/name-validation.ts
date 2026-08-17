/**
 * IDs keep selections stable through renames; names must remain unique.
 */
export function isDuplicateName(
  existingNames: string[],
  next: string,
  current?: string,
): boolean {
  return existingNames.includes(next) && next !== current;
}
