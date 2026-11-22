/** Imagens mínimas para os testes: só os primeiros bytes importam para a validação. */

// um PNG de verdade, 1×1 pixel
export const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));

export const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

export const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x1a, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20]);

// começa como um executável do Windows ("MZ"), mesmo com nome e tipo de imagem
export const FAKE_JPEG = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);

/** Um corpo multipart com um arquivo no campo pedido, como o navegador monta. */
export function imageForm(field: string, bytes: Uint8Array, name = "imagem.png", type = "image/png"): FormData {
  const form = new FormData();
  form.append(field, new File([bytes], name, { type }));
  return form;
}
