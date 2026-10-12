const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * A JSON Schema with every object closed by `additionalProperties: false`, as OpenAI's strict tools and Claude's
 * structured outputs require. `drop` removes keywords the API doesn't accept (Claude: array size limits).
 */
export function closedSchema(schema: Record<string, unknown>, drop: readonly string[] = []): Record<string, unknown> {
  const closed: Record<string, unknown> = Object.fromEntries(Object.entries(schema).filter(([key]) => !drop.includes(key)));
  if (isRecord(schema.properties)) {
    closed.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([name, value]) => [name, isRecord(value) ? closedSchema(value, drop) : value]),
    );
  }
  if (isRecord(schema.items)) closed.items = closedSchema(schema.items, drop);
  if (schema.type === 'object') closed.additionalProperties = false;
  return closed;
}
