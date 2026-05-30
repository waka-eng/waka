export const contextNodeTypeValues = [
  "theme",
  "value",
  "person",
  "environment",
  "aesthetic",
  "tension",
  "project",
  "open_question",
  "hypothesis",
] as const;

export type ContextNodeType = (typeof contextNodeTypeValues)[number];

const contextNodeTypeSet = new Set<string>(contextNodeTypeValues);

export function isContextNodeType(value: string): value is ContextNodeType {
  return contextNodeTypeSet.has(value);
}

export function normalizeContextNodeType(value: string): ContextNodeType {
  if (isContextNodeType(value)) return value;

  switch (value) {
    case "question":
      return "open_question";
    case "life_direction":
      return "project";
    case "person_archetype":
      return "person";
    case "desire":
      return "hypothesis";
    case "claim":
      return "theme";
    case "value":
    case "environment":
    case "tension":
      return value;
    default:
      return "theme";
  }
}
