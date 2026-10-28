CREATE TABLE "platform_config" (
	"key" text PRIMARY KEY NOT NULL,
	"value_cipher" text,
	"value_iv" text,
	"value_tag" text,
	"value_plain" text,
	"updated_by" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform_config" ADD CONSTRAINT "platform_config_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
