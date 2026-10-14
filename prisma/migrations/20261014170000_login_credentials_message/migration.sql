-- The login-details message: a portal account was created or its password reset, and the person
-- is told how to sign in - by email and on WhatsApp.
--
-- Additive: nothing sends it until a WATI template is bound to it in WhatsApp → Settings.
-- Postgres refuses to USE a new enum value in the transaction that added it; nothing here does.
ALTER TYPE "WhatsAppKind" ADD VALUE IF NOT EXISTS 'LOGIN_CREDENTIALS';
