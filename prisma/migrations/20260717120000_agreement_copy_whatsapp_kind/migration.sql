-- AlterEnum
-- Additive and non-breaking: existing rows keep their kind, and nothing reads this value until the
-- signed-copy send exists. It earns its own kind because one WATI template is bound per kind, and
-- the countersigned copy must not go out under the signing-link template.
ALTER TYPE "WhatsAppKind" ADD VALUE 'AGREEMENT_COPY';
