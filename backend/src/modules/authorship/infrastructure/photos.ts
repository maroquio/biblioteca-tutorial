import { objectKey } from "../../../infrastructure/storage";

export function photoKey(authorId: number): string {
  return objectKey("autoria", "autores", authorId, "foto");
}
