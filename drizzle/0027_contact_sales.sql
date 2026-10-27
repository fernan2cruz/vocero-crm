CREATE TABLE "contact_sale" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text NOT NULL,
	"note" text,
	"occurred_at" timestamp DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "contact_sale_amount_ck" CHECK ("contact_sale"."amount_cents" > 0)
);
--> statement-breakpoint
ALTER TABLE "contact_sale" ADD CONSTRAINT "contact_sale_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_sale" ADD CONSTRAINT "contact_sale_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_sale" ADD CONSTRAINT "contact_sale_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contact_sale_org_contact_idx" ON "contact_sale" USING btree ("organization_id","contact_id","occurred_at");