import Stripe from 'npm:stripe@^22'
import { withSupabase } from 'npm:@supabase/server@^1'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!)

export default {
  fetch: withSupabase({ auth: 'user' }, async (_req, ctx) => {
    const userId = String(ctx.userClaims?.id || '')
    if (!userId) return Response.json({ error: 'UNAUTHORIZED' }, { status: 401 })

    const returnUrl = Deno.env.get('PASSITON_IDENTITY_RETURN_URL')
    if (!returnUrl) {
      console.error('PASSITON_IDENTITY_RETURN_URL is missing')
      return Response.json({ error: 'SERVER_CONFIGURATION' }, { status: 500 })
    }

    const { data: existing, error: existingError } = await ctx.supabaseAdmin
      .from('identity_verifications')
      .select('stripe_verification_session_id,status')
      .eq('user_id', userId)
      .maybeSingle()

    if (existingError) throw existingError

    if (existing?.status === 'verified') {
      return Response.json({ status: 'verified', url: null })
    }

    if (
      existing?.stripe_verification_session_id &&
      ['requires_input', 'processing'].includes(existing.status)
    ) {
      const current = await stripe.identity.verificationSessions.retrieve(
        existing.stripe_verification_session_id,
      )

      const { error: refreshError } = await ctx.supabaseAdmin
        .from('identity_verifications')
        .update({
          status: current.status,
          last_error_code: current.last_error?.code ?? null,
          verified_at: current.status === 'verified' ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId)
        .eq('stripe_verification_session_id', current.id)

      if (refreshError) throw refreshError

      return Response.json({
        status: current.status,
        url: current.status === 'requires_input' ? current.url : null,
      })
    }

    const idempotencyKey =
      `passiton-identity-${userId}-${existing?.stripe_verification_session_id || 'initial'}`

    const session = await stripe.identity.verificationSessions.create({
      type: 'document',
      client_reference_id: userId,
      metadata: { supabase_user_id: userId },
      options: {
        document: {
          require_matching_selfie: true,
        },
      },
      return_url: returnUrl,
    }, {
      idempotencyKey,
    })

    const { error: upsertError } = await ctx.supabaseAdmin
      .from('identity_verifications')
      .upsert({
        user_id: userId,
        stripe_verification_session_id: session.id,
        status: session.status,
        last_error_code: session.last_error?.code ?? null,
        verified_at: session.status === 'verified' ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' })

    if (upsertError) throw upsertError

    return Response.json({ status: session.status, url: session.url })
  }),
}
