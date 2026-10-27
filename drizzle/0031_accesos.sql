CREATE TABLE "login_event" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"email" text,
	"organization_id" text,
	"kind" text NOT NULL,
	"reason" text,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "login_event_email_ck" CHECK (length("login_event"."email") <= 254 and "login_event"."email" = lower("login_event"."email")),
	CONSTRAINT "login_event_user_agent_ck" CHECK (length("login_event"."user_agent") <= 300),
	CONSTRAINT "login_event_kind_ck" CHECK ("login_event"."kind" in ('success', 'failure')),
	CONSTRAINT "login_event_reason_ck" CHECK ("login_event"."reason" in ('bad_credentials', 'disabled', 'suspended', 'rate_limited'))
);
--> statement-breakpoint
ALTER TABLE "login_event" ADD CONSTRAINT "login_event_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "login_event" ADD CONSTRAINT "login_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "login_event_created_idx" ON "login_event" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "login_event_org_created_idx" ON "login_event" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "login_event_user_created_idx" ON "login_event" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "login_event_ip_created_idx" ON "login_event" USING btree ("ip","created_at");