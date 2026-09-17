import { getBodyAsObject, getFieldAsText } from "../../../../shared/validation";

export type PedidoDeBaixa = {
    numeroRegistro: string;
    motivo: string;
};

export function parsePedidoDeBaixa(
    params: Record<string, string>,
    body: unknown,
): PedidoDeBaixa {
    const data = getBodyAsObject(body);

    return {
        numeroRegistro: getFieldAsText(params, "numeroRegistro"),
        motivo: getFieldAsText(data, "motivo"),
    };
}