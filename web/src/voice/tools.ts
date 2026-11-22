export { LIVE_APP_TOOLS as realtimeTools, type LiveAppToolName as RealtimeToolName } from '@faresight/shared';

interface ToolSchema {
  type?: string;
  properties?: Record<string, ToolSchema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: ToolSchema;
  anyOf?: ToolSchema[];
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  pattern?: string;
}

export function validToolValue(value: unknown, schema: ToolSchema): boolean {
  if (schema.anyOf) return schema.anyOf.some((option) => validToolValue(value, option));
  if (schema.enum && !schema.enum.includes(value)) return false;
  switch (schema.type) {
    case 'object': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
      return (schema.required ?? []).every((key) => Object.hasOwn(value, key)) &&
        Object.entries(value).every(([key, entry]) => {
          const properties = schema.properties ?? {};
          return Object.hasOwn(properties, key) ? validToolValue(entry, properties[key]) : schema.additionalProperties !== false;
        });
    }
    case 'array':
      return Array.isArray(value) && value.length >= (schema.minItems ?? 0) &&
        value.length <= (schema.maxItems ?? Infinity) && (!schema.uniqueItems || new Set(value).size === value.length) &&
        (!schema.items || value.every((entry) => validToolValue(entry, schema.items!)));
    case 'number':
    case 'integer':
      return typeof value === 'number' && Number.isFinite(value) &&
        (schema.type === 'number' || Number.isInteger(value)) &&
        value >= (schema.minimum ?? -Infinity) && value <= (schema.maximum ?? Infinity);
    case 'string':
      return typeof value === 'string' && (!schema.pattern || new RegExp(schema.pattern).test(value));
    case 'boolean':
      return typeof value === 'boolean';
    default:
      return false;
  }
}
