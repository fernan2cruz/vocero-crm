CREATE TABLE "user_platform" (
	"user_id" text PRIMARY KEY NOT NULL,
	"disabled_at" timestamp DEFAULT now() NOT NULL,
	"disabled_reason" text NOT NULL,
	"disabled_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_platform" ADD CONSTRAINT "user_platform_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_platform" ADD CONSTRAINT "user_platform_disabled_by_user_id_fk" FOREIGN KEY ("disabled_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;