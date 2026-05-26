CREATE TABLE "cluster_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cluster_id" uuid NOT NULL,
	"company_id" uuid,
	"snapshot_data" jsonb NOT NULL,
	"cluster_label" text,
	"company_name" text,
	"generated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clusters" ADD COLUMN "suggested_keywords" jsonb;--> statement-breakpoint
ALTER TABLE "cluster_reports" ADD CONSTRAINT "cluster_reports_cluster_id_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."clusters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cluster_reports" ADD CONSTRAINT "cluster_reports_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;