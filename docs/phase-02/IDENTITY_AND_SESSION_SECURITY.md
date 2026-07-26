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
