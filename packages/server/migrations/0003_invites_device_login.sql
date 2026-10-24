-- Single-use invite links. Only the SHA-256 of the secret in the link is stored.
CREATE TABLE invites (
  id           text PRIMARY KEY,
  org_id       text NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  created_by   text REFERENCES users(id) ON DELETE SET NULL,
  role         text NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  secret_hash  text NOT NULL UNIQUE,
  note         text,
  expires_at   timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  used_at      timestamptz,
  used_by      text REFERENCES users(id) ON DELETE SET NULL,
  revoked_at   timestamptz
);
CREATE INDEX invites_org ON invites (org_id, created_at DESC);

-- Browser login for the CLI (device-code style). The CLI polls with device_code;
-- a signed-in user approves user_code in the web app. No token is stored here:
-- it is created when the approved CLI polls, and handed out once.
CREATE TABLE device_logins (
  id                 text PRIMARY KEY,
  device_code_hash   text NOT NULL UNIQUE,
  user_code          text NOT NULL UNIQUE,
  client_name        text NOT NULL,
  status             text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied', 'consumed')),
  org_id             text REFERENCES orgs(id) ON DELETE CASCADE,
  user_id            text REFERENCES users(id) ON DELETE CASCADE,
  expires_at         timestamptz NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);
