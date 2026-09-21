/**
 * Payment providers that a pre-authenticated Hotspot client may need to
 * reach while a payment page or hosted checkout is loading.
 *
 * The application still keeps payment credentials and server-to-server
 * callbacks on the API. These are hostname-only RouterOS allowlist entries;
 * no URLs, secrets, account numbers, or user data are embedded in scripts.
 */
export const PAYMENT_WALLED_GARDEN_HOSTNAMES = [
  // Safaricom M-Pesa Daraja
  "api.safaricom.co.ke",
  "sandbox.safaricom.co.ke",

  // Airtel Money
  "openapi.airtel.africa",

  // AzamPay
  "api.azampay.co.tz",
  "checkout.azampay.co.tz",
  "sandbox.azampay.co.tz",

  // Flutterwave
  "api.flutterwave.com",
  "checkout.flutterwave.com",

  // IntaSend
  "api.intasend.com",
  "payment.intasend.com",

  // PesaPal
  "pay.pesapal.com",
  "www.pesapal.com",
  "cybqa.pesapal.com",

  // Stripe
  "api.stripe.com",
  "checkout.stripe.com",
  "js.stripe.com",

  // PayPal
  "api-m.paypal.com",
  "www.paypal.com",
  "www.paypalobjects.com",

  // Tigo Pesa
  "api.tigo.co.tz",

  // DPO / 3G Direct Pay
  "secure.3gdirectpay.com",
  "pay.dpo-group.com",

  // Xendit
  "api.xendit.co",
  "checkout.xendit.co",
] as const;

export type PaymentWalledGardenHostname = typeof PAYMENT_WALLED_GARDEN_HOSTNAMES[number];