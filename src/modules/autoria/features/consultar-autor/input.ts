import { getFieldAsPositiveInt } from "../../../../shared/validation";

export function parseAutorId(params: Record<string, string>): number {
  return getFieldAsPositiveInt(params, "id");
}
