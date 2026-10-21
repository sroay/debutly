/** The JSON object in a model's reply, tolerating prose or code fences around it. */
export function extractJsonObject(raw: string): unknown {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("no JSON object in the reply");
  return JSON.parse(raw.slice(start, end + 1));
}
