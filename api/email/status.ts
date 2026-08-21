// GET /api/email/status
//
// Reports the Cloudflare Email setup for luxedge.us:
//   - inbound Email Routing forwarding (→ 8002salman@gmail.com)
//   - outbound sender (sales@luxedge.us) + whether the send_email binding
//     is present in this deployment
// Never returns secrets.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson } from '../_lib/providers.js';
import { requireAdmin } from '../_lib/auth.js';

const FORWARD_DESTINATION = '8002salman@gmail.com';
const SENDER = 'sales@luxedge.us';

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  if (!(await requireAdmin(req, res))) return;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const env = (req as any).env as { SEND_MAIL?: unknown } | undefined;

  sendJson(res, 200, {
    configured: true,
    inbound: {
      enabled: true,
      forwarding: true,
      destination: FORWARD_DESTINATION,
      catchAll: true,
      routes: [`sales@luxedge.us → ${FORWARD_DESTINATION}`, `anything@luxedge.us → ${FORWARD_DESTINATION}`],
      mx: 'route1/2/3.mx.cloudflare.net',
    },
    outbound: {
      sender: SENDER,
      bindingPresent: !!env?.SEND_MAIL,
      note: 'Sending to any recipient needs the Workers Paid plan (Email Sending beta); sending to your verified address (8002salman@gmail.com) is free on all plans.',
    },
  });
}
