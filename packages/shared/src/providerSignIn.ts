/**
 * Provider text that means the sign-in itself stopped working, rather than
 * never having been supplied. A revoked token is the same state as an expired
 * one: the credential is gone and the user has to sign in again.
 *
 * The sign-in noun and the revocation word must sit in the same clause, so a
 * revoked MCP credential or a revoked thread is not mistaken for a revoked
 * provider sign-in.
 */
const SIGN_IN_REVOCATION =
  /(token|credential|sign-?in|login|session)[^.]{0,40}(revoked|invalid_grant)|(revoked|invalid_grant)[^.]{0,40}(token|credential|sign-?in|login)/;

/**
 * A clause about an MCP server names a tool connector's credential, not the
 * provider sign-in. The repair this rule triggers is "sign in to the provider
 * again", which would not fix it, so those clauses are dropped before matching.
 */
const MCP_CLAUSE = /[^.]*\bmcp\b[^.]*/g;

/**
 * Whether provider text describes a revoked or otherwise lost sign-in. The
 * server classifies with this at the adapter boundary and the client uses it
 * as the fallback for rows written before the category was carried, so both
 * read the same rule.
 */
export function isProviderSignInRevocation(text: string): boolean {
  return SIGN_IN_REVOCATION.test(text.toLowerCase().replace(MCP_CLAUSE, " "));
}
