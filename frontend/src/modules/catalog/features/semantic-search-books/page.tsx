/* oxlint-disable react/only-export-components -- Cada page.tsx exporta metadados e componente para o carregamento automático. */
import { Link, useSearchParams } from "react-router-dom";
import { Loading } from "../../../../shared/ui/feedback.tsx";
import { SearchForm } from "../../../../shared/ui/fields.tsx";
import { Page } from "../../../../shared/ui/Page.tsx";
import { Table } from "../../../../shared/ui/Table.tsx";
import { useFetch } from "../../../../shared/useFetch.ts";
import type { SemanticBook } from "../../types.ts";

function SemanticSearchBooks() {
  const [params] = useSearchParams();
  const term = params.get("q") ?? "";
  // sem termo não há o que comparar: a API responderia 400
  const books = useFetch<SemanticBook[]>(term ? `/api/busca-semantica/livros?q=${encodeURIComponent(term)}` : null);
  return <Page title="Busca semântica" description="Descreva o que procura — um tema, um gênero, uma ideia — e veja os livros mais próximos pelo significado.">
    <SearchForm hint="Ex.: mistério e assassinato, vingança, aventura no mar" label="O que você procura?" />
    <Loading loading={books.loading} error={books.error} />
    {books.data && (books.data.length ? <>
      <p className="count">{books.data.length} livro(s) próximo(s), do mais parecido para o menos</p>
      <Table label="Livros próximos"><thead><tr><th>Título / ISBN</th><th>Autor</th><th>Similaridade</th><th>Exemplares</th></tr></thead><tbody>
        {books.data.map((book) => <tr key={book.id}>
          <td><strong>{book.titulo}</strong><small className="secondary-line">{book.isbn}</small></td>
          <td>{book.autor}</td>
          {/* similaridade cosseno = 1 − distância: 1 é o mesmo sentido */}
          <td>{(1 - book.distancia).toFixed(2)}</td>
          <td><Link to={`/exemplares?livroId=${book.id}`}>{book.exemplaresDisponiveis} disponível(is) / {book.totalExemplares} total</Link></td>
        </tr>)}
      </tbody></Table>
    </> : <p className="empty">Nenhum livro próximo o bastante. Tente descrever de outro jeito.</p>)}
  </Page>;
}

export default { useCase: "UC24", title: "Busca semântica", path: "/livros/semantica", Component: SemanticSearchBooks };
