import Stripe from 'npm:stripe@^22'
import { withSupabase } from 'npm:@supabase/server@^1'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!)
const cryptoProvider = Stripe.createSubtleCryptoProvider()

const supportedEvents = new Set([
  'identity.verification_session.processing',
  'identity.verification_session.requires_input',
  'identity.verification_session.verified',
  'identity.verification_session.canceled',
  'identity.verification_session.redacted',
])

export default {
  fetch: withSupabase({ auth: 'none' }, async (req, ctx) => {
    const signature = req.headers.get('Stripe-Signature') ?? ''
    const body = await req.text()

    let event: Stripe.Event
    try {
      event = await stripe.webhooks.constructEventAsync(
        body,
        signature,
        Deno.env.get('STRIPE_IDENTITY_WEBHOOK_SECRET')!,
        undefined,
        cryptoProvider,
      )
    } catch (error) {
      console.error('Stripe Identity webhook signature failed:', error)
      return new Response('Bad signature', { status: 400 })
    }

    if (!supportedEvents.has(event.type)) {
      return Response.json({ received: true })
    }

    const session = event.data.object as Stripe.Identity.VerificationSession
    const userId = session.metadata?.supabase_user_id || session.client_reference_id
    if (!userId) {
      console.error('VerificationSession has no Supabase user reference:', session.id)
      return Response.json({ received: true })
    }

    const { error } = await ctx.supabaseAdmin
      .from('identity_verifications')
      .update({
        status: session.status,
        last_error_code: session.last_error?.code ?? null,
        verified_at: session.status === 'verified' ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .eq('stripe_verification_session_id', session.id)

    if (error) throw error

    return Response.json({ received: true })
  }),
}
