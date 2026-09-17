# WhatsApp OTP integration

Member invitations are sent by a Company Admin or Team Lead. The invited TL/Sales user is created without a usable password, receives a one-time code on WhatsApp, verifies it at `/activate`, and then creates their own password.

## Meta WhatsApp Cloud API

Set:

```env
WHATSAPP_PROVIDER=meta
WHATSAPP_ACCESS_TOKEN=...
WHATSAPP_PHONE_NUMBER_ID=...
WHATSAPP_API_VERSION=v23.0
WHATSAPP_TEMPLATE_NAME=skill99_crm_otp
WHATSAPP_TEMPLATE_LANGUAGE=en_US
```

Create/approve a WhatsApp template named `skill99_crm_otp` with one body variable. Suggested body:

`Your Skill99 CRM verification code is {{1}}. It expires in 10 minutes. Do not share this code.`

The template must be approved by Meta before production delivery.

## Twilio alternative

Set `WHATSAPP_PROVIDER=twilio` and provide the Twilio Account SID, Auth Token and WhatsApp sender. The backend sends the OTP through the Twilio Messages API.

## Local development

Leave `WHATSAPP_PROVIDER=console`. The OTP is printed by the backend terminal, allowing the complete activation flow to be tested without WhatsApp credentials. This fallback is intentionally blocked in production.
