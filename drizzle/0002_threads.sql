ALTER TYPE "public"."platform" ADD VALUE 'threads';--> statement-breakpoint
CREATE TABLE "threads_filters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid,
	"filter_type" text NOT NULL,
	"value" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "threads_filters_company_type_value_unique" UNIQUE("company_id","filter_type","value")
);
--> statement-breakpoint
ALTER TABLE "threads_filters" ADD CONSTRAINT "threads_filters_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
