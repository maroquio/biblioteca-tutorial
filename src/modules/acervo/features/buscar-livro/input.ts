import { getFieldAsText } from "../../../../shared/validation";

export function parseBusca(params: Record<string, string>): string {
  return getFieldAsText(params, "q");
}
