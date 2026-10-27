CREATE TABLE "contact_segment" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"filters" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_tag" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT 'gris' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_tag_link" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"tag_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contact_segment" ADD CONSTRAINT "contact_segment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_tag" ADD CONSTRAINT "contact_tag_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_tag_link" ADD CONSTRAINT "contact_tag_link_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_tag_link" ADD CONSTRAINT "contact_tag_link_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_tag_link" ADD CONSTRAINT "contact_tag_link_tag_id_contact_tag_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."contact_tag"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contact_segment_org_idx" ON "contact_segment" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_tag_org_name_uq" ON "contact_tag" USING btree ("organization_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "contact_tag_link_uq" ON "contact_tag_link" USING btree ("contact_id","tag_id");--> statement-breakpoint
CREATE INDEX "contact_tag_link_org_tag_idx" ON "contact_tag_link" USING btree ("organization_id","tag_id");