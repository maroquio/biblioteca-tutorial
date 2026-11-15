# Roteiro: busca semântica com pgvector

## 1. Objetivo (30 s)

Os vetores da busca semântica (UC24) saíram do Redis e foram para o próprio PostgreSQL, com a extensão pgvector. O contrato da API, o embedder, o limiar e a página não mudaram. Mudou só onde os vetores ficam e como os vizinhos são encontrados.

### Arquivos alterados

| Arquivo | Situação |
|---|---|
| `infra/compose.yaml` | alterado |
| `backend/src/modules/catalog/infrastructure/schema.ts` | alterado |
| `backend/src/modules/catalog/infrastructure/bookVectors.ts` | novo (substitui `bookIndex.ts`) |
| `backend/src/modules/catalog/infrastructure/book-vectors.test.ts` | novo |
| `backend/src/modules/catalog/features/semantic-search-books/searchBooksSemantically.ts` | alterado |
| `backend/src/modules/catalog/features/create-book/createBook.ts` | só o import |
| `backend/src/modules/catalog/features/update-book/updateBook.ts` | só o import |
| `backend/src/modules/catalog/features/delete-book/deleteBook.ts` | só o import |
| `backend/src/modules/catalog/index.ts` | só o import (mesmos nomes exportados) |
| `backend/src/integration/derivedData.ts` | alterado |
| `backend/src/main.ts` | alterado |
| `backend/scripts/check-boundaries.ts` | alterado |
| `backend/src/modules/catalog/infrastructure/bookIndex.ts` | removido |
| `backend/src/modules/catalog/infrastructure/book-index.test.ts` | removido |
| `backend/src/modules/catalog/infrastructure/knn-reply.test.ts` | removido |

## 2. Infraestrutura (barema: 2 pts)

- **`infra/compose.yaml`**: no serviço `db`, a imagem passou de `postgres:18` para `pgvector/pgvector:pg18`. É o mesmo Postgres 18 e o mesmo volume.
- **`backend/src/modules/catalog/infrastructure/schema.ts`**: a nova função `createVectorExtension()` roda `CREATE EXTENSION IF NOT EXISTS vector` e é chamada no fim de `prepareCatalog()`. O `prepareDatabase()` executa na subida do servidor e no início da suíte, então cobre o banco da aula e o de testes. Pode rodar várias vezes sem efeito.

## 3. Esquema (4 pts)

- **`backend/src/modules/catalog/infrastructure/bookVectors.ts`**, função `ensureBookVectors(embedder)`:
  - cria a tabela `livros_vetores`, do Acervo, com `livro_id`, `texto` e `embedding vector(N)`;
  - `N` vem de `embedder.dimensions`: 1024 com o hash e 768 com o Gemini. Por isso a tabela é criada aqui, e não no `prepareCatalog()`;
  - a chave estrangeira tem `ON DELETE CASCADE`, então o vetor some no mesmo `DELETE` do livro e não sobram órfãos;
  - cria o índice `hnsw (embedding vector_cosine_ops)`.
- **`backend/scripts/check-boundaries.ts`**: `livros_vetores: "catalog"` foi adicionado em `TABLE_OWNERS`.

## 4. Indexação (4 pts)

- **`bookVectors.ts`**, funções `syncBookIndex()` e `syncIds()`:
  - a gravação é um upsert com `INSERT … ON CONFLICT DO UPDATE`;
  - o embedder só é chamado quando o texto "Título — Autor" mudou;
  - `syncBookIndex` nunca lança erro: se o Gemini falhar, o livro é gravado e fica sem vetor até a próxima reconciliação.
- **`createBook.ts`**, **`updateBook.ts`** e **`deleteBook.ts`**: só o import mudou, de `bookIndex` para `bookVectors`. A chamada a `syncBookIndex` já estava depois do COMMIT, fora do `inTransaction`. Assim nenhuma chamada ao Gemini segura o lock de escrita (armadilha 1).
- **`bookVectors.ts`**, função `syncAuthorBookIndex()`: renomear o autor reindexa os livros dele. Ela é chamada por `backend/src/integration/authorshipIntegration.ts`, que não mudou.
- Na exclusão, quem apaga o vetor é o CASCADE.

## 5. Reconciliação e troca de modelo (3 pts)

- **`bookVectors.ts`**, função `reconcileBookIndex()`: dá vetor aos livros que estão sem (os do seed) e refaz os que têm texto desatualizado.
- **`bookVectors.ts`**, função `ensureBookVectors()`: o id do embedder fica guardado em `COMMENT ON TABLE`. Se o modelo muda, a tabela é apagada e recriada com a dimensão nova, e o `syncBookIndex()` dispara a reconciliação.
- **`backend/src/modules/catalog/index.ts`**: continua exportando `reconcileBookIndex` e `syncAuthorBookIndex`, então nenhum arquivo fora do Acervo precisou mudar de import.
- **`backend/src/integration/derivedData.ts`**:
  - nova função `refreshBookVectors()`;
  - `refreshDerivedData()`, chamado depois do seed, continua reconciliando os vetores;
  - `refreshDerivedDataOnConnect()` agora só invalida o cache de autores quando o Redis reconecta.
- **`backend/src/main.ts`**: chama `refreshBookVectors()` na subida do servidor, sem depender do Redis.

## 6. Busca (4 pts)

- **`bookVectors.ts`**, função `nearestBookVectors()`: a consulta é `ORDER BY embedding <=> $1::vector LIMIT n`. O `<=>` dá 1 − cos(θ), a mesma distância que o Redis usava, então o limiar continua 0,38 para o Gemini e 0,6 para o hash.
- **`backend/src/modules/catalog/features/semantic-search-books/searchBooksSemantically.ts`**:
  - saíram o `client` Redis, o `ready()` e o `knnSearch()`;
  - entraram `ensureBookVectors()` e `nearestBookVectors()`;
  - o limiar, a busca por id e o `toBookView` continuam iguais;
  - o JSON é o mesmo, e as respostas 400 e 503 continuam iguais.
- Nenhum arquivo da busca ou da indexação importa mais `infrastructure/redis`.

## 7. Testes (3 pts)

- **`backend/src/modules/catalog/features/semantic-search-books/semantic-search-books.test.ts`**: não foi alterado e passa.
- **`backend/src/modules/catalog/infrastructure/book-vectors.test.ts`** (novo) tem 11 testes:
  - cadastro (texto e `vector_dims`), edição e exclusão;
  - autor renomeado e livro inserido direto com SQL, como no seed;
  - embedder não chamado quando o texto é igual;
  - embedder fora do ar e sem embedder;
  - troca para 512 dimensões, com restauração da tabela (armadilha 4);
  - índice HNSW cosseno.
- **Removidos:** `book-index.test.ts` e `knn-reply.test.ts`, que testavam detalhes do Redis.
- Resultado: 101 pass e 0 fail. `bun run typecheck` e `bun run check-boundaries` estão verdes.

## 8. Demonstração (2 min)

```powershell
docker compose -f infra/compose.yaml exec db psql -U biblioteca -d biblioteca
```

```sql
\d livros_vetores        -- vector(N), FK com CASCADE, índice hnsw
SELECT (SELECT count(*) FROM livros), (SELECT count(*) FROM livros_vetores);
SET enable_seqscan = off;
EXPLAIN SELECT livro_id FROM livros_vetores
ORDER BY embedding <=> (SELECT embedding FROM livros_vetores LIMIT 1) LIMIT 5;  -- Index Scan
```

```powershell
docker compose -f infra/compose.yaml stop redis
# buscar em /livros/semantica: continua respondendo
docker compose -f infra/compose.yaml start redis
```

## 9. Fechamento (30 s)

O projeto ganhou uma fonte única da verdade, o CASCADE, a possibilidade de JOIN com outras tabelas, backup junto com o banco e nenhum índice para reconstruir quando o Redis reinicia. Em troca, a busca passa a pesar no banco principal e não pode ser escalada separadamente.
