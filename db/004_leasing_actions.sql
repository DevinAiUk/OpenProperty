-- These functions use invoker permissions and the caller's portfolio RLS policy.
CREATE FUNCTION rental_capture(p uuid, c text, n text, e text, ph text, prefs jsonb) RETURNS text LANGUAGE plpgsql AS $$
DECLARE candidate uuid; linked uuid; matches int; known_email text; known_phone text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p::text));
  SELECT lead_id INTO linked FROM rental_calls WHERE portfolio_id=p AND id=c;
  SELECT count(*) INTO matches FROM rental_leads WHERE portfolio_id=p AND (id=linked OR email=e OR phone=ph);
  IF matches>1 THEN RETURN 'review'; END IF;
  SELECT id,email,phone INTO candidate,known_email,known_phone FROM rental_leads WHERE portfolio_id=p AND (id=linked OR email=e OR phone=ph);
  IF candidate IS NULL THEN
    INSERT INTO rental_leads(portfolio_id,name,email,phone,preferences) VALUES(p,n,e,ph,prefs) RETURNING id INTO candidate;
  ELSE
    IF (known_email IS NOT NULL AND e IS NOT NULL AND known_email<>e) OR (known_phone IS NOT NULL AND ph IS NOT NULL AND known_phone<>ph) THEN RETURN 'review'; END IF;
    UPDATE rental_leads SET email=coalesce(email,e),phone=coalesce(phone,ph),preferences=preferences||prefs,crm_status='Pending',updated_at=now()
      WHERE portfolio_id=p AND id=candidate;
  END IF;
  INSERT INTO rental_calls(portfolio_id,id,lead_id) VALUES(p,c,candidate) ON CONFLICT(portfolio_id,id) DO UPDATE SET lead_id=excluded.lead_id;
  RETURN candidate::text;
END $$;

CREATE FUNCTION rental_hold(p uuid, c text, slot uuid) RETURNS TABLE(code text, booking uuid) LANGUAGE plpgsql AS $$
DECLARE current_lead uuid; current_holder uuid; avail text; starts timestamptz; existing_call text; existing_status text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p::text));
  SELECT lead_id INTO current_lead FROM rental_calls WHERE portfolio_id=p AND id=c;
  IF current_lead IS NULL THEN RETURN QUERY SELECT 'need_contact',NULL::uuid; RETURN; END IF;
  SELECT s.holder,s.starts_at,l.details->>'availability' INTO current_holder,starts,avail
    FROM rental_slots s JOIN rental_listings l ON (l.portfolio_id,l.id)=(s.portfolio_id,s.listing_id)
    WHERE s.portfolio_id=p AND s.id=slot;
  IF current_holder IS NOT NULL THEN
    SELECT call_id,status INTO existing_call,existing_status FROM rental_bookings WHERE portfolio_id=p AND id=current_holder;
    IF existing_call=c AND existing_status IN ('pending','confirmed') THEN RETURN QUERY SELECT existing_status,current_holder; RETURN; END IF;
    RETURN QUERY SELECT 'conflict',NULL::uuid; RETURN;
  END IF;
  IF starts IS NULL OR starts<=now() OR avail<>'Available' THEN RETURN QUERY SELECT 'unavailable',NULL::uuid; RETURN; END IF;
  booking:=gen_random_uuid();
  INSERT INTO rental_bookings(portfolio_id,id,call_id,lead_id,slot_id,status) VALUES(p,booking,c,current_lead,slot,'pending');
  UPDATE rental_slots SET holder=booking WHERE portfolio_id=p AND id=slot;
  code:='pending'; RETURN NEXT;
END $$;
