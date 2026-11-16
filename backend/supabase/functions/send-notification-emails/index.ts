// NS-01 email dispatcher. Deploy with --no-verify-jwt and protect using
// a separate high-entropy NOTIFICATION_CRON_SECRET; never expose service keys.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const NOTIFICATION_FROM = Deno.env.get("NOTIFICATION_FROM") ?? "";
const SITE_URL = (Deno.env.get("PASSITON_SITE_URL") ?? "").replace(/\/$/, "");
const CRON_SECRET = Deno.env.get("NOTIFICATION_CRON_SECRET") ?? "";

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (char) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char] ?? char));

function targetUrl(item: { target_type: string | null; target_id: string | null }): string {
  if (!SITE_URL) throw new Error("PASSITON_SITE_URL is missing");
  if (item.target_type === "listing" && item.target_id) {
    return `${SITE_URL}/#passiton=product&id=${encodeURIComponent("listing-" + item.target_id)}`;
  }
  return `${SITE_URL}/#passiton=dashboard`;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!CRON_SECRET || request.headers.get("x-notification-secret") !== CRON_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!SUPABASE_URL || !SERVICE_KEY || !RESEND_API_KEY || !NOTIFICATION_FROM || !SITE_URL) {
    return new Response("Missing server configuration", { status: 503 });
  }
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await db.rpc("notification_claim_email_batch", { p_limit: 20 });
  if (error) {
    console.error("Could not claim email batch", error.message);
    return new Response("Queue unavailable", { status: 500 });
  }
  let sent = 0;
  let failed = 0;
  for (const item of data ?? []) {
    let success = false;
    let providerId: string | null = null;
    let failure: string | null = null;
    try {
      const link = targetUrl(item);
      const settingsUrl = `${SITE_URL}/#passiton=dashboard`;
      const body = `<!doctype html><html lang="sv"><body style="margin:0;background:#FFFCF9;font-family:Arial,sans-serif;color:#632713"><main style="max-width:560px;margin:36px auto;padding:30px;background:#FFF5EE;border:1px solid #E3C4AF"><p style="font-weight:700;letter-spacing:.08em;color:#FF8C00">PASSITON</p><h1 style="font-size:25px">${escapeHtml(item.email_title)}</h1><p style="line-height:1.7">${escapeHtml(item.email_message)}</p><p><a href="${escapeHtml(link)}" style="display:inline-block;background:#FF8C00;color:#632713;padding:12px 18px;font-weight:700;text-decoration:none">Visa i PassItOn</a></p><hr style="border:0;border-top:1px solid #E3C4AF;margin:28px 0 16px"><p style="font-size:12px">Du får detta mail enligt dina valda notisinställningar. <a href="${escapeHtml(settingsUrl)}">Ändra mailinställningar</a>.</p></main></body></html>`;
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
          "Idempotency-Key": item.notification_id,
        },
        body: JSON.stringify({
          from: NOTIFICATION_FROM,
          to: [item.recipient_email],
          subject: item.email_title,
          html: body,
          text: `${item.email_title}\n\n${item.email_message}\n\nVisa: ${link}\n\nMailinställningar: ${settingsUrl}`,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(`Resend HTTP ${response.status}: ${String(result.message || "Unknown").slice(0,160)}`);
      success = true;
      providerId = String(result.id ?? "");
      sent++;
    } catch (error) {
      failed++;
      failure = String(error instanceof Error ? error.message : error);
      console.error("Email failed for queue item", item.queue_id, failure);
    }
    const { error: finishError } = await db.rpc("notification_finish_email", {
      p_queue_id: item.queue_id,
      p_attempt: item.attempt,
      p_success: success,
      p_provider_id: providerId,
      p_error: failure,
    });
    if (finishError) console.error("Could not record delivery", item.queue_id, finishError.message);
  }
  return Response.json({ processed: (data ?? []).length, sent, failed });
});
