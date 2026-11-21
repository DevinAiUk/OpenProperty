GRANT USAGE ON SCHEMA public TO sill_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON "user", session, account, verification, portfolios, homes, memberships, invitations, integration_keys, tickets, ticket_events, ledger, contact_messages, request_limits TO sill_runtime;
GRANT SELECT, INSERT, UPDATE ON webhook_delivery TO sill_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO sill_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON rental_listings, rental_settings, rental_leads, rental_calls, rental_slots, rental_bookings, rental_callbacks, rental_actuals, rental_receipts, rental_outbox TO sill_runtime;
