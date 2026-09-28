# WhatsApp Business Cloud API setup

OCHOLASUPERNET uses Meta's WhatsApp Business Cloud API directly. The integration is disabled by default, keeps provider credentials on the API server, and queues notifications separately from payments. A Meta delivery failure must not undo a recorded payment.

## Configure the Meta app

1. Create or select a Meta app with the WhatsApp product and a production WhatsApp Business phone number.
2. Generate a long-lived system-user access token with the permissions required to send WhatsApp messages and read the phone number profile.
3. Record the WhatsApp Business Account ID and Phone Number ID. The Phone Number ID is the Graph API sender ID.
4. Create and get approval for the message templates used by this project. Match the parameter counts and order below.
5. Set the webhook callback to `<public-api-origin>/api/whatsapp/webhook`, subscribe it to the WhatsApp `messages` field, and use the exact verify token configured on the server.
6. Keep the Meta App Secret available to the API server so it can verify `X-Hub-Signature-256` on each POST.

The callback URL must be the public HTTPS origin that routes `/api` to this API server. Do not use the Replit preview hostname for the external VPS deployment.

## Server environment

Set these variables in Replit Secrets for development and in the external VPS service environment for production. Replit Secrets do not automatically configure the separately managed VPS.

| Variable | Required | Purpose |
| --- | --- | --- |
| `WHATSAPP_ACCESS_TOKEN` | Yes | Meta Cloud API bearer token |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Yes | Secret used for the Meta webhook GET verification |
| `WHATSAPP_APP_SECRET` | Yes | Meta app secret used to validate signed webhook POSTs |
| `WHATSAPP_ENABLED` | No | Set to `false` to force WhatsApp off; otherwise the Super Admin switch controls it |
| `WHATSAPP_REQUIRE_REGISTRATION_VERIFICATION` | No | Set to `true` to fail registration closed if WhatsApp settings cannot be loaded |
| `WHATSAPP_WORKER_ENABLED` | No | Set to `false` to pause production outbox processing |
| `WHATSAPP_OTP_TTL_SECONDS` | No | OTP lifetime; defaults to 600 seconds and is limited to 60–900 |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | No | Overrides the Business Account ID in the settings page |
| `WHATSAPP_PHONE_NUMBER_ID` | No | Overrides the Phone Number ID in the settings page |
| `WHATSAPP_BUSINESS_PHONE` | No | Display-only sender phone override |
| `WHATSAPP_API_VERSION` | No | Graph API version; defaults to `v23.0` |
| `WHATSAPP_DEFAULT_COUNTRY_CODE` | No | Default calling code for local-format phone numbers; defaults to `254` |
| `WHATSAPP_AUTHENTICATION_TEMPLATE` | No | Overrides the configured OTP template name |
| `WHATSAPP_PAYMENT_TEMPLATE` | No | Overrides the configured payment template name |
| `WHATSAPP_RENEWAL_TEMPLATE` | No | Overrides the configured renewal template name |
| `WHATSAPP_EXPIRY_TEMPLATE` | No | Overrides the configured expiry template name |
| `WHATSAPP_ISP_SUBSCRIPTION_TEMPLATE` | No | Reserved for ISP subscription notices |
| `WHATSAPP_RESELLER_TEMPLATE` | No | Reserved for reseller notices |
| `WHATSAPP_TEST_TEMPLATE` | No | Overrides the configured test template name |

Never put the access token, App Secret, or verify token in the settings form, database, source control, or chat.

## Super Admin configuration

After the database migration is applied, open **Super Admin → WhatsApp**. Configure the non-secret IDs, sender display number, language, and exact approved template names. The page reports whether the three server secrets are present and checks the Cloud API connection. Enable the main switch only after the connection and templates are ready; then turn on the individual features needed.

The production migration runner applies `migrations/2026_whatsapp_integration.sql`. Do not apply the migration manually to the separate billing system.

## Template contract

Template names are case-sensitive and must be approved in WhatsApp Manager. Current parameter contracts are:

| Setting | Parameters, in order |
| --- | --- |
| Authentication / OTP | One body parameter: the six-digit code |
| Payment notification | Amount, package name, receipt/reference, payment date |
| Renewal | Package name, days remaining, expiry date |
| Expiry | Package name, days remaining, expiry date |
| ISP / reseller subscription | Billing period, amount due, invoice status |
| Test message | No parameters |

The OTP template should contain a single body placeholder for the code. If the template uses a Meta authentication button that requires additional parameters, configure a matching approved utility template with the single-body-parameter contract or extend the sender contract before enabling OTP.

## Supported flows and safety boundaries

- Admin login and password recovery use the phone number saved on the tenant account. Tenant subdomain scope is required for admin login.
- Registration can require a one-time phone-verification ticket before the existing M-Pesa registration flow proceeds.
- OTP hashes and action-token hashes are stored server-side. OTP codes and Meta credentials are not returned to the browser or written to logs; short-lived verification/reset tickets and normal login session tokens are returned only for their intended browser flow.
- Payment confirmation messages enter an independent outbox. The payment trigger catches queue errors, and WhatsApp delivery cannot change payment settlement.
- Customer payment and package notices require both **Customer notifications** and the matching payment/package switch. ISP and reseller invoice notices have separate switches.
- Customer WhatsApp self-service only responds when a sender number maps to exactly one non-suspended customer. A valid signed inbound message confirms control of that unique number; ambiguous numbers are never auto-verified. Payments and renewals are referred to the existing ISP portal; payment credentials are never collected in WhatsApp.
- Message webhooks require the Meta HMAC signature and are deduplicated before processing.
- If Meta credentials, WABA IDs, phone-number ID, approved templates, and the public webhook URL are not configured, sending and live provider verification cannot be completed.