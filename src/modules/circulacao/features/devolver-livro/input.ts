import { getFieldAsPositiveInt } from "../../../../shared/validation";

export function parseEmprestimoId(params: Record<string, string>): number {
  return getFieldAsPositiveInt(params, "id");
}
