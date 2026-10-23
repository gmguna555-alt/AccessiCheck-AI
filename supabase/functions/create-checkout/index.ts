import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const PRO_PRICE_INR = Deno.env.get("PRO_PRICE_INR") || "199";

interface CheckoutBody {
  plan?: string;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Only POST requests are supported." }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace("Bearer ", "");

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const supabaseAnon = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: { user }, error: userError } = await supabaseAnon.auth.getUser();
  if (userError || !user) {
    return new Response(
      JSON.stringify({ error: "You must be signed in to subscribe." }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile) {
    return new Response(
      JSON.stringify({ error: "Profile not found." }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Already Pro?
  if (profile.plan === "pro" && profile.subscription_status === "active") {
    return new Response(
      JSON.stringify({ error: "You already have an active Pro subscription." }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const _body: CheckoutBody = await req.json();

    // Determine which payment provider is configured
    // Priority: Razorpay (Indian market) > Stripe (international)
    const razorpayKeyId = Deno.env.get("RAZORPAY_KEY_ID");
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");

    if (razorpayKeyId) {
      return await createRazorpayCheckout(req, user, profile, supabase, razorpayKeyId, PRO_PRICE_INR);
    }

    if (stripeSecretKey) {
      return await createStripeCheckout(req, user, profile, supabase, stripeSecretKey, PRO_PRICE_INR);
    }

    // No provider configured
    return new Response(
      JSON.stringify({ error: "Payment is not configured. Please check back soon or contact support." }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Checkout failed." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

// ============================================================
// Razorpay Checkout (Stage 2 — activates when RAZORPAY_KEY_ID is set)
// ============================================================
async function createRazorpayCheckout(
  req: Request,
  user: { id: string; email?: string },
  profile: Record<string, unknown>,
  supabase: ReturnType<typeof createClient>,
  razorpayKeyId: string,
  priceInr: string,
): Promise<Response> {
  const corsHeadersRazorpay = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  const razorpayKeySecret = Deno.env.get("RAZORPAY_KEY_SECRET");
  if (!razorpayKeySecret) {
    return new Response(
      JSON.stringify({ error: "Razorpay is partially configured. Contact support." }),
      { status: 500, headers: corsHeadersRazorpay },
    );
  }

  const auth = btoa(`${razorpayKeyId}:${razorpayKeySecret}`);
  const amountInPaise = parseInt(priceInr) * 100;
  const origin = req.headers.get("origin") || "https://bolt.new";

  // Check if merchant is eligible for recurring subscriptions
  // For now, create a one-time payment link. When the merchant account
  // is approved for subscriptions, switch to Razorpay Subscription API.
  const subscriptionEligible = Deno.env.get("RAZORPAY_SUBSCRIPTIONS_ENABLED") === "true";

  let responseBody: Record<string, unknown>;
  let endpoint: string;

  if (subscriptionEligible) {
    // Create a subscription plan + subscription
    // Step 1: Create or reuse a plan
    const planResponse = await fetch("https://api.razorpay.com/v1/plans", {
      method: "POST",
      headers: {
        "Authorization": `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        period: "monthly",
        interval: 1,
        item: {
          name: "AccessiCheck AI Pro",
          amount: amountInPaise,
          currency: "INR",
          description: "Monthly subscription for unlimited accessibility audits",
        },
      }),
    });

    if (!planResponse.ok) {
      const err = await planResponse.json();
      throw new Error(err.error?.description || "Failed to create Razorpay plan.");
    }

    const plan = await planResponse.json();

    // Step 2: Create subscription
    const subResponse = await fetch("https://api.razorpay.com/v1/subscriptions", {
      method: "POST",
      headers: {
        "Authorization": `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        plan_id: plan.id,
        customer_notify: 1,
        total_count: 12,
        notes: {
          supabase_user_id: user.id,
          email: user.email || "",
        },
      }),
    });

    if (!subResponse.ok) {
      const err = await subResponse.json();
      throw new Error(err.error?.description || "Failed to create Razorpay subscription.");
    }

    const subscription = await subResponse.json();

    // Save subscription reference to profile
    await supabase
      .from("profiles")
      .update({
        stripe_customer_id: subscription.id, // reuse field for payment provider sub ID
        updated_at: new Date().toISOString(),
      })
      .eq("id", user.id);

    responseBody = {
      url: `${origin}/?checkout=razorpay&subscription_id=${subscription.id}`,
      provider: "razorpay",
      subscription_id: subscription.id,
      key_id: razorpayKeyId,
      subscription: subscription,
    };
    endpoint = "subscription";
  } else {
    // Create a payment link (one-time, test mode)
    const linkResponse = await fetch("https://api.razorpay.com/v1/payment_links", {
      method: "POST",
      headers: {
        "Authorization": `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: amountInPaise,
        currency: "INR",
        accept_partial: false,
        description: "AccessiCheck AI Pro — Monthly Subscription",
        customer: {
          email: user.email || "",
        },
        notify: {
          email: true,
          sms: false,
        },
        reminder_enable: true,
        notes: {
          supabase_user_id: user.id,
          plan: "pro_monthly",
        },
        callback_url: `${origin}/?checkout=razorpay&status=success`,
        callback_method: "get",
      }),
    });

    if (!linkResponse.ok) {
      const err = await linkResponse.json();
      throw new Error(err.error?.description || "Failed to create Razorpay payment link.");
    }

    const link = await linkResponse.json();

    responseBody = {
      url: link.short_url,
      provider: "razorpay",
      payment_link_id: link.id,
    };
    endpoint = "payment_link";
  }

  return new Response(
    JSON.stringify(responseBody),
    { status: 200, headers: { ...corsHeadersRazorpay } },
  );
}

// ============================================================
// Stripe Checkout (Stage 3 — activates when STRIPE_SECRET_KEY is set)
// ============================================================
async function createStripeCheckout(
  req: Request,
  user: { id: string; email?: string },
  profile: Record<string, unknown>,
  supabase: ReturnType<typeof createClient>,
  stripeSecretKey: string,
  priceInr: string,
): Promise<Response> {
  const corsHeadersStripe = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  let customerId = profile.stripe_customer_id as string | null;

  if (!customerId) {
    const customerResponse = await fetch("https://api.stripe.com/v1/customers", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${stripeSecretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        email: user.email || "",
        metadata: JSON.stringify({ supabase_user_id: user.id }),
      }),
    });

    if (!customerResponse.ok) {
      const err = await customerResponse.json();
      throw new Error(err.error?.message || "Failed to create Stripe customer.");
    }

    const customer = await customerResponse.json();
    customerId = customer.id;

    await supabase
      .from("profiles")
      .update({ stripe_customer_id: customerId })
      .eq("id", user.id);
  }

  const origin = req.headers.get("origin") || "https://bolt.new";

  const sessionResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${stripeSecretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      "customer": customerId,
      "payment_method_types[]": "card",
      "mode": "subscription",
      "line_items[0][price_data][currency]": "inr",
      "line_items[0][price_data][unit_amount]": (parseInt(priceInr) * 100).toString(),
      "line_items[0][price_data][recurring][interval]": "month",
      "line_items[0][price_data][product_data][name]": "AccessiCheck AI Pro",
      "line_items[0][quantity]": "1",
      "success_url": `${origin}/?checkout=success`,
      "cancel_url": `${origin}/?checkout=cancelled`,
      "metadata[supabase_user_id]": user.id,
      "subscription_data[metadata][supabase_user_id]": user.id,
    }),
  });

  if (!sessionResponse.ok) {
    const err = await sessionResponse.json();
    throw new Error(err.error?.message || "Failed to create Stripe checkout session.");
  }

  const session = await sessionResponse.json();

  return new Response(
    JSON.stringify({ url: session.url, provider: "stripe" }),
    { status: 200, headers: { ...corsHeadersStripe } },
  );
}
// AccessiCheck AI - create-checkout edge function
