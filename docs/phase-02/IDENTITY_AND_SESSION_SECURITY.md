# Identity And Session Security

- User remains the credential identity and carries an explicit account type.
- Account-specific operations live in Staff, Runner, and Hook Partner profiles.
- Refresh tokens are hashed in independent Account Session records.
- Refresh rotates the token. Reuse of a rotated token revokes its session family.
- Access tokens include a session ID and are rejected when the session or account is inactive.
- Staff permissions are resolved live.
- Guest identifiers are backend-issued random tokens; only hashes are stored.
- Suspended/disabled accounts have sessions revoked.
- Audit snapshots strip passwords, token material, OTPs, secrets, keys, and sensitive personal fields.

Invited accounts cannot sign in until activation. Legacy refresh hashes are invalidated by migration, intentionally requiring reauthentication.

## Operational account activation

- Staff, Runner, and Hook Partner accounts are created in `invited` state without an administrator-known password.
- A cryptographically random, single-use activation token is emailed; only its SHA-256 digest is stored.
- Tokens expire after `ACCOUNT_INVITATION_TTL_HOURS` (48 hours by default).
- Accepting an invitation sets a bcrypt password, verifies email ownership, activates the account and profile, and appends an audit event.
- Resending revokes every earlier unused token for that account before issuing a replacement.
- Staff, Runner, and Partner activation routes remain isolated in their respective route groups.
