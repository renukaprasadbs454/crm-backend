-- Password reset supports OTP delivery through WhatsApp or email.
ALTER TYPE "OtpPurpose" ADD VALUE IF NOT EXISTS 'PASSWORD_RESET';
