import { InvalidInput, PayloadTooLarge } from "./errors";

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

export type ImageType = "image/jpeg" | "image/png" | "image/webp";

export type ImageUpload = { bytes: Uint8Array; type: ImageType };

function startsWith(bytes: Uint8Array, offset: number, expected: number[]): boolean {
  return expected.every((byte, i) => bytes[offset + i] === byte);
}

/**
 * O tipo vem da "assinatura" do arquivo, os bytes fixos do começo de cada
 * formato. O nome do arquivo e o Content-Type são escolhas de quem enviou e não
 * provam nada: um executável renomeado para .jpg chega como image/jpeg.
 */
export function detectImageType(bytes: Uint8Array): ImageType | null {
  if (startsWith(bytes, 0, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  // WebP é um contêiner RIFF: "RIFF" no byte 0 e "WEBP" a partir do byte 8
  if (startsWith(bytes, 0, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, 8, [0x57, 0x45, 0x42, 0x50])) return "image/webp";
  return null;
}

/** Folga para as fronteiras e cabeçalhos do multipart, além da própria imagem. */
const MULTIPART_OVERHEAD = 64 * 1024;

/**
 * Lê uma imagem enviada como multipart/form-data no campo `field` e confere
 * tamanho e formato. Imagem grande demais é 413; qualquer outro problema, 400.
 */
export async function readImageUpload(request: Request, field: string): Promise<ImageUpload> {
  // recusa cedo, pelo cabeçalho, antes de ler um corpo muito maior que o limite
  if (Number(request.headers.get("content-length") ?? 0) > MAX_IMAGE_BYTES + MULTIPART_OVERHEAD) {
    throw new PayloadTooLarge("A imagem passa de 2 MB");
  }
  // formData() rejeita um corpo que não é multipart (um JSON, por exemplo)
  const form = await request.formData().catch(() => null);
  if (!form) throw new InvalidInput(`Envie a imagem como multipart/form-data, no campo ${field}`);
  const file = form.get(field);
  if (!(file instanceof File) || file.size === 0) throw new InvalidInput(`Envie a imagem no campo ${field}`);
  if (file.size > MAX_IMAGE_BYTES) throw new PayloadTooLarge("A imagem passa de 2 MB");

  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = detectImageType(bytes);
  if (!type) throw new InvalidInput("Envie uma imagem JPEG, PNG ou WebP");
  return { bytes, type };
}
