import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, X-Razorpay-Signature",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const rawBody = await req.text();

  // Determine provider from header or body
  const razorpaySignature = req.headers.get("X-Razorpay-Signature");
  const stripeSignature = req.headers.get("Stripe-Signature");

  try {
    if (razorpaySignature) {
      return await handleRazorpayWebhook(req, rawBody, razorpaySignature, supabase);
    }

    if (stripeSignature) {
      return await handleStripeWebhook(req, rawBody, stripeSignature, supabase);
    }

    return new Response(
      JSON.stringify({ error: "Unknown webhook provider. Missing signature header." }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Webhook processing failed." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

// ============================================================
// Razorpay Webhook Handler
// Verifies signature using HMAC-SHA256 with webhook secret
// ============================================================
async function handleRazorpayWebhook(
  req: Request,
  rawBody: string,
  signature: string,
  supabase: ReturnType<typeof createClient>,
): Promise<Response> {
  const webhookSecret = Deno.env.get("RAZORPAY_WEBHOOK_SECRET");
  if (!webhookSecret) {
    return new Response(
      JSON.stringify({ error: "Razorpay webhook secret not configured." }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Verify signature: HMAC-SHA256(rawBody, webhookSecret) == signature
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(webhookSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const expectedSig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(rawBody),
  );

  const expectedSigHex = Array.from(new Uint8Array(expectedSig))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");

  if (expectedSigHex !== signature) {
    return new Response(
      JSON.stringify({ error: "Invalid Razorpay signature." }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const event = JSON.parse(rawBody);
  const eventType = event.event;

  switch (eventType) {
    case "payment.captured": {
      const payment = event.payload?.payment?.entity;
      if (!payment) break;

      const userId = payment.notes?.supabase_user_id;
      if (!userId) break;

      // Verify payment amount and currency
      const expectedAmount = parseInt(Deno.env.get("PRO_PRICE_INR") || "199") * 100;
      if (payment.amount !== expectedAmount || payment.currency !== "INR") {
        break;
      }

      // Activate Pro subscription
      await supabase
        .from("profiles")
        .update({
          plan: "pro",
          subscription_status: "active",
          stripe_customer_id: payment.id,
          current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", userId);

      break;
    }

    case "subscription.activated": {
      const subscription = event.payload?.subscription?.entity;
      if (!subscription) break;

      const userId = subscription.notes?.supabase_user_id;
      if (!userId) break;

      await supabase
        .from("profiles")
        .update({
          plan: "pro",
          subscription_status: "active",
          stripe_subscription_id: subscription.id,
          current_period_end: subscription.current_end
            ? new Date(subscription.current_end * 1000).toISOString()
            : null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", userId);

      break;
    }

    case "subscription.cancelled":
    case "subscription.expired": {
      const subscription = event.payload?.subscription?.entity;
      if (!subscription) break;

      const userId = subscription.notes?.supabase_user_id;
      if (!userId) break;

      await supabase
        .from("profiles")
        .update({
          plan: "free",
          subscription_status: "canceled",
          current_period_end: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", userId);

      break;
    }

    case "subscription.charged": {
      // Recurring payment success — extend subscription
      const subscription = event.payload?.subscription?.entity;
      if (!subscription) break;

      const userId = subscription.notes?.supabase_user_id;
      if (!userId) break;

      await supabase
        .from("profiles")
        .update({
          plan: "pro",
          subscription_status: "active",
          current_period_end: subscription.current_end
            ? new Date(subscription.current_end * 1000).toISOString()
            : null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", userId);

      break;
    }

    default:
      break;
  }

  return new Response(
    JSON.stringify({ received: true }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

// ============================================================
// Stripe Webhook Handler (Stage 3)
// Verifies signature using Stripe webhook secret
// ============================================================
async function handleStripeWebhook(
  req: Request,
  rawBody: string,
  signature: string,
  supabase: ReturnType<typeof createClient>,
): Promise<Response> {
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");

  if (!webhookSecret || !stripeSecretKey) {
    return new Response(
      JSON.stringify({ error: "Stripe webhook not configured." }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Verify Stripe signature by constructing the event via Stripe API
  // Edge runtime supports crypto.subtle for HMAC
  const parts = signature.split(",");
  const timestampPart = parts.find(p => p.startsWith("t="));
  const v1Part = parts.find(p => p.startsWith("v1="));

  if (!timestampPart || !v1Part) {
    return new Response(
      JSON.stringify({ error: "Invalid Stripe signature format." }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const timestamp = timestampPart.slice(2);
  const v1Signature = v1Part.slice(3);

  const signedPayload = `${timestamp}.${rawBody}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(webhookSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const expectedSig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(signedPayload),
  );

  const expectedSigHex = Array.from(new Uint8Array(expectedSig))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");

  if (expectedSigHex !== v1Signature) {
    return new Response(
      JSON.stringify({ error: "Invalid Stripe signature." }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Check timestamp freshness (5 minute tolerance)
  const ageSeconds = Math.floor(Date.now() / 1000) - parseInt(timestamp);
  if (ageSeconds > 300) {
    return new Response(
      JSON.stringify({ error: "Webhook timestamp too old." }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const event = JSON.parse(rawBody);

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data?.object;
      const userId = session?.metadata?.supabase_user_id;
      if (!userId) break;

      // Fetch subscription for period end
      let periodEnd: string | null = null;
      if (session?.subscription) {
        const subResponse = await fetch(
          `https://api.stripe.com/v1/subscriptions/${session.subscription}`,
          { headers: { "Authorization": `Bearer ${stripeSecretKey}` } },
        );
        if (subResponse.ok) {
          const sub = await subResponse.json();
          periodEnd = sub.current_period_end
            ? new Date(sub.current_period_end * 1000).toISOString()
            : null;
        }
      }

      await supabase
        .from("profiles")
        .update({
          plan: "pro",
          subscription_status: "active",
          stripe_customer_id: session.customer,
          stripe_subscription_id: session.subscription,
          current_period_end: periodEnd,
          updated_at: new Date().toISOString(),
        })
        .eq("id", userId);

      break;
    }

    case "customer.subscription.updated": {
      const sub = event.data?.object;
      const userId = sub?.metadata?.supabase_user_id;
      if (!userId) break;

      const statusMap: Record<string, string> = {
        active: "active",
        trialing: "active",
        past_due: "past_due",
        canceled: "canceled",
        unpaid: "canceled",
        incomplete: "inactive",
        incomplete_expired: "inactive",
      };

      const dbStatus = statusMap[sub.status] || "inactive";
      const plan = sub.status === "active" || sub.status === "trialing" ? "pro" : "free";

      await supabase
        .from("profiles")
        .update({
          plan,
          subscription_status: dbStatus,
          current_period_end: sub.current_period_end
            ? new Date(sub.current_period_end * 1000).toISOString()
            : null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", userId);

      break;
    }

    case "customer.subscription.deleted": {
      const sub = event.data?.object;
      const userId = sub?.metadata?.supabase_user_id;
      if (!userId) break;

      await supabase
        .from("profiles")
        .update({
          plan: "free",
          subscription_status: "canceled",
          current_period_end: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", userId);

      break;
    }

    default:
      break;
  }

  return new Response(
    JSON.stringify({ received: true }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}
// AccessiCheck AI - payment-webhook edge function
