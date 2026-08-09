import { sql, type SQL } from "drizzle-orm";

function expandedActorIdentitiesSql(
  rawActorIds: SQL,
  targetActorId: SQL | undefined,
  finalSelect: SQL,
): SQL {
  const targetValue = targetActorId ?? sql`NULL`;
  return sql`
    WITH
    actor_identity_candidates(actor_id) AS MATERIALIZED (
      ${rawActorIds}
    ),
    actor_identity_target(actor_id) AS MATERIALIZED (
      SELECT ${targetValue}
    ),
    actor_identity_raw(source, raw_actor_id, actor_id) AS MATERIALIZED (
      SELECT 0, actor_id, actor_id
      FROM actor_identity_candidates
      UNION ALL
      SELECT 1, actor_id, actor_id
      FROM actor_identity_target
      WHERE actor_id IS NOT NULL
    ),
    actor_identity_fragmentless(source, raw_actor_id, actor_id) AS MATERIALIZED (
      SELECT
        source,
        raw_actor_id,
        CASE WHEN instr(actor_id, '#') > 0
          THEN substr(actor_id, 1, instr(actor_id, '#') - 1)
          ELSE actor_id
        END
      FROM actor_identity_raw
    ),
    actor_identity_clean(source, raw_actor_id, actor_id) AS MATERIALIZED (
      SELECT
        source,
        raw_actor_id,
        CASE WHEN substr(actor_id, -1) = '/'
          THEN substr(actor_id, 1, length(actor_id) - 1)
          ELSE actor_id
        END
      FROM actor_identity_fragmentless
    ),
    actor_identity_split(
      source, raw_actor_id, actor_id, separator, tail
    ) AS MATERIALIZED (
      SELECT
        source,
        raw_actor_id,
        actor_id,
        instr(actor_id, '://'),
        substr(actor_id, instr(actor_id, '://') + 3)
      FROM actor_identity_clean
    ),
    actor_identity_bounds(
      source, raw_actor_id, actor_id, separator, tail, boundary
    ) AS MATERIALIZED (
      SELECT
        source,
        raw_actor_id,
        actor_id,
        separator,
        tail,
        CASE
          WHEN instr(tail, '/') = 0 THEN instr(tail, '?')
          WHEN instr(tail, '?') = 0 THEN instr(tail, '/')
          WHEN instr(tail, '/') < instr(tail, '?') THEN instr(tail, '/')
          ELSE instr(tail, '?')
        END
      FROM actor_identity_split
    ),
    actor_identity_components(
      source, raw_actor_id, separator, scheme, authority, path_query
    ) AS MATERIALIZED (
      SELECT
        source,
        raw_actor_id,
        separator,
        lower(substr(actor_id, 1, separator - 1)),
        CASE WHEN boundary = 0
          THEN tail
          ELSE substr(tail, 1, boundary - 1)
        END,
        CASE
          WHEN boundary = 0 THEN ''
          WHEN substr(tail, boundary, 1) = '?'
            THEN '/' || substr(tail, boundary)
          ELSE substr(tail, boundary)
        END
      FROM actor_identity_bounds
    ),
    actor_identity_normalized(
      source, raw_actor_id, separator, scheme, authority, path_query
    ) AS MATERIALIZED (
      SELECT
        source,
        raw_actor_id,
        separator,
        scheme,
        CASE
          WHEN scheme = 'https' AND substr(lower(authority), -4) = ':443'
            THEN substr(lower(authority), 1, length(authority) - 4)
          WHEN scheme = 'http' AND substr(lower(authority), -3) = ':80'
            THEN substr(lower(authority), 1, length(authority) - 3)
          ELSE lower(authority)
        END,
        path_query
      FROM actor_identity_components
      WHERE instr(authority, '@') = 0
    ),
    actor_identity_values(source, raw_actor_id, actor_id) AS MATERIALIZED (
      SELECT source, raw_actor_id, actor_id
      FROM actor_identity_raw
      UNION
      SELECT
        source,
        raw_actor_id,
        scheme || '://' || authority || path_query
      FROM actor_identity_normalized
      WHERE separator > 1
        AND scheme IN ('http', 'https')
        AND length(authority) > 0
    )
    ${finalSelect}
  `;
}

/**
 * Expand an uncorrelated one-column actor-ID query into its raw spellings plus
 * the canonical HTTP(S) spellings accepted by the signature boundary.
 *
 * Feed callers compare their actor column to this set with `NOT IN`. The CTE is
 * independent of the outer feed row, so SQLite computes the small personal
 * moderation set once instead of reparsing actor URLs for every post or
 * notification. Raw IDs stay in the result for malformed legacy values and
 * content retained under the exact historical spelling. The canonical branch
 * preserves path/query bytes while folding only scheme/authority case,
 * default ports, fragments, and one trailing slash.
 *
 * Keep the parsing stages MATERIALIZED. Letting SQLite flatten this expression
 * chain causes workerd's D1 engine to exhaust memory even for a tiny relation
 * set; explicit materialization also keeps runtime bounded as the set grows.
 */
export function activityPubActorIdentitySetSql(rawActorIds: SQL): SQL {
  return expandedActorIdentitiesSql(
    rawActorIds,
    undefined,
    sql`
      SELECT DISTINCT actor_id
      FROM actor_identity_values
      WHERE source = 0
    `,
  );
}

/**
 * Return the retained raw spellings from `rawActorIds` that identify
 * `targetActorId`. This is the mutation counterpart to the identity-set read
 * predicate: callers can retain an existing primary-key spelling or delete all
 * historical spellings without loading/scanning the whole relation set in JS.
 */
export function activityPubActorIdentityMatchesSql(
  rawActorIds: SQL,
  targetActorId: string,
): SQL {
  return expandedActorIdentitiesSql(
    rawActorIds,
    sql`${targetActorId}`,
    sql`
      SELECT DISTINCT candidate.raw_actor_id AS actor_id
      FROM actor_identity_values AS candidate
      INNER JOIN actor_identity_values AS target
        ON target.source = 1
        AND target.actor_id = candidate.actor_id
      WHERE candidate.source = 0
    `,
  );
}
