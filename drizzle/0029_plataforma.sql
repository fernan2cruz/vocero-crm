CREATE TABLE "ai_credit_account" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"balance_micros" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_credit_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"kind" text NOT NULL,
	"amount_micros" bigint NOT NULL,
	"balance_after" bigint NOT NULL,
	"ref" text,
	"note" text,
	"actor_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ai_credit_ledger_amount_ck" CHECK ("ai_credit_ledger"."amount_micros" <> 0)
);
--> statement-breakpoint
CREATE TABLE "ai_model_price" (
	"model" text PRIMARY KEY NOT NULL,
	"input_per_million_micros" bigint NOT NULL,
	"output_per_million_micros" bigint NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_usage" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"source" text NOT NULL,
	"model" text NOT NULL,
	"prompt_tokens" integer NOT NULL,
	"completion_tokens" integer NOT NULL,
	"cost_micros" bigint NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_platform" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"ai_mode" text DEFAULT 'own_key' NOT NULL,
	"suspended_at" timestamp,
	"suspended_reason" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_admin" (
	"user_id" text PRIMARY KEY NOT NULL,
	"granted_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_audit" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_user_id" text,
	"action" text NOT NULL,
	"organization_id" text,
	"target_user_id" text,
	"detail" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"ai_provider" text,
	"ai_base_url" text,
	"ai_model" text,
	"token_cipher" text,
	"token_iv" text,
	"token_tag" text,
	"token_last4" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "platform_settings_singleton_ck" CHECK ("platform_settings"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE "ai_credit_account" ADD CONSTRAINT "ai_credit_account_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_credit_ledger" ADD CONSTRAINT "ai_credit_ledger_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_credit_ledger" ADD CONSTRAINT "ai_credit_ledger_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_platform" ADD CONSTRAINT "organization_platform_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_admin" ADD CONSTRAINT "platform_admin_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_admin" ADD CONSTRAINT "platform_admin_granted_by_user_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_audit" ADD CONSTRAINT "platform_audit_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_audit" ADD CONSTRAINT "platform_audit_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_audit" ADD CONSTRAINT "platform_audit_target_user_id_user_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_credit_ledger_org_created_idx" ON "ai_credit_ledger" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_usage_org_created_idx" ON "ai_usage" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "platform_audit_org_created_idx" ON "platform_audit" USING btree ("organization_id","created_at");