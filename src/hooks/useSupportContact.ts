import { useEffect, useState } from 'react';
import { getAccessToken } from '../services/supabase';
import { useAuthStore } from '../store/authStore';
import { loadSupportContact, type CustomerSupportContact } from '../services/support';

export interface SupportContactState {
  /** The phone number — present only once the server confirms the caller is a customer. */
  contact: CustomerSupportContact | null;
  /** The server confirmed the session but it has no order yet. */
  customerOnly: boolean;
  /** The lookup failed (offline / server error). Never shown as "not a customer". */
  unavailable: boolean;
  loading: boolean;
}

const IDLE: SupportContactState = { contact: null, customerOnly: false, unavailable: false, loading: false };

/**
 * Resolves the customer-only support phone for the current session.
 *
 * Signed-out visitors never hit the endpoint: the phone is only available to
 * someone with an order, so there is nothing to ask for. The number is never
 * cached in localStorage — a shared device should not hand it to the next
 * visitor even after a different customer signed in.
 */
export function useSupportContact(): SupportContactState {
  const { user, ready } = useAuthStore();
  const [state, setState] = useState<SupportContactState>(IDLE);

  useEffect(() => {
    if (!ready || !user) {
      setState(IDLE);
      return;
    }
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    void loadSupportContact(getAccessToken).then((r) => {
      if (!alive) return;
      setState({ contact: r.contact, customerOnly: r.customerOnly, unavailable: r.unavailable, loading: false });
    });
    return () => { alive = false; };
  }, [ready, user]);

  return state;
}
