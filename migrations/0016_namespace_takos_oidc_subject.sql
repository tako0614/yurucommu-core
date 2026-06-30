-- DEEP round-2 #11: the `takos` OIDC subject was stored verbatim in
-- actors.takos_user_id while every OTHER identity source is namespaced
-- (password:owner, local:<name>, google:<id>, x:<id>). A trusted-but-
-- misconfigured/compromised issuer that emitted a subject equal to a reserved
-- key (e.g. "password:owner" / "local:tako") would resolve the OIDC
-- get-or-create to that pre-existing higher-privileged account instead of
-- provisioning a fresh actor. findOrCreateOAuthActor now stores the takos
-- subject as "takos:<sub>"; prefix existing un-namespaced takos rows to match.
--
-- A takos row is any non-null takos_user_id that does NOT already carry a known
-- namespace prefix. The "takos:" guard keeps this idempotent.
UPDATE actors
SET takos_user_id = 'takos:' || takos_user_id
WHERE takos_user_id IS NOT NULL
  AND takos_user_id NOT LIKE 'takos:%'
  AND takos_user_id NOT LIKE 'password:%'
  AND takos_user_id NOT LIKE 'local:%'
  AND takos_user_id NOT LIKE 'google:%'
  AND takos_user_id NOT LIKE 'x:%';
