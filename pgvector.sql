CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS livros_vetores (
  livro_id INTEGER PRIMARY KEY REFERENCES livros(id) ON DELETE CASCADE,
  texto TEXT NOT NULL,
  v vector(768) NOT NULL,
  modelo TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS livros_vetores_v_idx ON livros_vetores USING hnsw (v vector_cosine_ops);
