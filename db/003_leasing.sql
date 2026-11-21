-- Portfolio data is isolated from household ticket keys and resident sessions.
CREATE TABLE rental_listings (
  portfolio_id uuid NOT NULL REFERENCES portfolios, id uuid NOT NULL DEFAULT gen_random_uuid(),
  details jsonb NOT NULL, long_plan jsonb NOT NULL DEFAULT '{}', short_plan jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY(portfolio_id,id)
);
CREATE TABLE rental_settings (
  portfolio_id uuid PRIMARY KEY REFERENCES portfolios, settings jsonb NOT NULL
);
CREATE TABLE rental_leads (
  portfolio_id uuid NOT NULL REFERENCES portfolios, id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL, email text, phone text, preferences jsonb NOT NULL DEFAULT '{}',
  stage text NOT NULL DEFAULT 'New', crm_status text NOT NULL DEFAULT 'Pending', crm_id text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(portfolio_id,id), UNIQUE(portfolio_id,email), UNIQUE(portfolio_id,phone),
  CHECK (email IS NOT NULL OR phone IS NOT NULL)
);
CREATE TABLE rental_calls (
  portfolio_id uuid NOT NULL REFERENCES portfolios, id text NOT NULL, lead_id uuid,
  summary text NOT NULL DEFAULT '', next_action text NOT NULL DEFAULT '', ended boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(portfolio_id,id),
  FOREIGN KEY(portfolio_id,lead_id) REFERENCES rental_leads
);
CREATE TABLE rental_slots (
  portfolio_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), listing_id uuid NOT NULL,
  starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, holder uuid,
  PRIMARY KEY(portfolio_id,id), FOREIGN KEY(portfolio_id,listing_id) REFERENCES rental_listings,
  CHECK (ends_at>starts_at)
);
CREATE INDEX rental_slots_time ON rental_slots(portfolio_id,starts_at,ends_at);
CREATE TABLE rental_bookings (
  portfolio_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), call_id text NOT NULL,
  lead_id uuid NOT NULL, slot_id uuid NOT NULL, target_slot uuid, status text NOT NULL,
  calendar_event_id text, op_lease uuid, op_until timestamptz, updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(portfolio_id,id), FOREIGN KEY(portfolio_id,lead_id) REFERENCES rental_leads,
  FOREIGN KEY(portfolio_id,slot_id) REFERENCES rental_slots,
  FOREIGN KEY(portfolio_id,target_slot) REFERENCES rental_slots,
  FOREIGN KEY(portfolio_id,call_id) REFERENCES rental_calls,
  CHECK(status IN ('pending','confirmed','cancel_pending','move_pending','cancelled','conflict'))
);
CREATE INDEX rental_bookings_call ON rental_bookings(portfolio_id,call_id);
CREATE TABLE rental_callbacks (
  portfolio_id uuid NOT NULL REFERENCES portfolios, call_id text NOT NULL, reason text NOT NULL,
  phone text, email text, status text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(portfolio_id,call_id)
);
CREATE TABLE rental_actuals (
  portfolio_id uuid NOT NULL, listing_id uuid NOT NULL, month text NOT NULL, amounts jsonb NOT NULL,
  PRIMARY KEY(portfolio_id,listing_id,month), FOREIGN KEY(portfolio_id,listing_id) REFERENCES rental_listings,
  CHECK(month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
CREATE TABLE rental_receipts (
  portfolio_id uuid NOT NULL REFERENCES portfolios, event_id text NOT NULL, digest text NOT NULL,
  lease uuid NOT NULL, expires_at timestamptz NOT NULL, result jsonb, PRIMARY KEY(portfolio_id,event_id)
);
CREATE TABLE rental_outbox (
  portfolio_id uuid NOT NULL REFERENCES portfolios, event_id text NOT NULL, kind text NOT NULL, call_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending', attempts int NOT NULL DEFAULT 0, due_at timestamptz NOT NULL DEFAULT now(),
  lease uuid, receipt text, failure text, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(portfolio_id,event_id), FOREIGN KEY(portfolio_id,call_id) REFERENCES rental_calls
);
CREATE INDEX rental_outbox_due ON rental_outbox(portfolio_id,status,due_at);
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['rental_listings','rental_settings','rental_leads','rental_calls','rental_slots','rental_bookings','rental_callbacks','rental_actuals','rental_receipts','rental_outbox']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY rental_portfolio_scope ON %I USING (portfolio_id::text = current_setting(''sill.portfolio'',true)) WITH CHECK (portfolio_id::text = current_setting(''sill.portfolio'',true))',t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='sill_runtime') THEN
      EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO sill_runtime',t);
    END IF;
  END LOOP;
END $$;
