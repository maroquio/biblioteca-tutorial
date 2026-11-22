# Busca semântica com pgvector — plano de implementação

**Objetivo:** mover os vetores de livros do Redis para o PostgreSQL/pgvector sem alterar a API, o frontend, os embedders nem os limiares existentes.

**Ponto de partida:** branch `atividade-pgvector`, criada de `upstream/saas-evolution/fase02`; linha de base de 98 testes, 0 falhas.

**Abordagem escolhida:** substituir o adaptador Redis `bookIndex.ts` por um adaptador PostgreSQL `bookVectors.ts`, preservando os nomes públicos `syncBookIndex`, `reconcileBookIndex` e `syncAuthorBookIndex`. A tabela `livros_vetores` guardará `livro_id`, `modelo`, `texto` e `embedding vector(N)`; a troca de `embedder.id` ou dimensão recriará a tabela. O Redis permanecerá apenas no cache de autores.

## Task 1: infraestrutura e extensão pgvector

**Arquivos:**
- Modificar: `infra/compose.yaml`
- Modificar: `backend/src/modules/catalog/infrastructure/schema.ts`
- Modificar: `backend/scripts/check-boundaries.ts`

**Interfaces:**
- `prepareCatalog(): Promise<void>` passa a garantir `CREATE EXTENSION IF NOT EXISTS vector` antes das tabelas do módulo.
- `livros_vetores` pertence ao módulo `catalog` no verificador de fronteiras.

- [ ] Trocar a imagem do banco para `pgvector/pgvector:pg18` e corrigir o comentário do Redis.
- [ ] Recriar o serviço `db` e verificar a extensão pelo `psql`.
- [ ] Adicionar a preparação idempotente da extensão e registrar a tabela no `TABLE_OWNERS`.
- [ ] Executar `bun run check-boundaries` e `bun run typecheck` em `backend/`.

## Task 2: especificar o armazenamento vetorial com testes falhando

**Arquivos:**
- Criar: `backend/src/modules/catalog/infrastructure/book-vectors.test.ts`
- Remover depois da substituição: `backend/src/modules/catalog/infrastructure/book-index.test.ts`
- Remover depois da substituição: `backend/src/modules/catalog/infrastructure/knn-reply.test.ts`

**Comportamentos cobertos:**
- cadastro grava `"Título — Autor"` e vetor na dimensão do embedder;
- edição e renomeação de autor atualizam texto/vetor;
- exclusão remove por `ON DELETE CASCADE`;
- reconciliação indexa livro inserido diretamente;
- texto inalterado não chama o embedder;
- falha do embedder não lança nem desfaz cadastro;
- mudança de modelo/dimensão recria a tabela e reindexa;
- esquema contém FK com cascade e índice HNSW `vector_cosine_ops`.

- [ ] Escrever um teste mínimo por comportamento usando a API e consultas SQL reais.
- [ ] Executar o arquivo novo e confirmar que falha pela ausência de `livros_vetores`/adaptador pgvector.

## Task 3: implementar o adaptador PostgreSQL

**Arquivos:**
- Criar: `backend/src/modules/catalog/infrastructure/bookVectors.ts`
- Modificar imports em `createBook.ts`, `updateBook.ts`, `deleteBook.ts`, `catalog/index.ts`
- Remover: `backend/src/modules/catalog/infrastructure/bookIndex.ts`

**Interfaces produzidas:**
- `ensureBookIndex(embedder: Embedder): Promise<boolean>`
- `syncBookIndex(ids: number[], integration: CatalogIntegration, embedder?: Embedder | null): Promise<IndexResult>`
- `reconcileBookIndex(integration: CatalogIntegration, embedder?: Embedder | null): Promise<IndexResult>`
- `syncAuthorBookIndex(authorId: number, integration: CatalogIntegration): Promise<void>`
- `knnSearch(vector: Float32Array, limit: number): Promise<KnnHit[]>`

- [ ] Validar dimensão inteira entre 1 e 2000 antes de DDL dinâmica.
- [ ] Criar/recriar tabela e índice HNSW de forma segura e idempotente, guardando o `embedder.id`.
- [ ] Converter `Float32Array` para texto pgvector e fazer upsert somente para textos alterados.
- [ ] Manter o contrato “nunca lança” nas sincronizações pós-COMMIT.
- [ ] Implementar KNN com `ORDER BY embedding <=> vetor LIMIT n`.
- [ ] Rodar os testes do Task 2 até ficarem verdes e depois a suíte completa.

## Task 4: retirar o Redis da busca e acertar a reconciliação de subida

**Arquivos:**
- Modificar: `backend/src/modules/catalog/features/semantic-search-books/searchBooksSemantically.ts`
- Modificar: `backend/src/integration/derivedData.ts`
- Modificar: `backend/src/integration/derived-data.test.ts`
- Modificar: `backend/src/main.ts`

**Comportamento:**
- a busca mantém validações, 400/503, ranking, limiar e JSON, mas consulta pgvector;
- reconciliação dos vetores roda na subida sem depender da conexão do Redis;
- reconexão do Redis atualiza somente os dados derivados que ainda vivem nele.

- [ ] Ajustar primeiro os testes de integração da reconciliação e confirmar a falha esperada.
- [ ] Remover `RedisClient`, `ready`, `redis` e `client` do caminho da busca semântica.
- [ ] Manter `semantic-search-books.test.ts` intacto e fazê-lo passar sem Redis no caminho.
- [ ] Rodar busca com o serviço Redis parado e confirmar resposta do endpoint.

## Task 5: verificação integral e entrega

**Arquivos:** todos os alterados nos Tasks 1–4.

- [ ] Confirmar que nenhum código de indexação/busca semântica importa `infrastructure/redis`.
- [ ] Executar `bun run check-boundaries` e `bun run typecheck` em `backend/`.
- [ ] Executar `docker compose -f infra/compose.yaml run --rm --build test` e exigir 0 falhas.
- [ ] Inspecionar `\dx`, `\d livros_vetores`, dimensão, FK, HNSW e um `EXPLAIN` com `enable_seqscan = off`.
- [ ] Revisar `git diff`, confirmar que `semantic-search-books.test.ts` e frontend não mudaram.
- [ ] Fazer commit e push de `atividade-pgvector` para `origin` somente após todas as verificações.

## Review focus

- mudança de embedder com a mesma dimensão, mas `id` diferente, também recria a tabela;
- teste de dimensão restaura o embedder padrão para não contaminar a suíte compartilhada;
- concorrência na criação/recriação da tabela não deixa esquema parcial;
- falha do embedder retorna 503 na busca, mas não falha nas escritas pós-COMMIT;
- delete direto usado por seed/limpeza continua funcionando por causa do `ON DELETE CASCADE`.
