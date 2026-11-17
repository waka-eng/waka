/* The Gemini request dialect, structurally — the builders' return shape.
   Typed here rather than imported so queue/gemini.ts keeps its types
   private and this module cannot reach past the builders. */
export interface GeminiShapedSchema {
  type: string;
  description?: string;
  enum?: readonly string[];
  nullable?: boolean;
  items?: GeminiShapedSchema;
  properties?: Record<string, GeminiShapedSchema>;
  required?: readonly string[];
  anyOf?: readonly GeminiShapedSchema[];
  minItems?: number;
  maxItems?: number;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
}
export interface GeminiShapedRequest {
  systemInstruction?: { parts: Array<{ text: string }> };
  contents: Array<{ role?: string; parts: Array<{ text: string }> }>;
  generationConfig: {
    temperature?: number;
    maxOutputTokens?: number;
    responseSchema?: GeminiShapedSchema;
  };
}

const TYPE_MAP: Record<string, string> = {
  OBJECT: "object",
  ARRAY: "array",
  STRING: "string",
  NUMBER: "number",
  INTEGER: "integer",
  BOOLEAN: "boolean",
  NULL: "null",
};

/** Gemini's UPPERCASE schema dialect → plain JSON Schema. */
export function toJsonSchema(schema: GeminiShapedSchema, strict = false): Record<string, unknown> {
  const out: Record<string, unknown> = {
    type: TYPE_MAP[schema.type] ?? schema.type.toLowerCase(),
  };
  if (schema.description) out.description = schema.description;
  if (schema.enum) out.enum = schema.enum;
  if (schema.nullable) out.type = [out.type as string, "null"];
  if (schema.items) out.items = toJsonSchema(schema.items, strict);
  if (schema.properties) {
    out.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([key, value]) => [key,
        strict && !schema.required?.includes(key)
          ? { anyOf: [toJsonSchema(value, strict), { type: 'null' }] }
          : toJsonSchema(value, strict)]),
    );
    out.additionalProperties = false;
  }
  if (strict && schema.properties) out.required = Object.keys(schema.properties);
  else if (schema.required) out.required = schema.required;
  if (schema.anyOf) out.anyOf = schema.anyOf.map(child => toJsonSchema(child, strict));
  for (const key of ['minItems','maxItems','minimum','maximum','minLength','maxLength','pattern'] as const) {
    if (schema[key] !== undefined) out[key] = schema[key];
  }
  return out;
}
