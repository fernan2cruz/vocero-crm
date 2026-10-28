CREATE TABLE "organization_limits" (
  "organization_id" text PRIMARY KEY NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "max_messages_per_day" integer,
  "max_campaign_recipients" integer,
  "max_monthly_spend_micros" bigint,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "organization_limits_messages_ck" CHECK ("max_messages_per_day" > 0),
  CONSTRAINT "organization_limits_recipients_ck" CHECK ("max_campaign_recipients" > 0),
  CONSTRAINT "organization_limits_spend_ck" CHECK ("max_monthly_spend_micros" > 0)
);
