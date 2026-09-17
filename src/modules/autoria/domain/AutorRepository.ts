import type { Autor } from "./Autor";
import type { Orcid } from "./Orcid";
import type { AutorId } from "../../../shared/identifiers";

export interface AutorRepository {
  findById(autorId: AutorId): Autor | null;

  /** A persistência atribui a identidade e devolve o autor já identificado. */
  insert(autor: Autor): Autor;

  findByOrcid(orcid: Orcid): Autor | null;

  /** Devolve candidatos; quem decide se é "o mesmo autor" é a entidade. */
  findByNomeSemelhante(nome: string): Autor[];

  /** Escrita da projeção. Só a própria Autoria chama isto. */
  ajustarLivrosNoAcervo(autorId: AutorId, delta: number): void;
}