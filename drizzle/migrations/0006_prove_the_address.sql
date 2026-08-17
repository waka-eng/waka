-- Nobody has ever had to prove they own the email they signed up with.
--
-- Password signup takes an address and creates the account. Nothing is sent,
-- nothing is checked, so anyone can hold an account on somebody else's email.
-- That is what made the Google pre-hijacking possible: an unproven password
-- sat on an address until its real owner arrived, and linking handed them an
-- account a stranger already had the key to.
--
-- Two columns and a table:
--   accounts.email_verified_at  when the address was proven, null until then
--   email_verifications         one live token per account, stored HASHED
--
-- The token is hashed at rest for the same reason a password is: this table is
-- a set of bearer credentials, and a leaked backup would otherwise be a set of
-- working account-takeover links. The lookup is by hash, so the plaintext
-- exists only in the email that carried it.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;

CREATE TABLE IF NOT EXISTS email_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE cascade,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One live token per account: requesting another replaces the last, so an old
-- link in an old inbox stops working the moment a new one is asked for.
CREATE UNIQUE INDEX IF NOT EXISTS email_verifications_account_id_key
  ON email_verifications (account_id);

-- Every account that existed before this migration signed up when there was no
-- verification to do, so they are not marked verified: they have genuinely not
-- proven the address. They keep everything except joining groups until they do.
