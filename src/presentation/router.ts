export type Handler = (
  request: Request,
  params: Record<string, string>,
) => Response | Promise<Response>;

export type Route = { method: string; pattern: string; handler: Handler };

export function match(
  pattern: string,
  path: string,
): Record<string, string> | null {
  const patternParts = pattern.split("/").filter(Boolean);
  const pathParts = path.split("/").filter(Boolean);

  if (patternParts.length !== pathParts.length) return null;

  const params: Record<string, string> = {};

  for (let i = 0; i < patternParts.length; i++) {
    const expected = patternParts[i]!;
    const received = pathParts[i]!;

    if (expected.startsWith(":")) {
      params[expected.slice(1)] = received;
    } else if (expected !== received) {
      return null;
    }
  }

  return params;
}
