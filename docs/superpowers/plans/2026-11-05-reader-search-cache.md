# Reader Search Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a resilient Redis cache-aside layer to UC10 reader searches with generation-based invalidation and observable cache status.

**Architecture:** Keep `SearchReaders` unchanged and wrap it with a feature-level cached function. Store normalized search terms as independently expiring Redis hash fields, use a generation counter to make concurrent stale writes unreachable, and invalidate only after reader-write transactions commit.

**Tech Stack:** TypeScript, Bun, Hono, PostgreSQL, Redis 8, Bun test

**Spec:** `.docs/atividade-cache.html` (activity 6 explicitly excluded)

## Global Constraints

- Cache only `GET /api/leitores`; do not cache `GET /api/leitores/:id`.
- Return `X-Cache: HIT`, `MISS`, or `BYPASS` and continue through PostgreSQL when Redis is unavailable.
- Invalidate after COMMIT for create, update, delete, seed refresh, and startup refresh.
- Redis keys belong to the readers module and every cached field has a 60-second TTL.
- Preserve the original uncached `SearchReaders` implementation.
- Do not modify the frontend or activity 6.

## Review Focus

- Redis connection failure must not break reads or writes.
- A stale result written after invalidation must remain in the old generation.
- Missing `q`, empty `q`, trimmed `q`, and case variants must share cache entries as specified.
- Failed writes must not invalidate, while successful writes invalidate only after commit.
- Individual reader lookup must remain uncached and retain its existing errors.

---

### Task 1: Reader search cache-aside

**Files:**
- Create: `backend/src/modules/readers/infrastructure/searchCache.ts`
- Create: `backend/src/modules/readers/features/search-readers/searchReadersCached.ts`
- Create: `backend/src/modules/readers/features/search-readers/search-readers-cache.test.ts`
- Modify: `backend/src/modules/readers/features/search-readers/route.ts`

**Interfaces:**
- Produces: `readCachedReaderSearch`, `writeCachedReaderSearch`, `invalidateReaderSearch`, and `searchReadersCached`.
- Produces: `GET /api/leitores` with an `X-Cache` response header.

- [ ] Write and run failing tests for MISS/HIT, normalized keys, omitted/empty query, stale-generation writes, Redis bypass, and field TTL.
- [ ] Implement generation-based Redis storage with `HSETEX` and graceful failure handling.
- [ ] Implement the feature wrapper and route header while leaving `SearchReaders` intact.
- [ ] Run the new cache test file and existing UC10 tests.

### Task 2: Post-commit and derived-data invalidation

**Files:**
- Modify: `backend/src/modules/readers/features/create-reader/route.ts`
- Modify: `backend/src/modules/readers/features/update-reader/route.ts`
- Modify: `backend/src/modules/readers/features/delete-reader/route.ts`
- Modify: `backend/src/modules/readers/index.ts`
- Modify: `backend/src/integration/derivedData.ts`
- Modify: `backend/scripts/check-boundaries.ts`
- Test: `backend/src/modules/readers/features/search-readers/search-readers-cache.test.ts`

**Interfaces:**
- Consumes: `invalidateReaderSearch(): Promise<void>` from Task 1.
- Produces: post-commit invalidation for all reader writes and public invalidation for derived-data refreshes.

- [ ] Add failing tests proving create, update, delete, and direct-table refresh invalidate cached searches.
- [ ] Call invalidation after each `inTransaction` resolves.
- [ ] Export invalidation through the readers module and call it from `refreshDerivedData`.
- [ ] Register `leitores` in Redis key ownership.
- [ ] Run boundary checks, typecheck, focused tests, and the complete Compose test suite.

